#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
bun install --frozen-lockfile
claude plugin marketplace add cniska/agent-skills
claude plugin install cniska-skills@cniska
