import { getContextoCache, type ContextoCache } from "./cache.js";
import type { ContextoResponse, Guess } from "./types.js";
import { isContextoError } from "./types.js";

const BASE = "https://api.contexto.me/machado/en";

/**
 * Thin wrapper around the Contexto guess endpoint. A given (gameId, word) pair is
 * deterministic, so every lookup is cached to disk via ContextoCache -- this matters
 * once you're running several models against the same game, since they'll naturally
 * re-try many of the same common words.
 */
export class ContextoClient {
  private cache: ContextoCache;

  constructor(public readonly gameId: number) {
    this.cache = getContextoCache(gameId);
  }

  /** Normalizes a model's guess into a single lowercase token Contexto will accept. */
  static normalize(word: string): string {
    return word.trim().toLowerCase().replace(/[^a-z-]/g, "");
  }

  async guess(rawWord: string): Promise<Guess> {
    const word = ContextoClient.normalize(rawWord);
    if (!word) {
      return { word: rawWord, distance: null, rejected: true, rejectReason: "empty after normalization" };
    }

    const cached = await this.cache.get<ContextoResponse>(word);
    if (cached) return this.toGuess(word, cached);

    const url = `${BASE}/game/${this.gameId}/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    const body = (await res.json()) as ContextoResponse;
    await this.cache.set(word, body);
    return this.toGuess(word, body);
  }

  private toGuess(word: string, body: ContextoResponse): Guess {
    if (isContextoError(body)) {
      return { word, distance: null, rejected: true, rejectReason: body.error };
    }
    return { word, distance: body.distance, rejected: false };
  }
}
