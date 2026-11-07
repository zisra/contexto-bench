import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playGame, type AgentOptions } from "./agent.js";
import { assertValidSlugs } from "./llmClient.js";
import type { GameTranscript, ModelConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "..", "results");

export interface BenchmarkOptions {
  models: ModelConfig[];
  gameIds: number[];
  agent?: Partial<AgentOptions>;
}

export interface BenchmarkRow {
  model: string;
  gameId: number;
  solved: boolean;
  guessCount: number;
  llmCalls: number;
  totalTokens: number;
  totalCostUsd: number | null;
  wallClockMs: number;
  error?: string;
}

export async function runBenchmark(opts: BenchmarkOptions): Promise<GameTranscript[]> {
  await assertValidSlugs(opts.models.map((m) => m.slug));

  const jobs: Promise<GameTranscript>[] = [];
  for (const model of opts.models) {
    for (const gameId of opts.gameIds) {
      jobs.push(playGame(model, gameId, opts.agent));
    }
  }
  const results = await Promise.all(jobs);

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(RESULTS_DIR, `run-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(results, null, 2), "utf8");

  printReport(results, outFile);
  return results;
}

function printReport(results: GameTranscript[], outFile: string): void {
  const rows: BenchmarkRow[] = results.map((r) => ({
    model: r.model,
    gameId: r.gameId,
    solved: r.solved,
    guessCount: r.guessCount,
    llmCalls: r.llmCalls,
    totalTokens: r.totalUsage.totalTokens,
    totalCostUsd: r.totalCostUsd,
    wallClockMs: r.wallClockMs,
    error: r.error,
  }));

  rows.sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.gameId - b.gameId;
  });

  const header = ["model", "game", "solved", "guesses", "llmCalls", "tokens", "cost($)", "time(s)"];
  const widths = header.map((h) => h.length);
  const fmtRow = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  const dataRows = rows.map((r) => [
    r.model,
    String(r.gameId),
    r.solved ? "yes" : "no",
    String(r.guessCount),
    String(r.llmCalls),
    String(r.totalTokens),
    r.totalCostUsd === null ? "n/a" : r.totalCostUsd.toFixed(4),
    (r.wallClockMs / 1000).toFixed(1),
  ]);

  for (const row of dataRows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i]!, cell.length);
    });
  }

  console.log("");
  console.log(fmtRow(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of dataRows) console.log(fmtRow(row));

  console.log("");
  console.log("By model (averaged across games):");
  const byModel = new Map<string, BenchmarkRow[]>();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  for (const [model, rs] of byModel) {
    const solvedCount = rs.filter((r) => r.solved).length;
    const avgGuesses = rs.filter((r) => r.solved).reduce((a, r) => a + r.guessCount, 0) / Math.max(1, solvedCount);
    const totalCost = rs.reduce((a, r) => a + (r.totalCostUsd ?? 0), 0);
    console.log(
      `  ${model}: solved ${solvedCount}/${rs.length}, avg guesses when solved ${avgGuesses.toFixed(1)}, total cost $${totalCost.toFixed(4)}`
    );
  }

  console.log("");
  console.log("Guess-by-guess detail:");
  const sortedResults = [...results].sort((a, b) =>
    a.model !== b.model ? a.model.localeCompare(b.model) : a.gameId - b.gameId
  );
  for (const r of sortedResults) {
    console.log(`  ${r.model} (game ${r.gameId}):`);
    let n = 0;
    for (const g of r.guesses) {
      if (g.rejected) {
        console.log(`    - "${g.word}" (rejected: ${g.rejectReason})`);
      } else {
        n++;
        const mark = g.distance === 0 ? "  <-- SOLVED" : "";
        console.log(`    ${n}. ${g.word} -> ${g.distance}${mark}`);
      }
    }
  }

  console.log("");
  console.log(`Full transcripts written to ${outFile}`);
}
