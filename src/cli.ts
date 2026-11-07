import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./benchmark.js";
import type { AgentOptions } from "./agent.js";
import type { ModelConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function loadDefaultModels(): Promise<ModelConfig[]> {
  const file = path.join(__dirname, "..", "config", "models.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as ModelConfig[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.game) {
    console.error(
      'Usage: npm run bench -- --game <gameId>[,<gameId>...] [--models slug1,slug2,...] ' +
        "[--max-guesses 50] [--candidates 6] [--opening 6]\n\n" +
        "NOTE: pick a RECENT Contexto game id (today's, from contexto.me) for a fair benchmark. " +
        "Old game answers are often posted online and may already be in a model's training data, " +
        "which would test memorization rather than reasoning."
    );
    process.exit(1);
  }

  const gameIds = args.game.split(",").map((s) => parseInt(s.trim(), 10));
  const models = args.models
    ? args.models.split(",").map((slug) => ({ slug: slug.trim() }))
    : await loadDefaultModels();

  const agent: Partial<AgentOptions> = {};
  if (args["max-guesses"]) agent.maxGuesses = parseInt(args["max-guesses"], 10);
  if (args["candidates"]) agent.candidatesPerCall = parseInt(args["candidates"], 10);
  if (args["opening"]) agent.openingBookSize = parseInt(args["opening"], 10);

  console.log(`Running ${models.length} model(s) against game(s): ${gameIds.join(", ")}`);
  await runBenchmark({ models, gameIds, agent });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
