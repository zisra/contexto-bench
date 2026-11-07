import "dotenv/config";
import { fetchCatalogForDisplay } from "./llmClient.js";

async function main(): Promise<void> {
  const models = await fetchCatalogForDisplay();
  models.sort((a, b) => {
    const pa = a.providers?.[0]?.input_nano_usd_per_million ?? 0;
    const pb = b.providers?.[0]?.input_nano_usd_per_million ?? 0;
    return pa - pb;
  });
  console.log(`${models.length} active models available (slug, maker, $/M input, $/M output):\n`);
  for (const m of models) {
    const p = m.providers?.[0];
    const inUsd = p?.input_nano_usd_per_million != null ? (p.input_nano_usd_per_million / 1e9).toFixed(3) : "n/a";
    const outUsd = p?.output_nano_usd_per_million != null ? (p.output_nano_usd_per_million / 1e9).toFixed(3) : "n/a";
    console.log(`${m.model.slug.padEnd(32)} ${(m.model.maker ?? "?").padEnd(12)} $${inUsd.padEnd(8)} $${outUsd}`);
  }
  console.log("\nUse any of these slugs in config/models.json or via --models on the CLI.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
