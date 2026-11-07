import { ContextoClient } from "./contextoClient.js";
import { chat, estimateCostUsd, getPricing } from "./llmClient.js";
import { OPENING_BOOK } from "./openingBook.js";
import type { GameTranscript, Guess, LlmCallRecord, ModelConfig, TokenUsage } from "./types.js";

export interface AgentOptions {
  maxGuesses: number;
  maxLlmCalls: number;
  candidatesPerCall: number;
  openingBookSize: number;
  topKShown: number;
  recentShown: number;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxGuesses: 50,
  maxLlmCalls: 40,
  candidatesPerCall: 6,
  openingBookSize: 6,
  topKShown: 25,
  recentShown: 5,
};

const SYSTEM_PROMPT = `You are playing Contexto, a word-guessing game. There is a hidden secret word.
Each guess returns a rank (distance): 0 means you found the secret word; smaller ranks mean the
word is semantically closer to it (as judged by a word-embedding model trained on word co-occurrence,
not just topic similarity). Ranks run from 0 up to tens of thousands. Your goal is to find the secret
word in as few guesses as possible.

Rules:
- Guess only common, single, lowercase dictionary words (nouns, verbs, adjectives). No phrases, no proper nouns.
- Never repeat a word you have already been told about.
- Use the ranked history: words that rank close together are closer in meaning to each other AND to the
  secret word. If several close words share a theme (e.g. all foods, all emotions, all body parts), explore
  that theme. If your closest word is a hypernym/hyponym or synonym family, try siblings, synonyms, and
  more specific or more general versions.
- Always respond with STRICT JSON only, of the shape: {"guesses": ["word1", "word2", ...]}.
  Return between 1 and N candidate words (N will be stated), ordered best guess first.`;

function buildUserPrompt(guesses: Guess[], opts: AgentOptions, budget: { used: number; max: number }): string {
  const scored = guesses.filter((g) => g.distance !== null);
  const sorted = [...scored].sort((a, b) => (a.distance as number) - (b.distance as number));
  const top = sorted.slice(0, opts.topKShown);
  const recent = scored.slice(-opts.recentShown);

  const lines: string[] = [];
  lines.push(`Guesses used so far: ${budget.used} / ${budget.max}.`);
  if (top.length === 0) {
    lines.push("No scored guesses yet.");
  } else {
    lines.push(`Closest ${top.length} guesses so far (word: rank, lower is better):`);
    for (const g of top) lines.push(`${g.word}: ${g.distance}`);
  }
  if (recent.length > 0) {
    lines.push("");
    lines.push("Most recent guesses (may overlap with above):");
    for (const g of recent) lines.push(`${g.word}: ${g.distance}`);
  }
  const rejected = guesses.filter((g) => g.rejected).slice(-10);
  if (rejected.length > 0) {
    lines.push("");
    lines.push("Recently rejected (invalid word / too common, these did not cost a guess, do not retry them):");
    for (const g of rejected) lines.push(`${g.word} (${g.rejectReason})`);
  }
  lines.push("");
  lines.push(
    `Give your next ${opts.candidatesPerCall} best candidate guesses as strict JSON: {"guesses": [...]}. ` +
      "You only see the closest and most recent guesses above; the system silently discards exact repeats " +
      "of your full history, so prefer new words but don't worry if you accidentally repeat one."
  );
  return lines.join("\n");
}

function parseCandidates(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { guesses?: unknown };
    if (Array.isArray(parsed.guesses)) {
      return parsed.guesses.filter((w): w is string => typeof w === "string");
    }
  } catch {
    // fall through to regex fallback below
  }
  const matches = raw.match(/[a-zA-Z-]{2,}/g) ?? [];
  return matches;
}

