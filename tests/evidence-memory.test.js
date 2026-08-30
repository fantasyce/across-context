import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { compactEvidenceGraph, recallEvidenceMemory, rememberEvidenceMemory } from "../src/evidence-memory.js";
import { ContextVault } from "../src/vault.js";

test("evidence memory stores compact graph as pending review", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-evidence-memory-"));
  const vault = new ContextVault({ home });
  const graph = {
    schema_version: "across-evidence-graph/1.0",
    run_id: "run-1",
    spec_id: "plugin-compatibility-lab-v2",
    status: "completed",
    nodes: [
      { id: "run:run-1", type: "run", status: "completed", payload: { raw: "not stored" } },
      { id: "action:workflow_pack_export", type: "action", status: "passed", hash: "abc" }
    ],
    edges: [{ from: "run:run-1", to: "action:workflow_pack_export", relation: "runs" }],
    summary: { node_count: 2, edge_count: 1 }
  };

  const remembered = await rememberEvidenceMemory(vault, {
    graph,
    summary: "Codex and Claude host export evidence"
  });
  const ordinaryRecall = await recallEvidenceMemory(vault, { specId: "plugin-compatibility-lab-v2" });
  const recalled = await recallEvidenceMemory(vault, { specId: "plugin-compatibility-lab-v2", status: "pending" });

  assert.equal(remembered.schema_version, "across-evidence-memory/1.0");
  assert.equal(remembered.status, "accepted_pending");
  assert.equal(remembered.memory.status, "pending");
  assert.equal(ordinaryRecall.result_count, 0);
  assert.equal(recalled.schema_version, "across-context-evidence-recall/1.0");
  assert.equal(recalled.result_count, 1);
  assert.equal(recalled.results[0].summary, "Codex and Claude host export evidence");
  assert.match(recalled.results[0].graph_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(remembered.memory.text, /not stored/);
});

test("compactEvidenceGraph drops raw payloads but keeps topology hashes", () => {
  const compact = compactEvidenceGraph({
    run_id: "run-2",
    spec_id: "spec-2",
    nodes: [{ id: "node-1", type: "source", status: "passed", payload: { secret: "raw content" } }],
    edges: [{ from: "node-1", to: "node-2", relation: "supports" }]
  });

  assert.equal(compact.schema_version, "across-evidence-graph/1.0");
  assert.equal(compact.nodes[0].id, "node-1");
  assert.match(compact.nodes[0].hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(compact), /raw content/);
});

test("evidence memory remains parseable when graph topology is large", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-evidence-memory-large-"));
  const vault = new ContextVault({ home });
  const graph = {
    schema_version: "across-evidence-graph/1.0",
    run_id: "run-large",
    spec_id: "plugin-compatibility-lab-v2",
    status: "completed",
    nodes: Array.from({ length: 80 }, (_, index) => ({
      id: `node:${index}`,
      type: index % 2 ? "action" : "gate",
      status: "passed",
      payload: { raw: "large payload should not be stored", index }
    })),
    edges: Array.from({ length: 160 }, (_, index) => ({
      from: `node:${index % 80}`,
      to: `node:${(index + 1) % 80}`,
      relation: "supports"
    })),
    summary: { node_count: 80, edge_count: 160 }
  };

  const remembered = await rememberEvidenceMemory(vault, { graph, summary: "Large host interop evidence graph" });
  const recalled = await recallEvidenceMemory(vault, { runId: "run-large", status: "pending" });

  assert.equal(remembered.status, "accepted_pending");
  assert.equal(remembered.memory.policy.trimmed, false);
  assert.equal(recalled.result_count, 1);
  assert.equal(recalled.results[0].run_id, "run-large");
  assert.equal(recalled.results[0].graph_summary.original_node_count, 80);
  assert.doesNotMatch(remembered.memory.text, /large payload should not be stored/);
});

test("evidence memory preserves Goal claim bindings without trusted verdict fields", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-evidence-goal-"));
  const vault = new ContextVault({ home });
  const remembered = await rememberEvidenceMemory(vault, {
    graph: {
      schema_version: "across-evidence-graph/1.0",
      run_id: "run-goal",
      spec_id: "goal-aware-spec",
      status: "completed",
      goal_id: "goal-evidence",
      goal_revision: 3,
      input_fingerprint: "a".repeat(64),
      criterion_ids: ["criterion-tests", "criterion-review"],
      verified: true,
      verdict: "trusted",
      nodes: [],
      edges: []
    },
    summary: "Goal evidence claims were recorded."
  });
  const recalled = await recallEvidenceMemory(vault, { runId: "run-goal", status: "pending" });
  assert.equal(recalled.results[0].goal_id, "goal-evidence");
  assert.equal(recalled.results[0].goal_revision, 3);
  assert.deepEqual(recalled.results[0].criterion_ids, ["criterion-review", "criterion-tests"]);
  assert.doesNotMatch(remembered.memory.text, /verified|verdict|trusted/);
});

test("evidence memory rejects incomplete or malformed Goal bindings", () => {
  const base = {
    schema_version: "across-evidence-graph/1.0",
    run_id: "run-invalid-goal",
    spec_id: "goal-aware-spec",
    status: "completed",
    nodes: [],
    edges: []
  };
  assert.throws(() => compactEvidenceGraph({ ...base, goal_id: "goal-only" }), /complete|goal_revision/);
  assert.throws(() => compactEvidenceGraph({
    ...base,
    goal_id: "goal-invalid",
    goal_revision: -1,
    input_fingerprint: "not-a-hash",
    criterion_ids: []
  }), /goal_revision|fingerprint|criterion/);
});
