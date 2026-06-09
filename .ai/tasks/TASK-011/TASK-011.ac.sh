#!/usr/bin/env bash
# Machine-verifiable AC for TASK-011 (P9: Hardening, docs, deploy v1).
# Exit 0 = all AC met; non-zero = fail. Faithful to docs/phases/P9.md + TASK_HUB_DESIGN.md §13/§2/§3.
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree with task code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

# AC3: README quickstart + backup/deploy reference.
if [ -f README.md ]; then
  grep -qiE 'quick[ -]?start|getting started' README.md || { echo "AC3: README.md has no quickstart section"; fail=1; }
  grep -qiE 'backup|deploy' README.md || { echo "AC3: README.md missing backup/deploy reference"; fail=1; }
else
  echo "AC3: README.md missing"; fail=1
fi

# AC4: runbook.
[ -f docs/RUNBOOK.md ] || { echo "AC4: docs/RUNBOOK.md missing"; fail=1; }

# AC5: structured transition logging via pino (actor, from->to, evidence_ref).
LOG="server/src/logger.ts"
if [ -f "$LOG" ]; then
  grep -qiF 'pino' "$LOG" || { echo "AC5: logger.ts does not reference pino"; fail=1; }
else
  echo "AC5: server/src/logger.ts missing"; fail=1
fi
# transition log fields referenced somewhere in server/src (logger or gate call site).
if [ -d server/src ]; then
  grep -rqiE 'actor' server/src --include='*.ts' || { echo "AC5: 'actor' not referenced in transition logging"; fail=1; }
  grep -rqiE 'evidence_ref|evidence_id|evidenceRef' server/src --include='*.ts' || { echo "AC5: evidence_ref not referenced in logging"; fail=1; }
  grep -rqiE 'from.*to|from_state|fromState|from→to' server/src --include='*.ts' || { echo "AC5: from->to not referenced in logging"; fail=1; }
fi

# AC6: graceful shutdown closing DB + basic input limits in http server.
SRV="server/src/http/server.ts"
if [ -f "$SRV" ]; then
  grep -qiE 'SIGTERM|SIGINT' "$SRV" || { echo "AC6: server.ts has no SIGTERM/SIGINT handler"; fail=1; }
  grep -qiE '\.close\(' "$SRV" || { echo "AC6: server.ts does not close the DB on shutdown"; fail=1; }
  grep -qiE 'limit|maxBody|max-body|content-length|rate' "$SRV" || { echo "AC6: server.ts has no input/size limit"; fail=1; }
else
  echo "AC6: server/src/http/server.ts missing"; fail=1
fi

# AC7: deploy/ with systemd unit and/or Dockerfile.
if [ -d deploy ]; then
  if ! ls deploy/*.service deploy/Dockerfile deploy/*Dockerfile* 2>/dev/null | grep -q .; then
    echo "AC7: deploy/ has no systemd unit (*.service) or Dockerfile"; fail=1
  fi
else
  echo "AC7: deploy/ directory missing"; fail=1
fi

# AC8: a test asserting graceful shutdown closes DB without corruption.
SHUT="$(grep -rliE 'shutdown|graceful' server --include='*.test.ts' 2>/dev/null || true)"
[ -n "$SHUT" ] || { echo "AC8: no graceful-shutdown test (*.test.ts) under server/"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P9 README+runbook, pino transition logs, graceful shutdown + input limits, deploy unit, shutdown test present"
  exit 0
else
  echo "AC FAILED (TASK-011 not yet implemented — expected until P9 is built)"
  exit 1
fi
