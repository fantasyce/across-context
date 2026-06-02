# Claude Code Setup

Recommended one-command setup:

```bash
across-context setup --all --yes
```

This writes `CLAUDE.md` for the current project and registers Across Context as
a user-level MCP server when Claude Code is available.

Manual MCP setup:

```bash
across-context install claude-code --stdout
```

Run the printed command. The generated `CLAUDE.md` tells Claude to search memory
at task start and remember only durable context before final responses. Secrets,
tokens, huge logs, and one-off temporary details should not be written.
