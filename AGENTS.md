# AGENTS.md

## Project Overview

Across Context is the local memory and policy layer for Across. It owns the
local vault, memory search, write policy, pending review, context packs, MCP
memory tools, and loop memory summaries.

Context does not own task execution, workflow supervision, model decisions,
merge authority, or release authority.

## Setup And Checks

```bash
npm install
bash scripts/check.sh
npm pack --dry-run --json
```

Useful CLI smoke checks:

```bash
node src/cli.js --help
node src/mcp-server.js --help
node src/cli.js agent-card --json
```

## Product Packaging Rules

- Present Context as local memory with policy, not as the whole Across product.
- Explain that memory writes can remain pending for human review.
- Explain that Autopilot can recall and write pending loop summaries through
  Context.
- Keep managed runtime and data paths under `~/.across`.

## Boundary Rules

- Do not store raw secrets or full transcripts as durable active memory.
- Do not execute tasks.
- Do not make model decisions.
- Do not grant merge, release, signing, or production authority.

## Important Files

- `src/mcp.js`: MCP server definition and tools
- `src/memory-policy.js`: sensitive memory classification and policy
- `src/vault.js`: local vault and lifecycle state
- `src/autopilot-loop-memory.js`: loop memory helpers
- `tests/`: Node test coverage
