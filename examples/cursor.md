# Cursor Setup

Recommended one-command setup:

```bash
across-context setup --all --yes
```

This writes:

```text
.cursor/mcp.json
.cursor/rules/across-context.mdc
```

The Cursor rule is always applied. It tells Cursor to search Across Context
memory before planning or editing, and to write only durable preferences,
project decisions, reusable commands, and compact session summaries.

Manual project setup:

```bash
across-context install cursor --project .
```

