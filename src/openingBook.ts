/**
 * Common, semantically diverse concrete nouns used as free opening guesses before any
 * LLM call. Contexto's secret word is always a common dictionary word, and these probes
 * are a well-known community strategy for cheaply triangulating the target's domain
 * (person/place/object/emotion/action/...) without spending a model call on guesses that
 * don't yet have any history to reason from.
 */
export const OPENING_BOOK: readonly string[] = [
  "time",
  "people",
  "water",
  "money",
  "house",
  "animal",
  "love",
  "music",
  "computer",
  "food",
];
