import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { retrieveEntries } from "./memory-retrieval.js";

const DEFAULT_FIXTURE_URL = new URL("./fixtures/retrieval-eval.json", import.meta.url);

export async function runRetrievalEvaluation(options = {}) {
  const fixturePath = options.fixturePath || fileURLToPath(DEFAULT_FIXTURE_URL);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const cases = fixture.cases.map((evaluationCase) => evaluateCase(evaluationCase));
  const recallAtK = average(cases.map((item) => item.recall_at_k));
  const meanReciprocalRank = average(cases.map((item) => item.reciprocal_rank));
  const precisionAtK = average(cases.map((item) => item.precision_at_k));
  const normalizedDiscountedCumulativeGain = average(cases.map((item) => item.ndcg_at_k));
  const routeCoverage = new Set(cases.map((item) => item.route)).size / 5;
  const minimumRecall = Number(fixture.minimum_recall_at_k || 0.75);
  const minimumMrr = Number(fixture.minimum_mean_reciprocal_rank || 0.6);
  const minimumPrecision = Number(fixture.minimum_precision_at_k || 0.4);
  const minimumNdcg = Number(fixture.minimum_ndcg_at_k || 0.7);
  const minimumRouteCoverage = Number(fixture.minimum_route_coverage || 1);
  return {
    schema_version: "across-context-retrieval-eval/1.0",
    fixture_schema_version: fixture.schema_version,
    deterministic: true,
    local_only: true,
    case_count: cases.length,
    recall_at_k: round(recallAtK),
    precision_at_k: round(precisionAtK),
    mean_reciprocal_rank: round(meanReciprocalRank),
    ndcg_at_k: round(normalizedDiscountedCumulativeGain),
    route_coverage: round(routeCoverage),
    thresholds: {
      minimum_recall_at_k: minimumRecall,
      minimum_mean_reciprocal_rank: minimumMrr,
      minimum_precision_at_k: minimumPrecision,
      minimum_ndcg_at_k: minimumNdcg,
      minimum_route_coverage: minimumRouteCoverage
    },
    passed: recallAtK >= minimumRecall
      && meanReciprocalRank >= minimumMrr
      && precisionAtK >= minimumPrecision
      && normalizedDiscountedCumulativeGain >= minimumNdcg
      && routeCoverage >= minimumRouteCoverage
      && cases.every((item) => item.passed),
    cases
  };
}

function evaluateCase(evaluationCase) {
  const result = retrieveEntries(evaluationCase.records, {
    route: evaluationCase.route,
    query: evaluationCase.query,
    limit: evaluationCase.k,
    statuses: ["active", "pinned"],
    profile: evaluationCase.profile || null,
    allowEmptyQuery: Boolean(evaluationCase.allow_empty_query)
  });
  const actualIds = result.results.map((item) => item.entry.id);
  const expectedIds = evaluationCase.expected_ids;
  const hits = expectedIds.filter((id) => actualIds.includes(id));
  const firstRank = actualIds.findIndex((id) => expectedIds.includes(id));
  const recallAtK = expectedIds.length ? hits.length / expectedIds.length : 1;
  const precisionAtK = actualIds.length ? hits.length / actualIds.length : expectedIds.length ? 0 : 1;
  const dcg = actualIds.reduce((sum, id, index) => sum + (expectedIds.includes(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const idealLength = Math.min(expectedIds.length, actualIds.length || evaluationCase.k);
  const idealDcg = Array.from({ length: idealLength }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return {
    id: evaluationCase.id,
    category: evaluationCase.category,
    route: evaluationCase.route,
    query: evaluationCase.query,
    k: evaluationCase.k,
    expected_ids: expectedIds,
    actual_ids: actualIds,
    recall_at_k: round(recallAtK),
    precision_at_k: round(precisionAtK),
    reciprocal_rank: firstRank === -1 ? 0 : round(1 / (firstRank + 1)),
    ndcg_at_k: idealDcg ? round(dcg / idealDcg) : 1,
    passed: recallAtK >= Number(evaluationCase.minimum_recall_at_k || 1)
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
