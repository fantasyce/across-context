import { ACTIVE_MEMORY_STATUSES } from "./vault.js";
import { classifyMemory, MEMORY_SCHEMAS } from "./memory-schema.js";
import { readMemoryProjection, cosineSimilarity, vectorizeText } from "./memory-projection.js";
import { embedWithFallback } from "./embedding-adapter.js";
import { learnProject } from "./project.js";
import { searchEntries } from "./semantic-search.js";

export const RETRIEVAL_SCHEMA = "across-context-retrieval/1.1";
export const MERGED_RETRIEVAL_SCHEMA = "across-context-merged-retrieval/1.0";
export const RETRIEVAL_ROUTES = Object.freeze({
  KEYWORD: "keyword",
  EMBEDDING: "embedding",
  SEMANTIC_KEYWORD: "embedding",
  EVIDENCE_GRAPH: "evidence_graph",
  PROJECT_PROFILE: "project_profile",
  LOOP_RECALL: "loop_recall"
});

export const RETRIEVAL_ROUTE_DEFINITIONS = Object.freeze([
  routeDefinition(RETRIEVAL_ROUTES.KEYWORD, "Deterministic exact keyword search over governed vault records."),
  routeDefinition(RETRIEVAL_ROUTES.EMBEDDING, "Embedding recall with deterministic local vectors by default and an optional injected provider adapter."),
  routeDefinition(RETRIEVAL_ROUTES.EVIDENCE_GRAPH, "Schema-aware evidence graph recall across releases, trust receipts, and loop evidence."),
  routeDefinition(RETRIEVAL_ROUTES.PROJECT_PROFILE, "Project conventions, decisions, commands, and failure patterns plus the saved project profile."),
  routeDefinition(RETRIEVAL_ROUTES.LOOP_RECALL, "Supervised loop evidence and recurring failure patterns.")
]);

export async function retrieveMemory(vault, input = {}) {
  const route = normalizeRoute(input.route);
  const statuses = retrievalStatuses(input);
  const entries = await vault.listMemories({
    projectRoot: input.projectRoot,
    includeGlobal: input.includeGlobal !== false,
    includeProjects: Boolean(input.includeProjects),
    statuses
  });
  let profile = null;
  if (route === RETRIEVAL_ROUTES.PROJECT_PROFILE && input.projectRoot) {
    profile = await vault.getProjectProfile(input.projectRoot) || await learnProject(input.projectRoot);
    await vault.saveProjectProfile(profile);
  }
  const projection = route === RETRIEVAL_ROUTES.EMBEDDING || route === RETRIEVAL_ROUTES.EVIDENCE_GRAPH
    ? await readMemoryProjection(vault)
    : null;
  let queryVector;
  let embedding;
  if (route === RETRIEVAL_ROUTES.EMBEDDING && projection?.vectors?.enabled && String(input.query || "").trim()) {
    const embedded = await embedWithFallback([input.query], {
      adapter: input.embeddingAdapter,
      strict: Boolean(input.strictEmbedding),
      fallback: (text) => vectorizeText(text, projection.vectors.local_dimensions || projection.vectors.dimensions)
    });
    queryVector = embedded.vectors[0];
    embedding = {
      provider: embedded.provider,
      model: embedded.model,
      algorithm: embedded.algorithm,
      fallback_used: embedded.fallback_used,
      fallback_reason: embedded.fallback_reason,
      network_performed: embedded.network_performed
    };
  }
  return retrieveEntries(entries, { ...input, route, statuses, profile, projection, queryVector, embedding });
}

export async function retrieveAndMergeMemory(vault, input = {}) {
  const routes = normalizeRoutes(input.routes);
  const perRoute = [];
  for (const route of routes) {
    perRoute.push(await retrieveMemory(vault, { ...input, route, limit: Math.max(normalizeLimit(input.limit) * 3, 20) }));
  }
  return mergeRetrievalResults(perRoute, { ...input, routes });
}

