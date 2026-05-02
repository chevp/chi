#!/usr/bin/env bash
# Glue script invoked by `.che/workflows/issue-fix.yml`.
# Args:
#   $1 = issue number
#   $2 = branch name (e.g. fix/issue-42)
#   $3 = absolute path to the assembled framework prompt
#
# Responsibilities:
#   1. Cut the fix branch via `chi flow` (which pulls main, checks out, writes marker).
#   2. Hand the prompt to `claude` in interactive mode so the user can drive the
#      CTX → EXP → PRD lifecycle with AskUserQuestion decisions.
# Ship/merge stay manual: the user runs `chi ship` / `chi done` themselves.

set -euo pipefail

NUM="${1:?issue number required}"
BRANCH="${2:?branch name required}"
PROMPT_FILE="${3:?prompt file path required}"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "issue-fix: prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

echo "── issue-fix: cutting branch $BRANCH for issue #$NUM ──"
chi flow "$BRANCH"

# Tag the flow marker with the issue number so `chi ship` injects "Closes #N"
# into the PR body and `chi done` can close the issue as a fallback.
GIT_DIR=$(git rev-parse --git-dir)
echo "issue=$NUM" >> "$GIT_DIR/chi-flow"

echo
echo "── issue-fix: launching claude with framework prompt ──"
echo "(prompt: $PROMPT_FILE)"
echo

# Pipe the prompt as the opening turn; claude continues interactively from there.
# `exec` is intentionally omitted so the chi parent regains control after claude
# exits — cmdFix then offers to chain `chi ship` + `chi done`.
claude < "$PROMPT_FILE"
