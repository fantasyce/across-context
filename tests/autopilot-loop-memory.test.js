import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextVault } from "../src/vault.js";
import { createContextMcpServerDefinition } from "../src/mcp.js";
import { contextPackSummary, loopHistory, recallLoopMemory, rememberLoopMemory } from "../src/autopilot-loop-memory.js";

test("loop memory recall distinguishes accepted and redacted pending memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-loop-"));
  const vault = new ContextVault({ home });

  const accepted = await rememberLoopMemory(vault, {
    specId: "daily-news-brief",
    runId: "run-1",
    text: "safe summary",
    summary: {
      model_decision: {
        provider: "minimax",
        model: "MiniMax-M3",
        decision_hash: "abc123",
        patch_count: 1
      }
    }
  });
  const privatePath = ["", "Users", "example", "Documents", "projects", "private"].join("/");
  const privatePathPrefix = ["", "Users", "example", "Documents"].join("/");
  const redacted = await rememberLoopMemory(vault, {
    specId: "daily-news-brief",
    runId: "run-2",
    text: `path ${privatePath}`
  });
  const recalled = await recallLoopMemory(vault, { specId: "daily-news-brief" });
  const history = await loopHistory(vault);

  assert.equal(accepted.status, "accepted_pending");
  assert.equal(redacted.status, "redacted_pending");
  assert.equal(recalled.result_count, 2);
  assert.equal(recalled.results.find((item) => item.run_id === "run-1").summary.model_decision.provider, "minimax");
  assert.equal(history.specs[0].redacted_count, 1);
  assert.equal(JSON.stringify(recalled).includes(privatePathPrefix), false);
});

test("MCP exposes loop memory tools without duplicate writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-loop-"));
  const vault = new ContextVault({ home });
  const server = createContextMcpServerDefinition(vault);
  const tool = server.tools.find((item) => item.name === "remember_loop_memory");

  const response = await tool.handler({
    specId: "github-plugin-radar",
    runId: "run-1",
    text: "plugin radar summary"
  });
  const recalled = await recallLoopMemory(vault, { specId: "github-plugin-radar" });

  assert.match(response.content[0].text, /accepted_pending/);
  assert.equal(recalled.result_count, 1);
});

test("context pack summary groups memory by scope type and status", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-packs-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "across-context-pack-project-"));
  const vault = new ContextVault({ home });

  await vault.remember({ text: "global pending note", scope: "global", type: "note", status: "pending" });
  await vault.remember({ text: "global active note", scope: "global", type: "note", status: "active" });
  await vault.remember({ text: "project decision", scope: "project", type: "decision", status: "pending", projectRoot });

  const summary = await contextPackSummary(vault);

  assert.equal(summary.schema_version, "across-context-pack-summary/1.0");
  assert.equal(summary.provider, "across-context");
  assert.equal(summary.status, "attention");
  assert.equal(summary.summary.memory_count, 3);
  assert.equal(summary.summary.pending_count, 2);
  assert.equal(summary.summary.context_pack_count, 3);
  assert.ok(summary.packs.find((pack) => pack.id === "global:note:pending"));
  assert.ok(summary.packs.find((pack) => pack.id === "project:decision:pending"));
});

test("context pack summary filters generic agent plugin memory packs", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-agent-plugin-packs-"));
  const vault = new ContextVault({ home });

  await vault.remember({ text: "echo plugin active note", scope: "global", type: "note", status: "active", tags: ["agent-plugin:demo.echo-agent"] });
  await vault.remember({ text: "other plugin active note", scope: "global", type: "note", status: "active", tags: ["agent-plugin:other.agent"] });
  await rememberLoopMemory(vault, {
    specId: "agent-plugin-demo",
    runId: "run-1",
    text: "agent plugin loop summary",
    agentPluginId: "demo.echo-agent"
  });

  const summary = await contextPackSummary(vault, { agentPluginId: "demo.echo-agent" });

  assert.equal(summary.summary.memory_count, 2);
  assert.equal(summary.summary.agent_plugin_count, 1);
  assert.equal(summary.summary.filtered_agent_plugin_id, "demo.echo-agent");
  assert.ok(summary.packs.every((pack) => pack.agent_plugin_id === "demo.echo-agent"));
  assert.ok(summary.packs.find((pack) => pack.id === "demo.echo-agent:global:note:active"));
});

test("context pack summary returns virtual empty pack for a new generic agent plugin", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-empty-agent-plugin-pack-"));
  const vault = new ContextVault({ home });

  const summary = await contextPackSummary(vault, { agentPluginId: "demo.echo-agent" });

  assert.equal(summary.status, "passed");
  assert.equal(summary.summary.memory_count, 0);
  assert.equal(summary.summary.context_pack_count, 1);
  assert.equal(summary.summary.agent_plugin_count, 1);
  assert.equal(summary.summary.filtered_agent_plugin_id, "demo.echo-agent");
  assert.equal(summary.packs[0].id, "demo.echo-agent:empty");
  assert.equal(summary.packs[0].agent_plugin_id, "demo.echo-agent");
  assert.equal(summary.packs[0].virtual, true);
  assert.equal(summary.packs[0].ready_for_agent_loading, true);
});
