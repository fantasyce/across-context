#!/usr/bin/env bash
set -euo pipefail
CHECK_HOME="$(mktemp -d "${TMPDIR:-/tmp}/across-context-check.XXXXXX")"
trap 'rm -rf "$CHECK_HOME"' EXIT

echo "== whitespace =="
git diff --check

echo "== tests =="
npm test

echo "== cli smoke =="
ACROSS_HOME="$CHECK_HOME/across-home" node src/cli.js --help >/dev/null
ACROSS_HOME="$CHECK_HOME/across-home" node src/mcp-server.js --help >/dev/null

echo "== sensitive text scan =="
PATH_PATTERN='/U''sers/[^[:space:])]+'
TOKEN_PATTERN='(^|[^A-Za-z0-9_])(gho_''[A-Za-z0-9_]{20,}|sk-''[A-Za-z0-9_-]{20,})'
SENSITIVE_PATTERN="(${PATH_PATTERN}|${TOKEN_PATTERN})"
if command -v rg >/dev/null 2>&1; then
  if rg -n --hidden -g '!node_modules/**' -g '!.git/**' -g '!package-lock.json' "$SENSITIVE_PATTERN" .; then
    echo "Potential secret, private path, or signing metadata found." >&2
    exit 1
  fi
else
  if git grep -n -E "$SENSITIVE_PATTERN" -- .; then
    echo "Potential secret, private path, or signing metadata found." >&2
    exit 1
  fi
fi

echo "Across Context checks passed."
