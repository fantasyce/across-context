#!/usr/bin/env bash
set -euo pipefail

echo "== whitespace =="
git diff --check

echo "== tests =="
npm test

echo "== cli smoke =="
node src/cli.js --help >/dev/null
node src/mcp-server.js --help >/dev/null

echo "== sensitive text scan =="
PATH_PATTERN='/U''sers/[^[:space:])]+'
TOKEN_PATTERN='gho_''[A-Za-z0-9_]+|sk-''[A-Za-z0-9_-]+'
KEY_PATTERN='OPENAI_''API_KEY|ANTHROPIC_''API_KEY|DEEPSEEK_''API_KEY|MINIMAX_''API_KEY'
SENSITIVE_PATTERN="(${PATH_PATTERN}|${TOKEN_PATTERN}|${KEY_PATTERN})"
if command -v rg >/dev/null 2>&1; then
  ! rg -n --hidden -g '!node_modules/**' -g '!.git/**' -g '!package-lock.json' "$SENSITIVE_PATTERN" .
else
  ! git grep -n -E "$SENSITIVE_PATTERN" -- .
fi

echo "Across Context checks passed."
