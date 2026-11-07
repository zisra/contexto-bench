# contexto-bench

```npm run bench -- --game 1506 --models gpt-6-luna,kimi-k3,glm-5.3-flash,glm-5.3-flash-uncensored --max-guesses 150 --candidates 6```

A TypeScript environment + benchmark harness for testing LLMs on [Contexto](https://contexto.me)
(the daily word-guessing game), with models accessed through the
[Experiential Labs](https://www.experientiallabs.ai/) multi-provider gateway.

It does two things:

1. **Gives an LLM a strategy that's actually good at Contexto**, not just a raw loop of
   "guess a word, see the rank." See [How the agent plays](#how-the-agent-plays).
2. **Benchmarks several models side by side** on the same game, reporting solve rate,
   guesses-to-solve, token usage, and dollar cost per model.

## Setup

```bash
npm install
cp .env.example .env   # add your Experiential Labs key (starts with xpl_)
```

## Usage

```bash
# See the live model catalog (slug, maker, $/M tokens) — no API key needed
npm run models

# Benchmark the default roster (config/models.json) against one game
npm run bench -- --game 1721

# Benchmark specific models against multiple games (averages the results per model)
npm run bench -- --game 1721,1722,1723 --models claude-haiku-5.5,gpt-6-luna,kimi-k3

# Tune the agent
npm run bench -- --game 1721 --max-guesses 40 --candidates 6 --opening 6
```

### Picking a game id

The path segment in the Contexto API (`.../game/{id}/{word}`) is just the puzzle's day
number. **Use a recent/today's id from [contexto.me](https://contexto.me).** Old puzzles'
answers get posted online (word lists, solver threads, etc.), so an old game id risks
testing a model's memorization of leaked answers rather than its actual reasoning — that
would invalidate the benchmark.

## How the agent plays

Contexto only ever tells you a guess's *rank* (0 = the secret word; lower = closer in
embedding space). The design goals were: get good at this with as few, as cheap, LLM calls
as possible.

- **Opening book, not an LLM call.** The first few guesses (`time`, `people`, `water`,
  `money`, `house`, ...) are a fixed list of common, semantically diverse words — a known
  human Contexto strategy for cheaply figuring out the target's neighborhood before there's
  any history to reason from. Zero tokens spent on guesses that don't need intelligence yet.
- **Batched candidates, not one guess per call.** Each LLM call asks for several ranked
  candidate words at once (`--candidates`, default 6). The harness consumes them one at a
  time against the real Contexto API and only calls the model again once the batch is used
  up or a repeat gets filtered out — this alone cuts LLM calls by roughly the batch size
  compared to a naive "one guess, one call" loop.
  Rejected words (stopwords, unknown words) don't cost a scored guess, matching real
  Contexto's counter, and don't trigger a re-call either — they're just skipped.
- **Bounded context, not full history.** Each prompt shows only the top-K closest guesses
  (`--topKShown` via code, default 25) and a few recent ones, not the full growing guess
  list — this keeps prompt size roughly flat as the game goes long instead of growing
  unboundedly with guess count. Exact-repeat filtering is done in code (a `Set`), not by
  asking the model to remember everything it has tried.
- **Low reasoning effort by default.** This task is word-association, not multi-step logic;
  `reasoning_effort: "low"` is the default per model (overridable in `config/models.json`).
- **Disk cache for Contexto lookups.** A given `(gameId, word)` answer never changes, so
  it's cached in `.cache/game-<id>.json`, shared across all models in a run and across
  reruns. This matters once several models are guessing against the same game — they
  naturally probe many of the same common words.

## Benchmarking multiple models

Models run **concurrently** (each model's own rate limit is separate on Experiential
Labs' free tier: 10 req/min, 250K tokens/min, 1M tokens/day per model). Every game run
produces a full JSON transcript in `results/run-<timestamp>.json` (every guess, every LLM
call's token usage/cost/candidates) plus a console summary table and a per-model rollup
averaged across games.

Cost is computed from Experiential Labs' live public pricing catalog (`GET /api/models`),
not hardcoded — `npm run models` always reflects current prices. Per-run, requests are
tagged via `X-Explabs-Tags` (`app`, `model`, `game`) so you can also cross-check spend in
the Experiential Labs dashboard.

Edit `config/models.json` to change the default roster, or pass `--models` on the CLI.
Unknown slugs fail fast with a pointer to `npm run models` rather than silently erroring
mid-benchmark.

## Project layout

```
src/
  contextoClient.ts  Contexto API wrapper + disk cache lookups
  cache.ts            Shared, write-serialized disk cache per game id
  llmClient.ts        Experiential Labs chat client, pricing/catalog lookups
  openingBook.ts       Fixed free opening guesses
  agent.ts            The actual play-one-game strategy
  benchmark.ts         Runs N models x M games, writes transcripts, prints report
  cli.ts                CLI entry point (npm run bench)
  listModels.ts        CLI entry point (npm run models)
config/models.json      Default model roster for the benchmark
results/                 JSON transcripts (gitignored)
.cache/                   Contexto answer cache per game id (gitignored)
```
