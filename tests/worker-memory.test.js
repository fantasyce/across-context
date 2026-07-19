import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ContextVault } from "../src/vault.js";
import {
  assertWorkerMemorySafe,
  compactWorkerOutcome,
  mergeWorkerExperiences,
  parseWorkerMemory,
  recallableWorkerMemories,
  rememberWorkerOutcome,
  revokeWorkerMemories
} from "../src/worker-memory.js";

const digest = "a".repeat(64);

function outcome(overrides = {}) {
  return {
    run_id: "run-test",
    job_id: "job-test",
    node_id: "node-test",
    workflow_id: "scenario-simulation",
    artifact_hash: digest,
    evidence_hash: "b".repeat(64),
    terminal_state: "completed",
    conclusion: "Deterministic simulation completed.",
    platform: { os: "linux", architecture: "arm64", version: "6.8" },
    executor: "bounded-process",
    isolation_level: "bounded",
    transport: "relay",
    cleanup_status: "complete",
    observed_at: "2026-07-16T00:00:00.000Z",
    expires_at: "2026-08-15T00:00:00.000Z",
    ...overrides
  };
}

test("worker memory stores only compact provenance and redacts secrets and paths", () => {
  const privatePath = ["", "Users", "alice", "private"].join("/");
  const compact = compactWorkerOutcome(outcome({ conclusion: `Used ${privatePath} and Bearer abc.def.ghi` }));
  assert.equal(compact.schema_version, "across-worker-memory/1.0");
  assert.doesNotMatch(JSON.stringify(compact), /\/Users\/alice|abc\.def\.ghi/);
  assert.equal(assertWorkerMemorySafe(compact), true);
  assert.throws(() => assertWorkerMemorySafe({ prompt: "raw" }), /forbidden/);
});

test("worker outcomes enter Context as pending and remain excluded from normal recall", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-worker-memory-"));
  const vault = new ContextVault({ home });
  const remembered = await rememberWorkerOutcome(vault, outcome());
  assert.equal(remembered.status, "pending");
  assert.equal(parseWorkerMemory(remembered).node_id, "node-test");
  assert.deepEqual(recallableWorkerMemories([remembered], { now: new Date("2026-07-17") }), []);
  await vault.approve(remembered.id);
  const memories = await vault.listMemories({ includeGlobal: true });
  assert.equal(recallableWorkerMemories(memories, { now: new Date("2026-07-17") }).length, 1);
});

test("expired and revoked worker memories never enter recall", () => {
  const base = { id: "memory-1", status: "active", text: JSON.stringify(compactWorkerOutcome(outcome())) };
  assert.equal(recallableWorkerMemories([base], { now: new Date("2026-09-01") }).length, 0);
  const revoked = { ...base, text: JSON.stringify(compactWorkerOutcome(outcome({ revoked: true }))) };
  assert.equal(recallableWorkerMemories([revoked], { now: new Date("2026-07-17") }).length, 0);
});

test("multi-node experience merge preserves evidence provenance and failure taxonomy", () => {
  const memories = [
    { id: "memory-a", status: "active", text: JSON.stringify(compactWorkerOutcome(outcome())) },
    { id: "memory-b", status: "active", text: JSON.stringify(compactWorkerOutcome(outcome({ run_id: "run-two", job_id: "job-two", terminal_state: "failed", failure: { category: "provider", code: "timeout", summary: "gateway timeout" } }))) },
    { id: "memory-c", status: "active", text: JSON.stringify(compactWorkerOutcome(outcome({ run_id: "run-three", job_id: "job-three", node_id: "node-other" }))) }
  ];
  const merged = mergeWorkerExperiences(memories, { now: new Date("2026-07-17") });
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.node_id === "node-test").failures.provider, 1);
  assert.equal(merged.find((item) => item.node_id === "node-test").success_rate, 0.5);
});

test("node revocation archives all associated worker memories", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-worker-revoke-"));
  const vault = new ContextVault({ home });
  const first = await rememberWorkerOutcome(vault, outcome());
  const second = await rememberWorkerOutcome(vault, outcome({ run_id: "run-two", job_id: "job-two" }));
  await vault.approve(first.id);
  await vault.approve(second.id);
  const result = await revokeWorkerMemories(vault, "node-test");
  assert.equal(result.revoked, 2);
  const memories = await vault.listMemories({ includeGlobal: true });
  assert.ok(memories.filter((memory) => [first.id, second.id].includes(memory.id)).every((memory) => memory.status === "archived"));
});