export function retrieveEntries(entries = [], input = {}) {
  const route = normalizeRoute(input.route);
  const query = String(input.query || "").trim();
  const limit = normalizeLimit(input.limit);
  const allowedStatuses = new Set(input.statuses || ACTIVE_MEMORY_STATUSES);
  const classified = entries
    .filter((entry) => allowedStatuses.has(entry.status || "active"))
    .map((entry) => ({ entry, classification: classifyMemory(entry) }));
  const candidates = routeCandidates(classified, route);
  const searchMode = route === RETRIEVAL_ROUTES.KEYWORD ? "keyword" : "hybrid";
  let results = searchEntries(candidates.map((candidate) => candidate.entry), {
    query,
    mode: searchMode,
    limit: Math.max(limit * 4, 20),
    allowEmptyQuery: route !== RETRIEVAL_ROUTES.KEYWORD || Boolean(input.allowEmptyQuery)
  });

  const projectionUsed = usableProjection(input.projection, entries, route);
  if (route === RETRIEVAL_ROUTES.EMBEDDING && projectionUsed && query) {
    results = rerankWithProjectionVectors(
      results,
      input.projection,
      input.queryVector || vectorizeText(query, input.projection.vectors.dimensions),
      input.embedding
    );
  }
  if (route === RETRIEVAL_ROUTES.EVIDENCE_GRAPH && projectionUsed) {
    results = rerankWithProjectionGraph(results, input.projection);
  }
  results = results.slice(0, limit).map((result, index) => ({
    ...result,
    classification: classifyMemory(result.entry),
    route,
    route_rank: index + 1,
    explanation: {
      ...(result.explanation || {}),
      retrievalRoute: route,
      routeRank: index + 1,
      projectionUsed
    }
  }));

  return {
    schema_version: RETRIEVAL_SCHEMA,
    route,
    query,
    statuses: input.statuses || [...ACTIVE_MEMORY_STATUSES],
    pending_review: (input.statuses || []).includes("pending"),
    local_only: input.embedding?.network_performed !== true,
    deterministic: !input.embedding || input.embedding.provider === "local",
    projection_used: projectionUsed,
    embedding: route === RETRIEVAL_ROUTES.EMBEDDING ? input.embedding || {
      provider: "local",
      model: "sha256-token-hash-v1",
      algorithm: "sha256-token-hash-v1",
      fallback_used: false,
      network_performed: false
    } : undefined,
    profile: route === RETRIEVAL_ROUTES.PROJECT_PROFILE ? input.profile || null : undefined,
    result_count: results.length,
    results
  };
}

export function mergeRetrievalResults(routeResults = [], input = {}) {
  const limit = normalizeLimit(input.limit);
  const routeWeights = { keyword: 1.15, embedding: 1, evidence_graph: 1.1, project_profile: 0.95, loop_recall: 1.05, ...(input.routeWeights || {}) };
  const byId = new Map();
  for (const routeResult of routeResults) {
    const weight = Number(routeWeights[routeResult.route] || 1);
    for (let index = 0; index < routeResult.results.length; index += 1) {
      const result = routeResult.results[index];
      const rank = index + 1;
      const contribution = weight / (60 + rank);
      const current = byId.get(result.entry.id) || {
        entry: result.entry,
        classification: result.classification,
        reciprocal_rank_score: 0,
        route_contributions: []
      };
      current.reciprocal_rank_score += contribution;
      current.route_contributions.push({
        route: routeResult.route,
        rank,
        route_weight: weight,
        route_score: result.score,
        reciprocal_rank_contribution: round(contribution),
        score_components: result.explanation?.scoreComponents || {}
      });
      byId.set(result.entry.id, current);
    }
  }
  const results = [...byId.values()]
    .map((result) => ({
      ...result,
      reciprocal_rank_score: round(result.reciprocal_rank_score),
      matched_route_count: result.route_contributions.length,
      explanation: {
        strategy: "weighted-reciprocal-rank-fusion",
        constant: 60,
        routeContributions: result.route_contributions
      }
    }))
    .sort((left, right) => right.reciprocal_rank_score - left.reciprocal_rank_score
      || right.matched_route_count - left.matched_route_count
      || String(left.entry.id).localeCompare(String(right.entry.id)))
    .slice(0, limit)
    .map((result, index) => ({ ...result, merged_rank: index + 1 }));
  return {
    schema_version: MERGED_RETRIEVAL_SCHEMA,
    query: String(input.query || "").trim(),
    routes: routeResults.map((result) => result.route),
    strategy: "weighted-reciprocal-rank-fusion",
    local_only: routeResults.every((result) => result.local_only),
    deterministic: routeResults.every((result) => result.deterministic),
    result_count: results.length,
    results,
    route_results: input.includeRouteResults ? routeResults : undefined
  };
}

export function retrievalStatuses(input = {}) {
  const requested = input.statuses !== undefined
    ? (Array.isArray(input.statuses) ? input.statuses : [input.statuses])
    : input.status
      ? [input.status]
      : [...ACTIVE_MEMORY_STATUSES];
  const statuses = [...new Set(requested.map((status) => String(status || "").trim()).filter(Boolean))];
  if (statuses.includes("pending") && input.reviewPending !== true) {
    throw new Error("Pending memory retrieval requires reviewPending=true.");
  }
  return statuses;
}

