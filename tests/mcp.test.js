import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createContextMcpServerDefinition } from "../src/mcp.js";
import { ContextVault } from "../src/vault.js";

test("MCP server definition exposes memory tools backed by the vault", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);

  assert.deepEqual(
    definition.tools.map((tool) => tool.name).sort(),
    [
      "approve_memory",
      "export_agent_instructions",
      "get_agent_card",
      "get_project_context",
      "remember_context",
      "review_pending_memories",
      "search_context"
    ]
  );
  const remember = definition.tools.find((tool) => tool.name === "remember_context");
  const result = await remember.handler({
    text: "Prefer readable diffs.",
    scope: "global",
    type: "preference"
  });

  assert.match(JSON.stringify(result), /Prefer readable diffs/);
});
