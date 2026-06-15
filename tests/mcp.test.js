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
      "get_agent_loop_memory_policy",
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
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://agent-loop-memory-policy"));
  assert.ok(definition.prompts.some((prompt) => prompt.name === "task-start-context"));
  assert.ok(definition.prompts.some((prompt) => prompt.name === "agent-loop-memory-policy"));

  const resource = await definition.readResource("across-context://stats", {});
  assert.match(JSON.stringify(resource), /total/);

  const prompt = await definition.getPrompt("memory-review", { projectRoot: home });
  assert.match(JSON.stringify(prompt), /pending memories/i);

  const policyPrompt = await definition.getPrompt("agent-loop-memory-policy", {});
  assert.match(JSON.stringify(policyPrompt), /pre-loop search/i);
  assert.match(JSON.stringify(policyPrompt), /pending summary/i);

  const policyResource = await definition.readResource("across-context://agent-loop-memory-policy", {});
  const policy = JSON.parse(policyResource.contents[0].text);
  assert.equal(policy.schemaVersion, "0.2");
  assert.equal(policy.defaultWriteStatus, "pending");
  assert.equal(policy.adapterContract.search.activeStatus, "active");
  assert.equal(policy.adapterContract.writeCandidate.defaultStatus, "pending");
  assert.deepEqual(policy.hostLoopControls.actions, ["cancel", "reject_action", "retry_step"]);
  assert.equal(policy.hostLoopControls.events, "read from the orchestrator loop event stream");
  assert.equal(policy.hooks[0].id, "pre_loop_search");
});

test("MCP review_pending_memories includes project memories when no project is specified", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-review-"));
  const vault = new ContextVault({ home });
  const projectRoot = join(home, "project-a");
  await vault.remember({
    scope: "project",
    type: "session",
    text: "Project pending memory visible from review.",
    projectRoot,
    status: "pending"
  });
  const definition = createContextMcpServerDefinition(vault);
  const review = definition.tools.find((tool) => tool.name === "review_pending_memories");

  const result = await review.handler({});

  assert.match(JSON.stringify(result), /Project pending memory visible from review/);
});
