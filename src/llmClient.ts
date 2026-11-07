import type { Pricing, TokenUsage } from "./types.js";

const BASE = "https://api.experientiallabs.ai/v1";
const CATALOG_URL = "https://api.experientiallabs.ai/api/models";

function apiKey(): string {
  const key = process.env.EXPLABS_API_KEY;
  if (!key) {
    throw new Error(
      "EXPLABS_API_KEY is not set. Copy .env.example to .env and add your Experiential Labs key."
    );
  }
  return key;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  usage: TokenUsage;
}

export interface CallOptions {
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  temperature?: number;
  tags?: Record<string, string>;
}

/** Minimal OpenAI-compatible client for the Experiential Labs gateway. */
export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: CallOptions = {}
): Promise<ChatResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
  if (opts.tags) headers["X-Explabs-Tags"] = JSON.stringify(opts.tags);

  const body: Record<string, unknown> = {
    model,
    messages,
    response_format: { type: "json_object" },
  };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Experiential Labs request failed (${res.status}) for model ${model}: ${text}`);
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  const u = json.usage ?? {};
  return {
    content,
    usage: {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    },
  };
}

interface CatalogEntry {
  model: { slug: string; status: string; maker?: string | null };
  providers: {
    input_nano_usd_per_million?: number | null;
    output_nano_usd_per_million?: number | null;
  }[];
}

let catalogCache: Map<string, Pricing> | null = null;
let validSlugsCache: Set<string> | null = null;

async function loadCatalog(): Promise<{ pricing: Map<string, Pricing>; slugs: Set<string> }> {
  if (catalogCache && validSlugsCache) return { pricing: catalogCache, slugs: validSlugsCache };
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Failed to fetch model catalog (${res.status})`);
  const json = (await res.json()) as { models: CatalogEntry[] };

  const pricing = new Map<string, Pricing>();
  const slugs = new Set<string>();
  for (const entry of json.models) {
    if (entry.model.status !== "active") continue;
    slugs.add(entry.model.slug);
    const provider = entry.providers?.[0];
    const inputNano = provider?.input_nano_usd_per_million;
    const outputNano = provider?.output_nano_usd_per_million;
    pricing.set(entry.model.slug, {
      inputUsdPerMillion: typeof inputNano === "number" ? inputNano / 1e9 : null,
      outputUsdPerMillion: typeof outputNano === "number" ? outputNano / 1e9 : null,
    });
  }
  catalogCache = pricing;
  validSlugsCache = slugs;
  return { pricing, slugs };
}

export async function getPricing(slug: string): Promise<Pricing> {
  const { pricing } = await loadCatalog();
  return pricing.get(slug) ?? { inputUsdPerMillion: null, outputUsdPerMillion: null };
}

export async function assertValidSlugs(slugs: string[]): Promise<void> {
  const { slugs: valid } = await loadCatalog();
  const unknown = slugs.filter((s) => !valid.has(s));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown model slug(s): ${unknown.join(", ")}. Run "npm run models" to see the live catalog.`
    );
  }
}

export function estimateCostUsd(usage: TokenUsage, pricing: Pricing): number | null {
  if (pricing.inputUsdPerMillion === null || pricing.outputUsdPerMillion === null) return null;
  return (
    (usage.promptTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (usage.completionTokens / 1_000_000) * pricing.outputUsdPerMillion
  );
}

export async function fetchCatalogForDisplay(): Promise<CatalogEntry[]> {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Failed to fetch model catalog (${res.status})`);
  const json = (await res.json()) as { models: CatalogEntry[] };
  return json.models.filter((m) => m.model.status === "active");
}
