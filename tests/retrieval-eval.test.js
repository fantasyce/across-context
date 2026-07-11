import test from "node:test";
import assert from "node:assert/strict";
import { runRetrievalEvaluation } from "../src/retrieval-eval.js";

test("bundled retrieval evaluation covers all required workflows at deterministic quality thresholds", async () => {
  const first = await runRetrievalEvaluation();
  const second = await runRetrievalEvaluation();

  assert.deepEqual(second, first);
  assert.equal(first.passed, true);
  assert.equal(first.recall_at_k, 1);
  assert.equal(first.mean_reciprocal_rank, 1);
  assert.equal(first.route_coverage, 1);
  assert.ok(first.precision_at_k >= first.thresholds.minimum_precision_at_k);
  assert.ok(first.ndcg_at_k >= first.thresholds.minimum_ndcg_at_k);
  assert.deepEqual(first.cases.map((item) => item.category), [
    "repo_qa",
    "release_readiness",
    "project_profile",
    "evidence_recall",
    "recurring_bug_fix"
  ]);
});
