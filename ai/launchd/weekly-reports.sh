#!/usr/bin/env bash
# Weekly game-plan report job (run by launchd, Tuesday 23:00 local). See ai/launchd/README.md.
# Refresh data → generate reports with the local model → commit and push reports/.
# Exits 0 with a logged message when Ollama is not running.
set -euo pipefail

REPO="${AUDIBLE_REPO:-$HOME/Projects/Audible}"
OLLAMA_URL="${AUDIBLE_OLLAMA_URL:-http://localhost:11434}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/audible"

log() { printf '%s [weekly-reports] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

cd "$REPO"
log "start (repo $REPO)"

provider="$(uv run python -c 'from audible_ai.config import load_config; print(load_config().batch.provider)')"
if [[ "$provider" == "ollama" ]] && ! curl -sf --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null; then
  log "Ollama is not running at $OLLAMA_URL; skipping this week's reports. Run 'make reports' manually later."
  exit 0
fi

if [[ -n "$(git status --porcelain -- reports)" ]]; then
  log "reports/ has uncommitted changes; refusing to run over them. Commit or discard them first."
  exit 1
fi
git pull --ff-only

# Prefer the nightly CI data artifact (fast); fall back to building data locally.
if command -v gh >/dev/null 2>&1 && run_id="$(gh run list --workflow nightly-data.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)" && [[ -n "$run_id" ]]; then
  log "downloading data artifact from nightly-data run $run_id"
  rm -rf data.new && gh run download "$run_id" --name data --dir data.new && rm -rf data && mv data.new data
else
  log "no data artifact available; running make data"
  make data
fi

make reports WEEK=auto

if [[ -z "$(git status --porcelain -- reports)" ]]; then
  log "no report changes to commit"
  exit 0
fi
week="$(uv run python -c 'import json; m=json.load(open("data/manifest.json")); print(f"{m[\"current_season\"]} week {m[\"current_week\"]}")')"
git add reports
git commit -m "reports: $week game plans"
git push
log "pushed reports for $week"
