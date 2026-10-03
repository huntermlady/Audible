# audible-ai (Python)

Fact sheets, grounding, providers, the weekly report job, and the eval harness. The spec lives in
`shared/factsheet/SPEC.md`, and the weekly launchd job is described in `launchd/README.md`.

```bash
uv run python -m audible_ai reports --week auto            # needs Ollama (or [ai.batch] provider = "claude")
uv run python -m audible_ai reports --week 4 --provider fake   # deterministic dry run → ~/.cache/audible/fake-reports
uv run python -m audible_ai eval                            # live + batch configs → eval/results/<ts>.json
uv run python -m audible_ai eval --stage live --rate        # also record the owner's defensible y/n
uv run python ai/scripts/make_goldens.py                    # regenerate fact-sheet golden inputs
uv run python ai/scripts/make_fixture_reports.py            # regenerate shared/fixtures/reports
```

## Local Ollama setup (owner's Mac)

```bash
brew install ollama
brew services start ollama            # runs `ollama serve` at login, on http://localhost:11434
ollama pull qwen3:4b-instruct         # [ai.live]   ~2.5 GB
ollama pull qwen3:8b                  # [ai.batch]  ~5.2 GB; needs free disk for swap on an 8 GB Mac
curl -s localhost:11434/api/tags      # lists the installed models
```

### Letting the web app call Ollama: `OLLAMA_ORIGINS`

Ollama accepts browser requests only from allowed origins. The Audible site runs on three:

```
http://localhost:5173        # make web (vite dev)
http://localhost:4173        # make preview
https://huntermlady.github.io  # GitHub Pages
```

`brew services` starts Ollama as a LaunchAgent, which reads variables from the launchd user
environment. Set the origins there, then restart the service:

```bash
launchctl setenv OLLAMA_ORIGINS "http://localhost:5173,http://localhost:4173,https://huntermlady.github.io"
brew services restart ollama
```

`launchctl setenv` doesn't survive a reboot. To make it permanent, install the small LaunchAgent in
this repo. It sets the variable at every login, before Ollama starts:

```bash
cp ai/launchd/com.audible.ollama-env.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.audible.ollama-env.plist
```

Check it: `curl -si -H 'Origin: http://localhost:5173' localhost:11434/api/tags | grep -i access-control`
should print `Access-Control-Allow-Origin: http://localhost:5173`.

If you use the Ollama desktop app instead of `brew services`, the same `launchctl setenv` applies:
quit and reopen the app after setting it.

From the deployed HTTPS site, some browsers block calls to `http://localhost` (mixed content or
local-network-access rules). The app detects this and suggests `make preview`. In `auto` mode, it
falls back to the cloud Worker (`worker/`) when local Ollama isn't reachable.
