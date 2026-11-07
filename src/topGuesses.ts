import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameTranscript } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "..", "results");
const TOP_N = 5;

async function latestResultFile(): Promise<string> {
  const files = (await fs.readdir(RESULTS_DIR)).filter((f) => f.startsWith("run-") && f.endsWith(".json"));
  if (files.length === 0) throw new Error(`No result files in ${RESULTS_DIR} yet.`);
  files.sort(); // ISO timestamps in the filename sort chronologically
  return path.join(RESULTS_DIR, files[files.length - 1]!);
}

function padRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
}

async function main(): Promise<void> {
  const file = await latestResultFile();
  const results = JSON.parse(await fs.readFile(file, "utf8")) as GameTranscript[];

  const header = ["model", "game", "status", ...Array.from({ length: TOP_N }, (_, i) => `#${i + 1}`)];
  const rows = results.map((r) => {
    const best = r.guesses
      .filter((g) => !g.rejected && g.distance !== null)
      .sort((a, b) => (a.distance as number) - (b.distance as number))
      .slice(0, TOP_N)
      .map((g) => `${g.word}(${g.distance})`);
    while (best.length < TOP_N) best.push("");
    const status = r.solved ? "solved" : `${r.guessCount}/${r.error ? "capped" : "?"}`;
    return [r.model, String(r.gameId), status, ...best];
  });

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));

  console.log(`Top ${TOP_N} closest guesses per model (from ${path.basename(file)}):\n`);
  console.log(padRow(header, widths));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(padRow(row, widths));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
