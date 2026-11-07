import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache");

/**
 * Contexto's answer for a given (game id, word) pair never changes, so caching it
 * to disk avoids re-hitting their API for words other runs/models already asked about.
 * This keeps us well under rate limits when benchmarking several models against the
 * same game, and lets reruns of a benchmark be instant and free on the Contexto side.
 *
 * One instance is shared per game id (see `getContextoCache`) because a benchmark run
 * plays several models concurrently against the same game. Writes are serialized through
 * `writeQueue` so concurrent `set()` calls from different models can't interleave and
 * corrupt the on-disk JSON.
 */
export class ContextoCache {
  private memo = new Map<string, unknown>();
  private file: string;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(gameId: number) {
    this.file = path.join(CACHE_DIR, `game-${gameId}.json`);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) this.memo.set(k, v);
    } catch {
      // no cache yet
    }
  }

  async get<T>(word: string): Promise<T | undefined> {
    await this.load();
    return this.memo.get(word) as T | undefined;
  }

  async set<T>(word: string, value: T): Promise<void> {
    await this.load();
    if (this.memo.has(word)) return; // another concurrent caller already wrote this word
    this.memo.set(word, value);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const obj = Object.fromEntries(this.memo.entries());
      await fs.writeFile(this.file, JSON.stringify(obj, null, 2), "utf8");
    });
    await this.writeQueue;
  }
}

const sharedCaches = new Map<number, ContextoCache>();

/** Returns the single ContextoCache for a game id, shared across all concurrent callers. */
export function getContextoCache(gameId: number): ContextoCache {
  let cache = sharedCaches.get(gameId);
  if (!cache) {
    cache = new ContextoCache(gameId);
    sharedCaches.set(gameId, cache);
  }
  return cache;
}
