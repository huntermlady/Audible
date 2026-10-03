# ADR 0006: Generate weekly reports in GitHub Actions

- **Status:** Accepted (2026-10-03, owner-approved). Supersedes the Mac launchd job as the default
  report runner (BUILD_PLAN §1 "Refresh", ADR 0004). The launchd job stays as an option.
- **Deciders:** owner

## Context

Game-plan reports (4 per game, about 64 per week in season) plus the Play-Caller samples were planned
to run every Tuesday night on the owner's M2 Mac through launchd. In practice, that ties a public
site's weekly content to one laptop. The Mac has to be awake and on power, Ollama has to be running,
and git credentials must work non-interactively. Any miss leaves the matchup pages stale for a week.
The batch model is now `qwen3:4b-instruct` (CONTRACT_CHANGES #21), which is small enough for a CPU.

GitHub-hosted runners are free for public repositories. `ubuntu-latest` has 4 vCPUs and 16 GB RAM,
has no GPU, and allows at most 6 hours per job.

## Decision

Add `.github/workflows/weekly-reports.yml`:

- **Schedule:** Wednesday 04:00 UTC (Tuesday night, US Eastern), plus `workflow_dispatch` with
  `week` and `games`. `games` is a smoke run of selected games without samples.
- **Steps:** get `data/` the same way `deploy.yml` does, which is the newest nightly artifact,
  otherwise `make data`. Install Ollama with the official script, cache the model directory keyed on
  the `[ai.batch].model` tag, and run `ollama serve` as the runner user. Then run the unchanged
  `audible_ai reports --provider ollama --out reports --skip-existing`.
- **Always save progress:** the generate step has a 320-minute timeout, under the 350-minute job
  limit. Steps marked `if: always()` then run the mock/fake-report guard, commit `reports/` as
  `github-actions[bot]` if anything changed, push to `main`, and dispatch `deploy.yml` explicitly,
  because pushes made with `GITHUB_TOKEN` don't trigger workflows. `reports.run` updates
  `index.json` after every report, so a partial commit is always consistent.
- **Observability:** the job summary shows a per-report timing table (count, passed/failed, average
  and max seconds) parsed from the CLI's timestamped log.

## Consequences

- Reports no longer depend on the Mac. The site refreshes on its own every week, at no cost.
- **CPU speed against the 6-hour cap is the main risk.** A 4B model on 4 vCPUs without a GPU is
  roughly several times slower than the M2's Metal GPU. Each report is a fact-sheet prompt of about
  2k tokens plus several hundred output tokens in JSON mode, with up to one validation retry. Whether a
  full week (about 64 reports plus samples) fits is **unmeasured** until the first smoke run
  (`gh workflow run weekly-reports.yml -f games=<one game_id>`). Mitigations, in order:
  1. `--skip-existing` plus the always-commit steps, so a timed-out run keeps its work, and a second
     run the same day finishes the rest. A follow-up cron (for example Wednesday 10:00 UTC) can do
     this automatically if needed.
  2. Split the week across a job matrix by game, each job with its own 6 hours, committing in turn.
  3. Switch `[ai.batch]` to the cloud Worker (`--provider cloud`, ADR 0005). That spends the shared
     daily Workers AI quota, which is why it isn't the default.
  4. Fall back to the Mac launchd job.
- The Ollama model (about 2.5 GB) is cached between runs. A cache miss adds a pull of a few minutes.
- `github-actions[bot]` pushes to `main`. Branch protection on `main` has to allow it.
- Report quality is unchanged: it's the same model, prompts, validation and grounding as on the
  Mac. Runner output is still non-deterministic between runs.
- Don't run the launchd job and the Action in the same week, because they would race to push
  `reports/`.
