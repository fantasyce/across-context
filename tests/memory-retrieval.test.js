import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { retrieveAndMergeMemory, retrieveMemory } from "../src/memory-retrieval.js";
import { rebuildMemoryProjection } from "../src/memory-projection.js";
import { createEmbeddingAdapter } from "../src/embedding-adapter.js";

test("explicit retrieval routes keep pending memory behind review", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-retrieval-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "across-context-retrieval-project-"));
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "retrieval-project", scripts: { check: "node --check src.js" } }));
  const vault = new ContextVault({ home });
  await vault.remember({ scope: "global", type: "command", text: "Run npm check for repository quality.", status: "active" });
  await vault.remember({ scope: "global", type: "note", text: "Repository quality pending speculation.", status: "pending" });
  await vault.remember({
    scope: "global",
    type: "session",
    status: "active",
    tags: ["release-evidence"],
    text: JSON.stringify({ schema_version: "across-evidence-memory/1.0", summary: "Release quality gate passed." })
  });
  const pushReceipt = await vault.remember({
    scope: "global",
    type: "note",
    status: "active",
    text: JSON.stringify({
      schema_version: "across-autopilot-push-receipt/1.0",
      gate_verdict: "pass",
      pr_ready_summary: "Incident correlation gate passed."
    })
  });
  const goalSummary = await vault.remember({
    scope: "global",
    type: "decision",
    status: "active",
    trust_level: "trusted",
    tags: ["goal-summary", "goal:release-quality"],
    text: JSON.stringify({
      schema_version: "across-goal-memory-summary/1.0",
      goal_id: "goal-release-quality",
      goal_revision: 1,
      conclusion: "Release quality Goal evidence is reviewable."
    })
  });
  await vault.remember({
    scope: "project",
    projectRoot,
    type: "preference",
    status: "pinned",
    text: "Always use the package check command before release."
  });

  const keyword = await retrieveMemory(vault, { route: "keyword", query: "repository quality" });
  assert.ok(keyword.result_count >= 1);
  assert.ok(keyword.results.every((result) => ["active", "pinned"].includes(result.entry.status)));
  assert.equal(keyword.results.some((result) => result.entry.status === "pending"), false);

  await assert.rejects(
    () => retrieveMemory(vault, { route: "keyword", query: "repository quality", status: "pending" }),
    /reviewPending=true/
  );
  const pendingReview = await retrieveMemory(vault, {
    route: "keyword",
    query: "repository quality",
    status: "pending",
    reviewPending: true
  });
  assert.equal(pendingReview.pending_review, true);
  assert.equal(pendingReview.results[0].entry.status, "pending");

  const evidence = await retrieveMemory(vault, { route: "evidence_graph", query: "release quality gate" });
  assert.ok(evidence.results.some((result) => result.classification.primary_schema === "release_evidence"));
  const receiptEvidence = await retrieveMemory(vault, { route: "evidence_graph", query: "incident correlation gate" });
  assert.ok(receiptEvidence.results.some((result) => result.entry.id === pushReceipt.id));
  const goalEvidence = await retrieveMemory(vault, { route: "evidence_graph", query: "release quality Goal" });
  assert.ok(goalEvidence.results.some((result) => result.entry.id === goalSummary.id));

  await rebuildMemoryProjection(vault);
  const semantic = await retrieveMemory(vault, { route: "embedding", query: "publish verification" });
  assert.equal(semantic.projection_used, true);
  assert.equal(semantic.embedding.provider, "local");

  const provider = createEmbeddingAdapter({
    provider: "fixture",
    model: "fixture-v1",
    dimensions: 8,
    embed: async (texts) => texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0])
  });
  await rebuildMemoryProjection(vault, { embeddingAdapter: provider });
  const offlineFallback = await retrieveMemory(vault, { route: "embedding", query: "publish verification" });
  assert.equal(offlineFallback.embedding.provider, "local");
  assert.ok(offlineFallback.results.some((result) => result.explanation.scoreComponents.embeddingProvider === "local"));

  const profile = await retrieveMemory(vault, {
    route: "project_profile",
    query: "package check release",
    projectRoot
  });
  assert.equal(profile.profile.name, "retrieval-project");
  assert.equal(profile.results[0].entry.status, "pinned");

  const merged = await retrieveAndMergeMemory(vault, {
    query: "release quality package check",
    projectRoot,
    routes: ["keyword", "embedding", "evidence_graph", "project_profile", "loop_recall"],
    limit: 5,
    includeRouteResults: true
  });
  assert.deepEqual(merged.routes, ["keyword", "embedding", "evidence_graph", "project_profile", "loop_recall"]);
  assert.ok(merged.results.length >= 1);
  assert.equal(merged.results[0].explanation.strategy, "weighted-reciprocal-rank-fusion");
  assert.ok(merged.results[0].explanation.routeContributions.length >= 1);
});
