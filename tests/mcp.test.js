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
      "diff_loop_memory",
      "export_agent_instructions",
      "get_agent_card",
      "get_agent_loop_memory_metrics",
      "get_agent_loop_memory_policy",
      "get_context_packs",
      "get_loop_history",
      "get_project_context",
      "recall_agent_team_receipts",
      "recall_evidence_memory",
      "recall_loop_memory",
      "remember_agent_team_receipt",
      "remember_context",
      "remember_evidence_memory",
      "remember_loop_memory",
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
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://agent-loop-memory-metrics"));
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://context-packs"));
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://evidence-memory-policy"));
  assert.ok(definition.resources.some((resource) => resource.uri === "across-context://agent-team-receipts"));
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
  assert.equal(policy.schemaVersion, "0.3");
  assert.equal(policy.defaultWriteStatus, "pending");
  assert.equal(policy.adapterContract.search.activeStatus, "active");
  assert.equal(policy.adapterContract.writeCandidate.defaultStatus, "pending");
  assert.equal(policy.adapterContract.writeCandidate.structuredSummary.schema, "agent-loop-memory-candidate/1.0");
  assert.ok(policy.adapterContract.writeCandidate.structuredSummary.fields.includes("failure_types"));
  assert.deepEqual(policy.hostLoopControls.actions, ["cancel", "reject_action", "retry_step"]);
  assert.equal(policy.hostLoopControls.events, "read from the orchestrator loop event stream");
  assert.equal(policy.hooks[0].id, "pre_loop_search");

  const metricsResource = await definition.readResource("across-context://agent-loop-memory-metrics", {});
  const metrics = JSON.parse(metricsResource.contents[0].text);
  assert.equal(metrics.schema_version, "agent-loop-memory-metrics/1.0");

  const contextPacksResource = await definition.readResource("across-context://context-packs", {});
  const contextPacks = JSON.parse(contextPacksResource.contents[0].text);
  assert.equal(contextPacks.schema_version, "across-context-pack-summary/1.0");

  const evidencePolicyResource = await definition.readResource("across-context://evidence-memory-policy", {});
  const evidencePolicy = JSON.parse(evidencePolicyResource.contents[0].text);
  assert.equal(evidencePolicy.schema_version, "across-evidence-memory-policy/1.0");
  assert.equal(evidencePolicy.raw_payloads_persisted, false);

  const receiptsResource = await definition.readResource("across-context://agent-team-receipts", {});
  const receipts = JSON.parse(receiptsResource.contents[0].text);
  assert.equal(receipts.schema_version, "across-context-agent-team-receipt-recall/1.0");
});

test("MCP stores and recalls compact evidence memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-evidence-memory-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  const remember = definition.tools.find((tool) => tool.name === "remember_evidence_memory");
  const recall = definition.tools.find((tool) => tool.name === "recall_evidence_memory");

  const remembered = await remember.handler({
    graph: {
      schema_version: "across-evidence-graph/1.0",
      run_id: "run-mcp",
      spec_id: "plugin-compatibility-lab-v2",
      nodes: [{ id: "run:run-mcp", type: "run", status: "completed", hash: "abc" }],
      edges: []
    },
    summary: "MCP evidence graph"
  });
  const recalled = await recall.handler({ runId: "run-mcp" });

  assert.equal(remembered.structuredContent.result.status, "accepted_pending");
  assert.equal(recalled.structuredContent.result.result_count, 1);
  assert.equal(recalled.structuredContent.result.results[0].summary, "MCP evidence graph");
});

test("MCP stores and recalls agent-team trust receipts", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-agent-team-receipt-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  const remember = definition.tools.find((tool) => tool.name === "remember_agent_team_receipt");
  const recall = definition.tools.find((tool) => tool.name === "recall_agent_team_receipts");

  const remembered = await remember.handler({
    packId: "plugin-compatibility-lab-v2",
    receipt: {
      schema_version: "across-agent-team-trust-receipt/1.0",
      receipt_id: "receipt-template:plugin-compatibility-lab-v2",
      pack_id: "plugin-compatibility-lab-v2",
      acceptance_checklist: [{ id: "workflow_pack_valid", status: "passed", required: true }],
      evidence_contract: {
        required: ["runtime_policy", "trust_boundary", "host_exports", "evidence_graph", "validation_gates"]
      }
    },
    product_card: {
      pack_id: "plugin-compatibility-lab-v2",
      headline: "Test an agent plugin before adoption.",
      competitive_position: "trust layer"
    }
  });
  const recalled = await recall.handler({ packId: "plugin-compatibility-lab-v2" });

  assert.equal(remembered.structuredContent.result.status, "accepted_pending");
  assert.equal(recalled.structuredContent.result.result_count, 1);
  assert.equal(recalled.structuredContent.result.results[0].headline, "Test an agent plugin before adoption.");
});