function routeCandidates(classified, route) {
  if (route === RETRIEVAL_ROUTES.EVIDENCE_GRAPH) {
    return classified.filter(({ classification }) => intersects(classification.schemas, [
      MEMORY_SCHEMAS.RELEASE_EVIDENCE,
      MEMORY_SCHEMAS.TRUST_RECEIPT,
      MEMORY_SCHEMAS.LOOP_EVIDENCE
    ]));
  }
  if (route === RETRIEVAL_ROUTES.LOOP_RECALL) {
    return classified.filter(({ classification }) => intersects(classification.schemas, [
      MEMORY_SCHEMAS.LOOP_EVIDENCE,
      MEMORY_SCHEMAS.FAILURE_PATTERN
    ]));
  }
  if (route === RETRIEVAL_ROUTES.PROJECT_PROFILE) {
    return classified.filter(({ classification }) => intersects(classification.schemas, [
      MEMORY_SCHEMAS.PROJECT_CONVENTION,
      MEMORY_SCHEMAS.DECISION,
      MEMORY_SCHEMAS.COMMAND,
      MEMORY_SCHEMAS.FAILURE_PATTERN
    ]));
  }
  return classified;
}

function rerankWithProjectionVectors(results, projection, queryVector, embedding = {}) {
  const providerMatches = embedding.provider && embedding.provider !== "local"
    && embedding.provider === projection.vectors.provider
    && embedding.model === projection.vectors.model;
  const vectors = new Map(projection.vectors.records.map((record) => [
    record.memory_id,
    providerMatches ? record.vector : record.local_vector || record.vector
  ]));
  return results.map((result) => {
    const vectorScore = cosineSimilarity(queryVector, vectors.get(result.entry.id) || []);
    return {
      ...result,
      score: round(Number(result.score || 0) + Math.max(0, vectorScore) * 5),
      explanation: {
        ...result.explanation,
        scoreComponents: {
          ...result.explanation?.scoreComponents,
          embedding: vectorScore,
          embeddingProvider: providerMatches ? projection.vectors.provider : "local"
        }
      }
    };
  }).sort((left, right) => right.score - left.score || String(left.entry.id).localeCompare(String(right.entry.id)));
}

function rerankWithProjectionGraph(results, projection) {
  const evidenceCounts = new Map();
  for (const edge of projection.graph.edges || []) {
    if (edge.relation !== "contains_evidence" || !String(edge.from).startsWith("memory:")) continue;
    const memoryId = String(edge.from).slice("memory:".length);
    evidenceCounts.set(memoryId, (evidenceCounts.get(memoryId) || 0) + 1);
  }
  const graphMemoryIds = new Set((projection.graph.nodes || [])
    .filter((node) => node.type === "memory")
    .map((node) => node.memory_id));
  return results.map((result) => {
    const projected = graphMemoryIds.has(result.entry.id);
    const evidenceCount = evidenceCounts.get(result.entry.id) || 0;
    return {
      ...result,
      score: round(Number(result.score || 0) + (projected ? 1 : 0) + evidenceCount),
      explanation: {
        ...result.explanation,
        scoreComponents: { ...result.explanation?.scoreComponents, evidenceGraph: projected ? 1 + evidenceCount : 0 }
      }
    };
  }).sort((left, right) => right.score - left.score || String(left.entry.id).localeCompare(String(right.entry.id)));
}

function usableProjection(projection, entries, route) {
  if (!projection) return false;
  const ids = new Set(entries.map((entry) => entry.id));
  if (route === RETRIEVAL_ROUTES.EMBEDDING) {
    return Boolean(projection.vectors?.enabled && projection.vectors.records.some((record) => ids.has(record.memory_id)));
  }
  if (route === RETRIEVAL_ROUTES.EVIDENCE_GRAPH) {
    return Boolean(projection.graph?.enabled && projection.graph.nodes.some((node) => node.memory_id && ids.has(node.memory_id)));
  }
  return false;
}

function routeDefinition(id, description) {
  return {
    id,
    description,
    default_statuses: [...ACTIVE_MEMORY_STATUSES],
    pending_requires_explicit_review: true,
    network_required: false
  };
}

function normalizeRoute(route) {
  const value = String(route || RETRIEVAL_ROUTES.KEYWORD);
  if (value === "semantic_keyword") return RETRIEVAL_ROUTES.EMBEDDING;
  if (!RETRIEVAL_ROUTE_DEFINITIONS.some((definition) => definition.id === value)) throw new Error(`Invalid retrieval route: ${route}`);
  return value;
}

function normalizeRoutes(routes) {
  const values = Array.isArray(routes) ? routes : String(routes || "").split(",");
  const normalized = [...new Set(values.map((route) => String(route).trim()).filter(Boolean).map(normalizeRoute))];
  return normalized.length ? normalized : RETRIEVAL_ROUTE_DEFINITIONS.map((definition) => definition.id);
}

function normalizeLimit(limit) {
  const value = Number(limit || 10);
  return Number.isFinite(value) && value > 0 ? Math.min(100, Math.floor(value)) : 10;
}

function intersects(left, right) {
  return left.some((value) => right.includes(value));
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
