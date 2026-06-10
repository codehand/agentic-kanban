#!/usr/bin/env bash
# install.sh — wire the .ai/ workflow engine into this repo's Claude Code setup.
# Idempotent: copies subagents + slash commands into .claude/, merges the PreToolUse
# hook into .claude/settings.json, and creates the instance-data folders.
# Run from anywhere inside the repo: bash .ai/install.sh
set -uo pipefail

AI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../.ai
ROOT="$(cd "$AI/.." && pwd)"                          # repo root
CLAUDE="$ROOT/.claude"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }

echo "Installing AI workflow engine into: $ROOT"

# 1) subagents + slash commands (overwrite our files; leave any others untouched)
mkdir -p "$CLAUDE/agents" "$CLAUDE/commands"
cp "$AI"/claude/agents/*.md    "$CLAUDE/agents/"
cp "$AI"/claude/commands/*.md  "$CLAUDE/commands/"
echo "  ✓ agents  -> .claude/agents/   ($(ls "$AI"/claude/agents | wc -l | tr -d ' ') files)"
echo "  ✓ commands-> .claude/commands/ ($(ls "$AI"/claude/commands | wc -l | tr -d ' ') files)"

# 2) merge the PreToolUse hook into .claude/settings.json (preserve existing keys/hooks)
SETTINGS="$CLAUDE/settings.json"
HOOK="$AI/claude/settings.hook.json"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
tmp="$(mktemp)"
# Append our hook block only if an identical matcher+command isn't already present.
jq --slurpfile h "$HOOK" '
  ($h[0].hooks.PreToolUse[0]) as $new
  | .hooks //= {}
  | .hooks.PreToolUse //= []
  | if (.hooks.PreToolUse | any(.hooks[]?.command == ($new.hooks[0].command)))
    then .
    else .hooks.PreToolUse += [$new]
    end
' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
echo "  ✓ hook merged into .claude/settings.json"

# 3) make scripts executable + create instance-data folders
chmod +x "$AI"/scripts/*.sh
mkdir -p "$AI/tasks" "$AI/state" "$AI/evidence" "$AI/reports"
echo "  ✓ scripts executable; instance folders ready"

echo
echo "Done. Open a NEW Claude Code session so the hook loads, then:"
echo "  /newtask <title>     # create a task"
echo "  /impl /selfcheck /judge <TASK-ID>"
echo "  .ai/scripts/gate.sh approve <TASK-ID>   # human only"