test("MCP exposes Agent Loop memory metrics without raw memory text", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-loop-metrics-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  const candidate = JSON.stringify({
    schema_version: "agent-loop-memory-candidate/1.0",
    loop_id: "loop-mcp-metrics",
    goal: "Raw MCP candidate text must stay out",
    outcome: "completed"
  });
  await vault.remember({
    scope: "global",
    type: "session",
    text: candidate,
    status: "pending",
    source: "agent-loop"
  });
  const tool = definition.tools.find((item) => item.name === "get_agent_loop_memory_metrics");

  const result = await tool.handler({});
  const raw = JSON.stringify(result);

  assert.equal(result.structuredContent.metrics.totals.pending_count, 1);
  assert.doesNotMatch(raw, /Raw MCP candidate text must stay out/);
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

test("MCP exposes context packs filtered by generic agent plugin id", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-agent-plugin-packs-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Echo agent active context",
    status: "active",
    tags: ["agent-plugin:demo.echo-agent"]
  });
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Other agent active context",
    status: "active",
    tags: ["agent-plugin:other.agent"]
  });
  const rememberLoop = definition.tools.find((tool) => tool.name === "remember_loop_memory");
  await rememberLoop.handler({
    specId: "demo-spec",
    runId: "demo-run",
    text: "Echo agent loop memory",
    agentPluginId: "demo.echo-agent"
  });
  const getContextPacks = definition.tools.find((tool) => tool.name === "get_context_packs");

  const result = await getContextPacks.handler({ agentPluginId: "demo.echo-agent" });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.schema_version, "across-context-pack-summary/1.0");
  assert.equal(payload.summary.filtered_agent_plugin_id, "demo.echo-agent");
  assert.equal(payload.summary.memory_count, 2);
  assert.equal(payload.summary.agent_plugin_count, 1);
  assert.ok(payload.packs.every((pack) => pack.agent_plugin_id === "demo.echo-agent"));
});

test("search_context prioritizes agent-plugin scoped memory when agentPluginId is supplied", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-agent-plugin-search-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Generic risk memory should be fallback only.",
    status: "active",
    tags: ["risk"]
  });
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Echo agent risk memory should be first.",
    status: "active",
    tags: ["risk", "agent-plugin:demo.echo-agent"]
  });
  const search = definition.tools.find((tool) => tool.name === "search_context");

  const result = await search.handler({
    query: "risk",
    agentPluginId: "demo.echo-agent",
    limit: 2
  });
  const payload = result.structuredContent;

  assert.match(result.content[0].text.split("\n")[0], /Echo agent risk memory/);
  assert.equal(payload.results[0].explanation.agentPluginScope, "matched");
  assert.equal(payload.results[1].explanation.agentPluginScope, "fallback_global");

  const scopedOnly = await search.handler({
    query: "risk",
    agentPluginId: "demo.echo-agent",
    agentScope: "only",
    limit: 2
  });
  const scopedPayload = scopedOnly.structuredContent;

  assert.equal(scopedPayload.results.length, 1);
  assert.match(scopedPayload.results[0].entry.text, /Echo agent risk memory/);
});

test("MCP exposes a virtual empty context pack for a new generic agent plugin", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-empty-agent-plugin-pack-"));
  const vault = new ContextVault({ home });
  const definition = createContextMcpServerDefinition(vault);
  const getContextPacks = definition.tools.find((tool) => tool.name === "get_context_packs");

  const result = await getContextPacks.handler({ agentPluginId: "demo.echo-agent" });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.status, "passed");
  assert.equal(payload.summary.memory_count, 0);
  assert.equal(payload.summary.context_pack_count, 1);
  assert.equal(payload.summary.agent_plugin_count, 1);
  assert.equal(payload.packs[0].id, "demo.echo-agent:empty");
  assert.equal(payload.packs[0].virtual, true);
  assert.equal(payload.packs[0].ready_for_agent_loading, true);
});