export async function playGame(
  model: ModelConfig,
  gameId: number,
  options: Partial<AgentOptions> = {}
): Promise<GameTranscript> {
  const opts: AgentOptions = { ...DEFAULT_AGENT_OPTIONS, ...options };
  const client = new ContextoClient(gameId);
  const pricing = await getPricing(model.slug);

  const guesses: Guess[] = [];
  const tried = new Set<string>();
  const llmCallLog: LlmCallRecord[] = [];
  let openingBookGuesses = 0;
  let llmCalls = 0;
  let solved = false;
  const start = Date.now();
  let error: string | undefined;

  const scoredCount = () => guesses.filter((g) => !g.rejected).length;
  const tag = `[${model.slug}|game ${gameId}]`;

  const tryWord = async (rawWord: string): Promise<boolean> => {
    const norm = ContextoClient.normalize(rawWord);
    if (!norm || tried.has(norm)) return false;
    tried.add(norm);
    const g = await client.guess(norm);
    guesses.push(g);
    if (g.rejected) {
      console.log(`${tag} "${g.word}" -> rejected (${g.rejectReason})`);
    } else if (g.distance === 0) {
      solved = true;
      console.log(`${tag} #${scoredCount()} "${g.word}" -> 0  SOLVED`);
    } else {
      console.log(`${tag} #${scoredCount()} "${g.word}" -> ${g.distance}`);
    }
    return true;
  };

  try {
    for (const word of OPENING_BOOK.slice(0, opts.openingBookSize)) {
      if (solved || scoredCount() >= opts.maxGuesses) break;
      const attempted = await tryWord(word);
      if (attempted && !guesses[guesses.length - 1]!.rejected) openingBookGuesses++;
    }

    let consecutiveEmptyBatches = 0;
    while (!solved && scoredCount() < opts.maxGuesses && llmCalls < opts.maxLlmCalls) {
      const prompt = buildUserPrompt(guesses, opts, { used: scoredCount(), max: opts.maxGuesses });
      const result = await chat(
        model.slug,
        [
          { role: "system", content: SYSTEM_PROMPT.replace("N will be stated", `${opts.candidatesPerCall}`) },
          { role: "user", content: prompt },
        ],
        {
          reasoningEffort: model.reasoningEffort ?? "low",
          temperature: model.temperature,
          tags: { app: "contexto-bench", model: model.slug, game: String(gameId) },
        }
      );
      llmCalls++;
      const candidates = parseCandidates(result.content).slice(0, opts.candidatesPerCall);
      llmCallLog.push({
        turn: llmCalls,
        usage: result.usage,
        costUsd: estimateCostUsd(result.usage, pricing),
        candidates,
      });

      let gotNewWord = false;
      for (const candidate of candidates) {
        if (solved || scoredCount() >= opts.maxGuesses) break;
        const attempted = await tryWord(candidate);
        if (attempted) gotNewWord = true;
      }

      consecutiveEmptyBatches = gotNewWord ? 0 : consecutiveEmptyBatches + 1;
      if (consecutiveEmptyBatches >= 3) {
        error = "Model stopped producing new candidate words (3 consecutive empty batches).";
        break;
      }
    }

    if (!solved && !error && scoredCount() >= opts.maxGuesses) {
      error = `Did not solve within maxGuesses (${opts.maxGuesses}).`;
    }
    if (!solved && !error && llmCalls >= opts.maxLlmCalls) {
      error = `Hit maxLlmCalls (${opts.maxLlmCalls}) without solving.`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const totalUsage: TokenUsage = llmCallLog.reduce(
    (acc, c) => ({
      promptTokens: acc.promptTokens + c.usage.promptTokens,
      completionTokens: acc.completionTokens + c.usage.completionTokens,
      totalTokens: acc.totalTokens + c.usage.totalTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  );
  const totalCostUsd = llmCallLog.every((c) => c.costUsd !== null)
    ? llmCallLog.reduce((acc, c) => acc + (c.costUsd ?? 0), 0)
    : null;

  return {
    model: model.slug,
    gameId,
    solved,
    guessCount: scoredCount(),
    llmCalls,
    openingBookGuesses,
    totalUsage,
    totalCostUsd,
    wallClockMs: Date.now() - start,
    guesses,
    llmCallLog,
    error,
  };
}
