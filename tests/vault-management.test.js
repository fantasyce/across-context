import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault, readJsonl } from "../src/vault.js";

async function tempVault(options = {}) {
  const home = await mkdtemp(join(tmpdir(), "across-context-vault-management-"));
  return new ContextVault({ home, ...options });
}

test("ContextVault rejects sensitive memories through the policy engine", async () => {
  const vault = await tempVault();
  const fakeToken = ["ghp", "1234567890abcdefghijklmnop"].join("_");

  await assert.rejects(() => vault.remember({
    scope: "global",
    type: "note",
    text: `The GitHub token is ${fakeToken}.`
  }), /Memory rejected/i);

  const raw = await readFile(join(vault.home, "global", "memories.jsonl"), "utf8");
  assert.equal(raw, "");
});

test("ContextVault returns duplicate matches without appending another record", async () => {
  const vault = await tempVault();

  const first = await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer concise Chinese status updates."
  });
  const second = await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer concise Chinese status updates."
  });

  const raw = await readFile(join(vault.home, "global", "memories.jsonl"), "utf8");
  assert.equal(second.duplicateOf, first.id);
  assert.equal(raw.trim().split("\n").length, 1);
});

test("ContextVault lists, forgets, and reports memory stats", async () => {
  const vault = await tempVault();
  const entry = await vault.remember({
    scope: "global",
    type: "command",
    text: "Run npm test before release."
  });

  assert.equal((await vault.listMemories()).length, 1);
  const stats = await vault.stats();
  assert.equal(stats.total, 1);
  assert.equal(stats.byType.command, 1);

  const result = await vault.forget(entry.id);
  assert.equal(result.forgotten, 1);
  assert.equal((await vault.listMemories()).length, 0);
});

test("ContextVault stores automatic low-confidence memories as pending and approves them", async () => {
  const vault = await tempVault();

  const entry = await vault.remember({
    scope: "global",
    type: "note",
    text: "Maybe useful: temporary dashboard experiment.",
    auto: true
  });

  assert.equal(entry.status, "pending");
  assert.equal((await vault.listMemories({ status: "pending" })).length, 1);

  const approved = await vault.updateStatus(entry.id, "active");
  assert.equal(approved.status, "active");
  assert.equal((await vault.listMemories({ status: "active" })).length, 1);
});

test("ContextVault can aggregate pending memories across all projects for review", async () => {
  const vault = await tempVault();
  const projectRoot = join(vault.home, "review-project");
  await vault.remember({
    scope: "project",
    type: "session",
    text: "Project pending review memory.",
    projectRoot,
    status: "pending"
  });

  assert.equal((await vault.listMemories({ status: "pending" })).length, 0);
  const allPending = await vault.listMemories({ status: "pending", includeProjects: true });
  assert.equal(allPending.length, 1);
  assert.equal(allPending[0].text, "Project pending review memory.");
});

test("ContextVault updates multiple memory statuses in one call", async () => {
  const vault = await tempVault();
  const first = await vault.remember({
    scope: "global",
    type: "note",
    text: "Review first.",
    auto: true
  });
  const second = await vault.remember({
    scope: "global",
    type: "note",
    text: "Review second.",
    auto: true
  });

  const result = await vault.updateStatuses([first.id, second.id], "archived");

  assert.equal(result.updated.length, 2);
  assert.deepEqual(result.missing, []);
  assert.equal((await vault.listMemories({ status: "archived" })).length, 2);
});

test("ContextVault reports Agent Loop memory metrics without raw memory text", async () => {
  const vault = await tempVault();
  const projectRoot = join(vault.home, "loop-project");
  const candidate = JSON.stringify({
    schema_version: "agent-loop-memory-candidate/1.0",
    loop_id: "loop-metrics-1",
    goal: "Durable private implementation detail",
    outcome: "completed",
    decisions: [{ step_id: "step-1", action_type: "task_dispatch", status: "completed" }]
  });
  const sensitiveCandidate = JSON.stringify({
    schema_version: "agent-loop-memory-candidate/1.0",
    loop_id: "loop-metrics-secret",
    goal: "token: redacted-example-value",
    outcome: "blocked"
  });

  const pending = await vault.remember({
    scope: "project",
    type: "session",
    text: candidate,
    projectRoot,
    status: "pending",
    source: "agent-loop"
  });
  const duplicate = await vault.remember({
    scope: "project",
    type: "session",
    text: candidate,
    projectRoot,
    status: "pending",
    source: "agent-loop"
  });
  await assert.rejects(() => vault.remember({
    scope: "project",
    type: "session",
    text: sensitiveCandidate,
    projectRoot,
    status: "pending",
    source: "agent-loop"
  }), /Memory rejected/);

  const approved = await vault.updateStatus(pending.id, "active");
  const metrics = await vault.agentLoopMemoryMetrics({ includeProjects: true });
  const raw = JSON.stringify(metrics);

  assert.equal(duplicate.duplicateOf, pending.id);
  assert.equal(approved.status, "active");
  assert.equal(metrics.schema_version, "agent-loop-memory-metrics/1.0");
  assert.equal(metrics.totals.candidate_count, 1);
  assert.equal(metrics.totals.approved_count, 1);
  assert.equal(metrics.totals.duplicate_reused_count, 1);
  assert.equal(metrics.totals.denied_count, 1);
  assert.equal(metrics.totals.sensitive_denied_count, 1);
  const policyEvents = await readJsonl(join(vault.home, "events", "memory-policy.jsonl"));
  const sensitiveEvent = policyEvents.find((event) => event.policyStatus === "deny");
  assert.equal(sensitiveEvent.policyCategory, "sensitive");
  assert.equal(sensitiveEvent.sensitive, true);
  assert.ok(metrics.metrics.some((metric) => metric.metric === "memory_candidate.approved_count"));
  assert.doesNotMatch(raw, /Durable private implementation detail/);
  assert.doesNotMatch(raw, /redacted-example-value/);
});

test("ContextVault reports missing ids during batch status updates", async () => {
  const vault = await tempVault();
  const entry = await vault.remember({
    scope: "global",
    type: "note",
    text: "Review one present memory.",
    auto: true
  });

  const result = await vault.updateStatuses([entry.id, "mem_missing"], "active");

  assert.equal(result.updated.length, 1);
  assert.deepEqual(result.missing, ["mem_missing"]);
});

test("ContextVault archives and exports team-safe project memories", async () => {
  const vault = await tempVault();
  const projectRoot = join(vault.home, "team-project");
  const entry = await vault.remember({
    scope: "project",
    type: "decision",
    text: "Use the local MCP server for shared memory.",
    projectRoot,
    visibility: "team"
  });

  const archived = await vault.updateStatus(entry.id, "archived");
  const exported = await vault.exportTeamMemory({ projectRoot });

  assert.equal(archived.status, "archived");
  assert.ok(exported.memories.every((memory) => memory.visibility === "team"));
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(projectRoot.replaceAll("/", "\\/")));
});

test("ContextVault compacts duplicate jsonl records already on disk", async () => {
  const vault = await tempVault();
  await vault.init();
  const file = join(vault.home, "global", "memories.jsonl");
  const duplicate = {
    id: "mem_duplicate_a",
    scope: "global",
    type: "note",
    text: "Keep the release checklist short.",
    tags: [],
    status: "active",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z"
  };
  await writeFile(file, `${JSON.stringify(duplicate)}\n${JSON.stringify({ ...duplicate, id: "mem_duplicate_b" })}\n`, "utf8");

  const result = await vault.compact();
  const memories = await vault.listMemories();

  assert.equal(result.removed, 1);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].id, "mem_duplicate_a");
});
