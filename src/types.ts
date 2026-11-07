export interface ContextoResult {
  word: string;
  lemma: string;
  distance: number;
}

export interface ContextoError {
  error: string;
}

export type ContextoResponse = ContextoResult | ContextoError;

export function isContextoError(r: ContextoResponse): r is ContextoError {
  return (r as ContextoError).error !== undefined;
}

export interface Guess {
  word: string;
  distance: number | null; // null when the API rejected the word (not a scored guess)
  rejected: boolean;
  rejectReason?: string;
}

export interface ModelConfig {
  /** Slug as recognized by the Experiential Labs gateway, e.g. "claude-haiku-5.5" */
  slug: string;
  /** Human-readable label for reports */
  label?: string;
  /** Optional per-model reasoning effort override */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Optional temperature override */
  temperature?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCallRecord {
  turn: number;
  usage: TokenUsage;
  costUsd: number | null;
  candidates: string[];
}

export interface GameTranscript {
  model: string;
  gameId: number;
  solved: boolean;
  guessCount: number; // scored guesses only, matches real Contexto's counter
  llmCalls: number;
  openingBookGuesses: number;
  totalUsage: TokenUsage;
  totalCostUsd: number | null;
  wallClockMs: number;
  guesses: Guess[];
  llmCallLog: LlmCallRecord[];
  error?: string;
}

export interface Pricing {
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}
