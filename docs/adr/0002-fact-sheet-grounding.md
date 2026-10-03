# ADR 0002: Grounding AI output in a fact sheet

- **Status:** Accepted (2026-09-25)
- **Deciders:** owner; build plan §4.2, §5.3–5.5

## Context

The AI coordinators run on small local models (a 4B/8B Qwen on an 8 GB M2). These models are fluent
but will make up statistics. A football analytics site loses all credibility the first time it shows
an invented "68% blitz rate". The prompt also has to stay small for latency, and the same rules must
hold for live calls in the browser (TypeScript) and weekly reports (Python).

## Decision

Numbers come from the data, never from the model:

1. For each request, a deterministic **fact sheet** builder turns `(situation | matchup | team, data
   tables)` into a compact list of facts. Each fact has a stable ID, a value, a preformatted
   `display`, a sample size `n`, and the league comparison. The builder is implemented twice
   (`ai/…/factsheet.py`, `web/src/ai/factsheet.ts`) against one spec (`shared/factsheet/SPEC.md`),
   and **both** implementations pass the same golden fixtures in CI.
2. The model gets the fact sheet and must return **schema-valid JSON** that cites fact IDs
   (Ollama's `format` = the response JSON Schema).
3. Validation runs in three steps: JSON Schema, then every cited ID exists, then a **number-grounding
   check** in which every number in model-authored text must match a fact's `display`/`value`/
   `league_display`/`n`, a `Situation` value, a down/quarter ordinal, or the season
   (`shared/factsheet/SPEC.md` §11). On failure it retries once with the errors
   appended. A second failure produces an error state (live) or a hidden `validation_status: "failed"`
   report (batch).
4. The UI renders stat values by looking up cited IDs in the fact sheet, as chips that open the
   underlying chart. Chat is free text, so ungrounded numbers there are highlighted rather than
   blocked.

## Consequences

- There are zero ungrounded numbers in structured output, and this is enforced by code rather than
  by the prompt. `make eval` measures it on 12 scenarios.
- Keeping the two implementations in parity is a real cost. The shared golden fixtures are the guard
  against drift.
- Some correct model answers are rejected, for example derived numbers that aren't in the sheet. The
  retry and "allowed forms" list keep that rare, and the eval tracks it.
- Optional data that's missing for a season (such as 2026 pressure/coverage) is left out of the fact
  sheet instead of guessed, so the model can't cite it.
- If a stage fails the eval bar, it can switch to Claude without changing any of the above (provider
  interface, `config.toml`).
