#!/usr/bin/env bash
# Install (or reinstall) the weekly report LaunchAgent for the current user.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
dest="$HOME/Library/LaunchAgents/com.audible.weekly-reports.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s#__REPO__#$repo#g" -e "s#__HOME__#$HOME#g" "$repo/ai/launchd/com.audible.weekly-reports.plist" > "$dest"
plutil -lint "$dest"
launchctl bootout "gui/$(id -u)" "$dest" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$dest"
echo "Installed $dest (runs Tuesdays 23:00; log: ~/Library/Logs/audible-reports.log)"
