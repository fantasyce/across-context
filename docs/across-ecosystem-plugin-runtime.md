# Across Context Ecosystem Plugin Runtime

Date: 2026-06-09

Across Context is the Across ecosystem shared-memory plugin. It must work as a
standalone CLI/MCP product and as a plugin discovered by Across Agents
Assistant.

## Runtime Shape

Across Context is MCP-first:

- `across-context mcp` exposes memory tools, resources, and prompts.
- CLI, hooks, dashboard, generated instructions, and future SDK calls use the
  same local vault.
- The default vault is `~/.across/data/across-context`.

`ACROSS_CONTEXT_HOME` remains an explicit override for tests, containers, and
advanced users.

## Plugin Installation

The default Across plugin install root is:

```text
~/.across/plugins/across-context
```

The stable wrapper command is:

```text
~/.across/bin/across-context
```

The plugin manifest lives at:

```text
~/.across/plugins/across-context/manifest.json
```

Host apps should discover the wrapper from `~/.across/bin` and should not point
at a source checkout, npm link, or path under `~/Documents`.

## Host Boundary

Across Context owns durable memory, memory lifecycle, search, governance, MCP
resources, MCP prompts, and dashboard review. A host owns UI, model execution,
tool approval, and permission prompts.

## Compatibility

Legacy `~/.across-context` memory is copied into the new data home when the new
data home is empty. The legacy directory is not deleted automatically.
