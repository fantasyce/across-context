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

The repository is currently a private preview and the package is not published
to npm yet. Install from a private checkout:

```bash
gh repo clone fantasyce/across-context
cd across-context
npm link
```

Or install a local tarball:

```bash
npm pack
npm install -g ./across-context-0.1.0.tgz
```

After installation, verify:

```bash
across-context --help
```

## Quick Start

Run one command from a project directory:

```bash
across-context setup --all --yes
```

This creates the local vault, detects supported local agents, registers the MCP
server where possible, and writes project instruction files such as
`AGENTS.md`, `CLAUDE.md`, and Cursor rules. If you want to generate project
files without changing user-level agent configuration, run:

```bash
across-context setup --all --yes --no-external
```

Verify the installation:

```bash
across-context doctor
across-context status
```

Add a durable user preference:

```bash
across-context remember "Prefer small commits with tests." --type preference
```

Add project-specific context:

```bash
across-context remember "Run npm test before final answers." --scope project --project . --type command
```

Search, list, and manage memory:

```bash
across-context search "tests before final" --project .
across-context list
across-context stats
across-context compact
```

## Automated Agent Behavior

Across Context installs more than MCP plumbing. Generated agent instruction
files include behavior rules that tell agents when to use the memory layer:

- Task start memory lookup: search relevant global and project memory before planning or editing.
- During work: use project context before architecture, release, dependency, test, or documentation decisions.
- Before final response memory write: store only durable user preferences, project decisions, reusable commands, and compact session summaries.
- Never write secrets, API keys, tokens, credentials, cookies, huge logs, full chat history, temporary errors, private screenshots, or one-off noise.

This means users should not need to remind every agent in natural language on
every task. MCP provides the tools; generated rules teach the agent when to use
them; the memory policy protects the vault from low-value or unsafe writes.

## Agent Setup

The one-command setup path supports:

| Agent | Setup behavior |
| --- | --- |
| Codex | Writes `AGENTS.md` and runs `codex mcp add across-context -- across-context mcp` when available. |
| Claude Code | Writes `CLAUDE.md` and runs `claude mcp add -s user across-context -- across-context mcp` when available. |
| Cursor | Writes `.cursor/mcp.json` and `.cursor/rules/across-context.mdc`. |
| Hermes | Runs `hermes mcp add across-context --command across-context --args mcp` when available. |
| OpenClaw | Runs `openclaw mcp set across-context '{"command":"across-context","args":["mcp"]}'` when available. |

Manual commands are still available:

```bash
across-context install codex --project .
across-context install cursor --project .
across-context install claude-code --stdout
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

## Memory Policy

All CLI and MCP writes go through the same policy engine before they reach the
vault.

Allowed memory types:

- `preference` - stable user preferences
- `decision` - durable project or architecture decisions
- `command` - reusable build, test, release, or troubleshooting commands
- `session` - compact handoff summaries
- `note` - short durable context that does not fit the categories above

Rejected or controlled writes:

- Secrets and credentials are rejected before writing.
- Duplicate memories return the existing entry instead of appending another line.
- Long memories are trimmed to a safe default length.
- `compact` removes duplicate records already on disk.
- `forget <id>` removes a memory by id.

The goal is to make automatic memory useful without letting agents store full
chat histories, huge logs, temporary errors, or private credentials.

## Privacy Model

- The vault is local-first and not synced by this package.
- Public exports never include absolute project paths.
- Generated files should be reviewed before committing.
- Do not store API keys, tokens, credentials, private screenshots, or secrets.
- Use `--no-external` when you want project files without changing user-level agent settings.

## Development

Run the full local check:

```bash
bash scripts/check.sh
```

Run tests only:

```bash
npm test
```
