# Across Context

One memory layer for every coding agent.

Across Context is a local-first context vault for developers who move between
Codex, Claude Code, Cursor, local agents, and future A2A agents. It keeps user
preferences, project knowledge, historical decisions, commands, and session
summaries in one portable vault, then exposes that context through a CLI, a
lightweight MCP stdio server, and generated instruction files.

## Why

Coding agents are getting better quickly, but each agent keeps its own memory.
When you switch tools, useful context gets trapped in one chat history or one
IDE. Across Context gives every agent the same local source of truth:

- what the user prefers
- how the repo is built and tested
- which architectural decisions were already made
- which folders or workflows are risky
- what the last agent learned during a task

The vault stays local by default. Export files are explicit and reviewable.

## Install

This MVP has no runtime npm dependencies.

```bash
npm install -g @across/context
```

For local development from this repository:

```bash
npm link
```

## Quick Start

Create the local vault:

```bash
across-context init
```

Remember a global preference:

```bash
across-context remember "Prefer small commits with tests." --type preference
```

Remember project-specific context:

```bash
across-context remember "Run npm test before final answers." --scope project --project . --type command
```

Learn project metadata:

```bash
across-context project learn .
```

Search memory:

```bash
across-context search "tests before final" --project .
```

Generate instruction files:

```bash
across-context export agents --project .
across-context export claude --project .
across-context export cursor --project .
```

Install agent integrations:

```bash
across-context install codex --project .
across-context install cursor --project .
across-context install claude-code --stdout
```

## Agent Setup

### Codex

Codex reads repository instructions from `AGENTS.md`.

```bash
across-context install codex --project .
```

Review the generated file before committing it. Keep private preferences in the
local vault unless the whole team should share them.

### Claude Code

Claude Code can use Across Context through MCP:

```bash
across-context install claude-code --stdout
```

Run the printed command to add the MCP server.

### Cursor

Cursor can use the MCP server with a project config similar to:

```json
{
  "mcpServers": {
    "across-context": {
      "command": "across-context",
      "args": ["mcp"]
    }
  }
}
```

Create the MCP config and a Cursor rule file:

```bash
across-context install cursor --project .
```

## MCP Tools

The MCP server exposes:

- `remember_context` - store a preference, decision, note, command, or session summary
- `search_context` - search global and project memory
- `get_project_context` - render an AGENTS.md-style project context document
- `export_agent_instructions` - write AGENTS.md, CLAUDE.md, Cursor rules, or Markdown exports

Start it manually:

```bash
across-context mcp
```

## Vault Layout

By default, the vault lives outside source control under the user's home
directory:

```text
.across-context/
  global/
    memories.jsonl
  projects/
    <project-id>/
      profile.json
      memories.jsonl
```

For tests or isolated runs, set:

```bash
ACROSS_CONTEXT_HOME=/tmp/across-context-demo across-context init
```

## Privacy Model

- The vault is local-first and not synced by this package.
- Public exports never include absolute project paths.
- Generated files should be reviewed before committing.
- Do not store API keys, tokens, credentials, private screenshots, or secrets.

## Development

Run the full local check:

```bash
bash scripts/check.sh
```

Run tests only:

```bash
npm test
```
