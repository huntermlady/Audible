# Weekly report job (launchd)

Every Tuesday at 23:00 local time, `weekly-reports.sh`:

1. If `[ai.batch].provider` is `ollama`, checks that Ollama answers at `http://localhost:11434/api/tags`. If it doesn't, it logs
   `Ollama is not running … skipping` and exits 0. Reports then go stale gracefully until the
   next run, or until you run `make reports` by hand.
2. Stops if `reports/` has uncommitted changes, then runs `git pull --ff-only`.
3. Refreshes `data/`. It downloads the newest successful `nightly-data.yml` artifact with `gh`. If
   `gh` isn't installed or authenticated, it runs `make data` instead.
4. Runs `make reports WEEK=auto`: 4 reports per game in `manifest.current_week`, plus
   `reports/samples/playcaller.json`.
5. Commits `reports/` (`reports: 2026 week 4 game plans`) and pushes it. The push triggers the
   deploy.

Output goes to `~/Library/Logs/audible-reports.log`.

## Install

```bash
ollama pull qwen3:8b                 # the [ai.batch] model in config.toml
ai/launchd/install.sh                # renders the plist into ~/Library/LaunchAgents and loads it
launchctl kickstart -k gui/$(id -u)/com.audible.weekly-reports   # optional: run once now
tail -f ~/Library/Logs/audible-reports.log
```

Uninstall with `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.audible.weekly-reports.plist`.

The repo path defaults to the checkout that `install.sh` lives in. The script also honors
`AUDIBLE_REPO` and `AUDIBLE_OLLAMA_URL`.

## Git credentials for the unattended push

launchd jobs run without your terminal's environment. The push must work non-interactively:

- **SSH (recommended):** make sure `origin` uses `git@github.com:…`. Add the key to the macOS
  keychain so no passphrase prompt blocks the job:
  ```bash
  ssh-add --apple-use-keychain ~/.ssh/id_ed25519
  ```
  Then add this to `~/.ssh/config`:
  ```
  Host github.com
    AddKeysToAgent yes
    UseKeychain yes
    IdentityFile ~/.ssh/id_ed25519
  ```
- **HTTPS:** use the keychain credential helper (`git config --global credential.helper
  osxkeychain`) with a fine-grained token that has `contents: write` on the repo. Alternatively,
  run `gh auth setup-git` after `gh auth login`.
- `gh` needs to be logged in (`gh auth status`) for the artifact download. The job falls back to
  `make data` when it isn't.

Check the setup once by hand before relying on the schedule:
`GIT_TERMINAL_PROMPT=0 git push --dry-run` must succeed without prompting.

## Notes

- The Mac has to be awake at 23:00 on Tuesday. launchd runs a missed calendar job when the Mac wakes.
- To switch the batch stage to Claude, set `[ai.batch] provider = "claude"` in `config.toml` and put
  `ANTHROPIC_API_KEY` in `.env` or in the plist's `EnvironmentVariables`. The Ollama check in step 1
  is skipped for non-Ollama providers. Spend is capped by `[ai.claude].max_daily_usd` and tracked in
  `~/.cache/audible/claude_spend.json`.
