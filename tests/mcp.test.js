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

test("MCP server definition exposes resources and prompts", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-surfaces-"));
  const vault = new ContextVault({ home });
  await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer explainable memory search."
  });
  const definition = createContextMcpServerDefinition(vault);

  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://agent-card"));
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://stats"));
  assert.ok(definition.prompts.some((prompt) => prompt.name === "task-start-context"));

  const resource = await definition.readResource("across-context://stats", {});
  assert.match(JSON.stringify(resource), /total/);

  const prompt = await definition.getPrompt("memory-review", { projectRoot: home });
  assert.match(JSON.stringify(prompt), /pending memories/i);
});
