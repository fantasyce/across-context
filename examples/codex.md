# Codex Setup

Codex reads repository instructions from `AGENTS.md` and can use the
`across-context` MCP server after setup.

Recommended one-command setup:

```bash
across-context setup --all --yes
```

Generate or refresh only the Codex project file:

```bash
across-context install codex --project .
```

The generated `AGENTS.md` tells Codex to search memory at task start and write
only durable preferences, decisions, commands, and compact session summaries
before final responses.

Commit `AGENTS.md` only after reviewing it and removing any private data. Keep
personal memories in the local vault unless the whole team should share them.
