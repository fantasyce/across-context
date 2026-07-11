import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ACTIVE_MEMORY_STATUSES } from "./vault.js";
import { atomicWriteFile, withFileLock } from "./file-lock.js";
import { classifyMemory } from "./memory-schema.js";
import { sanitizeMemoryText } from "./memory-policy.js";
import { tokenize } from "./semantic-search.js";
import { embedWithFallback, LOCAL_EMBEDDING_ALGORITHM } from "./embedding-adapter.js";

export const MEMORY_PROJECTION_SCHEMA = "across-context-memory-projection/1.0";
export const MEMORY_PROJECTION_PRIVACY_SCHEMA = "across-context-projection-privacy/1.0";
const DEFAULT_DIMENSIONS = 48;

export function projectionPrivacyPolicy() {
  return {
    schema_version: MEMORY_PROJECTION_PRIVACY_SCHEMA,
    authority: "jsonl_vault",
    derived_state_only: true,
    local_only: true,
    network_required: false,
    provider_required: false,
    default_statuses: [...ACTIVE_MEMORY_STATUSES],
    secret_policy: "exclude_record",
    absolute_path_policy: "redact",
    raw_transcript_policy: "redact",
    hidden_reasoning_policy: "redact",
    vector_algorithm: "sha256-token-hash-v1"
  };
}

export async function rebuildMemoryProjection(vault, options = {}) {
  await vault.init();
  return withFileLock(projectionLockPath(vault), async () => {
    const config = normalizeProjectionConfig(options);
    const entries = await vault.listMemories({
      includeGlobal: true,
      includeProjects: true,
      statuses: config.statuses
    });
    const projection = options.embeddingAdapter
      ? await buildMemoryProjectionWithAdapter(entries, { ...config, embeddingAdapter: options.embeddingAdapter, strictEmbedding: options.strictEmbedding })
      : buildMemoryProjection(entries, config);
    await atomicWriteFile(projectionConfigPath(vault), `${stableJson(config)}\n`);
    await atomicWriteFile(projectionIndexPath(vault), `${stableJson(projection)}\n`);
    return projection;
  });
}

export async function buildMemoryProjectionWithAdapter(entries = [], options = {}) {
  const localProjection = buildMemoryProjection(entries, options);
  if (!localProjection.vectors.enabled || !options.embeddingAdapter) return localProjection;
  const texts = projectionVectorTexts(localProjection, entries);
  const embedded = await embedWithFallback(texts, {
    adapter: options.embeddingAdapter,
    strict: Boolean(options.strictEmbedding),
    fallback: (text) => vectorizeText(text, localProjection.config.dimensions)
  });
  const records = localProjection.vectors.records.map((record, index) => embedded.provider === "local"
    ? { ...record, vector: embedded.vectors[index] }
    : { ...record, local_vector: record.vector, vector: embedded.vectors[index] });
  const dimensions = records[0]?.vector?.length || localProjection.config.dimensions;
  return {
    ...localProjection,
    config: {
      ...localProjection.config,
      dimensions,
      embedding_provider: embedded.provider,
      embedding_model: embedded.model
    },
    privacy_policy: {
      ...localProjection.privacy_policy,
      provider_required: false,
      vector_algorithm: embedded.algorithm
    },
    vectors: {
      enabled: true,
      algorithm: embedded.algorithm,
      provider: embedded.provider,
      model: embedded.model,
      dimensions,
      local_dimensions: localProjection.vectors.dimensions,
      fallback_used: embedded.fallback_used,
      fallback_reason: embedded.fallback_reason,
      network_performed: embedded.network_performed,
      summary: { record_count: records.length, dimensions },
      records
    }
  };
}

export function buildMemoryProjection(entries = [], options = {}) {
  const config = normalizeProjectionConfig(options);
  const eligibleEntries = entries.filter((entry) => config.statuses.includes(entry.status || "active"));
  const included = [];
  const excluded = [];
  for (const entry of [...eligibleEntries].sort(compareEntries)) {
    const sanitized = sanitizeProjectionEntry(entry);
    if (sanitized.excluded) excluded.push(sanitized.excluded);
    else included.push(sanitized.entry);
  }

  const graph = config.graph ? buildGraphProjection(included) : disabledProjection("graph");
  const vectors = config.vector ? buildVectorProjection(included, config.dimensions) : disabledProjection("vector");
  const sourceDigest = sha256(stableJson(included.map(sourceDigestRecord)));
  return {
    schema_version: MEMORY_PROJECTION_SCHEMA,
    projection_id: `projection_${sourceDigest.slice(0, 16)}`,
    authoritative_store: "jsonl_vault",
    authoritative_store_mutated: false,
    privacy_policy: projectionPrivacyPolicy(),
    config,
    source_digest: sourceDigest,
    source_record_count: eligibleEntries.length,
    included_record_count: included.length,
    excluded_record_count: excluded.length,
    excluded_records: excluded,
    graph,
    vectors
  };
}

export async function inspectMemoryProjection(vault) {
  await vault.init();
  try {
    const projection = JSON.parse(await readFile(projectionIndexPath(vault), "utf8"));
    const currentEntries = await vault.listMemories({
      includeGlobal: true,
      includeProjects: true,
      statuses: ACTIVE_MEMORY_STATUSES
    });
    const currentSourceDigest = buildMemoryProjection(currentEntries, projection.config).source_digest;
    const stale = currentSourceDigest !== projection.source_digest;
    return {
      schema_version: "across-context-memory-projection-inspection/1.0",
      status: stale ? "stale" : "ready",
      stale,
      projection_id: projection.projection_id,
      source_digest: projection.source_digest,
      current_source_digest: currentSourceDigest,
      source_record_count: projection.source_record_count,
      included_record_count: projection.included_record_count,
      excluded_record_count: projection.excluded_record_count,
      graph: projection.graph.enabled ? projection.graph.summary : { enabled: false },
      vectors: projection.vectors.enabled ? projection.vectors.summary : { enabled: false },
      config: projection.config,
      privacy_policy: projection.privacy_policy
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      schema_version: "across-context-memory-projection-inspection/1.0",
      status: "not_built",
      privacy_policy: projectionPrivacyPolicy()
    };
  }
}

export async function readMemoryProjection(vault) {
  try {
    return JSON.parse(await readFile(projectionIndexPath(vault), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function refreshMemoryProjectionIfPresent(vault) {
  if (!await projectionExists(vault)) return null;
  const config = await readProjectionConfig(vault);
  return rebuildMemoryProjection(vault, config);
}

export async function forgetProjectedMemory(vault, memoryId) {
  const result = await vault.forget(memoryId);
  const projection = await readMemoryProjection(vault);
  if (projection?.graph?.nodes?.some((node) => node.memory_id === memoryId)) {
    await rebuildMemoryProjection(vault, projection.config);
  }
  return {
    schema_version: "across-context-projection-forget/1.0",
    memory_id: memoryId,
    authoritative_forgotten: result.forgotten,
    projection_updated: Boolean(await readMemoryProjection(vault))
  };
}

export function vectorizeText(text, dimensions = DEFAULT_DIMENSIONS) {
  const size = normalizeDimensions(dimensions);
  const vector = Array(size).fill(0);
  const frequencies = new Map();
  for (const token of tokenize(text)) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  for (const [token, count] of [...frequencies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt16BE(0) % size;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(count));
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => magnitude ? round(value / magnitude) : 0);
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += Number(left[index] || 0) * Number(right[index] || 0);
  return round(score);
}

function sanitizeProjectionEntry(entry) {
  const sanitized = sanitizeMemoryText(entry.text);
  if (!sanitized.accepted) {
    return { excluded: { memory_id: entry.id, reason: "secret_detected" } };
  }
  const tags = (entry.tags || []).map((tag) => sanitizeMemoryText(tag)).filter((result) => result.accepted).map((result) => result.text);
  const classification = classifyMemory({ ...entry, text: sanitized.text, tags });
  return {
    entry: {
      id: entry.id,
      scope: entry.scope,
      type: entry.type,
      status: entry.status || "active",
      visibility: entry.visibility || "private",
      project_id: entry.projectId || null,
      project_name: sanitizeLabel(entry.projectName),
      tags: [...new Set(tags)].sort(),
      text: sanitized.text,
      created_at: entry.createdAt || null,
      updated_at: entry.updatedAt || entry.createdAt || null,
      classification,
      privacy: {
        redaction_count: sanitized.redactionCount,
        absolute_paths_redacted: sanitized.localPathRedactions,
        raw_transcripts_redacted: sanitized.rawTranscriptRedactions,
        hidden_reasoning_redacted: sanitized.hiddenReasoningRedactions
      }
    }
  };
}

function buildGraphProjection(entries) {
  const nodes = new Map();
  const edges = new Map();
  for (const entry of entries) {
    const memoryNodeId = `memory:${entry.id}`;
    addNode(nodes, {
      id: memoryNodeId,
      type: "memory",
      memory_id: entry.id,
      schema: entry.classification.primary_schema,
      schemas: entry.classification.schemas,
      status: entry.status,
      scope: entry.scope,
      project_id: entry.project_id,
      text: entry.text.slice(0, 800),
      tags: entry.tags
    });
    for (const schema of entry.classification.schemas) {
      const schemaNodeId = `schema:${schema}`;
      addNode(nodes, { id: schemaNodeId, type: "memory_schema", schema });
      addEdge(edges, { from: memoryNodeId, to: schemaNodeId, relation: "classified_as" });
    }
    if (entry.project_id) {
      const projectNodeId = `project:${entry.project_id}`;
      addNode(nodes, { id: projectNodeId, type: "project", project_id: entry.project_id, name: entry.project_name });
      addEdge(edges, { from: memoryNodeId, to: projectNodeId, relation: "belongs_to" });
    }
    for (const tag of entry.tags) {
      const tagNodeId = `tag:${sha256(tag).slice(0, 16)}`;
      addNode(nodes, { id: tagNodeId, type: "tag", value: tag });
      addEdge(edges, { from: memoryNodeId, to: tagNodeId, relation: "tagged_with" });
    }
    addEmbeddedEvidence(entry, nodes, edges);
  }
  addCrossMemoryEdges(entries, edges);
  const sortedNodes = [...nodes.values()].sort(compareGraphItem);
  const sortedEdges = [...edges.values()].sort(compareGraphItem);
  return {
    enabled: true,
    summary: {
      node_count: sortedNodes.length,
      edge_count: sortedEdges.length,
      memory_node_count: entries.length
    },
    nodes: sortedNodes,
    edges: sortedEdges
  };
}

function buildVectorProjection(entries, dimensions) {
  const records = entries.map((entry) => ({
    memory_id: entry.id,
    schema: entry.classification.primary_schema,
    vector: vectorizeText([entry.text, entry.tags.join(" "), entry.classification.schemas.join(" ")].join(" "), dimensions)
  })).sort((a, b) => a.memory_id.localeCompare(b.memory_id));
  return {
    enabled: true,
    algorithm: LOCAL_EMBEDDING_ALGORITHM,
    provider: "local",
    model: LOCAL_EMBEDDING_ALGORITHM,
    fallback_used: false,
    network_performed: false,
    dimensions,
    summary: { record_count: records.length, dimensions },
    records
  };
}

function projectionVectorTexts(projection, entries) {
  const memories = new Map(entries.map((entry) => sanitizeProjectionEntry(entry).entry).filter(Boolean)
    .map((entry) => [entry.id, [entry.text, ...(entry.tags || []), ...(entry.classification.schemas || [])].join(" ")]));
  return projection.vectors.records.map((record) => memories.get(record.memory_id) || record.memory_id);
}

function addEmbeddedEvidence(entry, nodes, edges) {
  let payload;
  try {
    payload = JSON.parse(entry.text);
  } catch {
    return;
  }
  const graph = payload?.graph || (payload?.evidence_graph ? {
    nodes: payload.evidence_graph.node_refs || [],
    edges: payload.evidence_graph.edge_refs || []
  } : null);
  if (!graph || typeof graph !== "object") return;
  for (const node of graph.nodes || []) {
    const id = `evidence:${entry.id}:${String(node.id || sha256(stableJson(node)).slice(0, 12))}`;
    addNode(nodes, {
      id,
      type: "evidence",
      memory_id: entry.id,
      evidence_type: sanitizeLabel(node.type),
      status: sanitizeLabel(node.status),
      hash: sanitizeLabel(node.hash),
      summary: sanitizeLabel(node.summary)
    });
    addEdge(edges, { from: `memory:${entry.id}`, to: id, relation: "contains_evidence" });
  }
  for (const edge of graph.edges || []) {
    addEdge(edges, {
      from: `evidence:${entry.id}:${String(edge.from || "unknown")}`,
      to: `evidence:${entry.id}:${String(edge.to || "unknown")}`,
      relation: sanitizeLabel(edge.relation) || "relates_to",
      memory_id: entry.id
    });
  }
}

function addCrossMemoryEdges(entries, edges) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      if ((left.project_id || "global") !== (right.project_id || "global")) continue;
      const sharedTags = left.tags.filter((tag) => right.tags.includes(tag));
      if (!sharedTags.length && !sharesMeaningfulToken(left.text, right.text)) continue;
      const relation = relationshipFor(left, right);
      if (!relation) continue;
      addEdge(edges, { from: `memory:${left.id}`, to: `memory:${right.id}`, relation, shared_tags: sharedTags });
    }
  }
}

function relationshipFor(left, right) {
  const combined = new Set([...left.classification.schemas, ...right.classification.schemas]);
  if (combined.has("failure_pattern") && combined.has("command")) return "addressed_by";
  if (combined.has("release_evidence") && combined.has("decision")) return "supports";
  if (combined.has("loop_evidence") && combined.has("failure_pattern")) return "observed_failure";
  return null;
}

function sharesMeaningfulToken(left, right) {
  const leftTokens = new Set(tokenize(left).filter((token) => token.length >= 6));
  return tokenize(right).some((token) => token.length >= 6 && leftTokens.has(token));
}

function sourceDigestRecord(entry) {
  return {
    id: entry.id,
    status: entry.status,
    text: entry.text,
    tags: entry.tags,
    classification: entry.classification,
    updated_at: entry.updated_at
  };
}

function normalizeProjectionConfig(options = {}) {
  return {
    graph: options.graph !== false,
    vector: options.vector !== false,
    dimensions: normalizeDimensions(options.dimensions || DEFAULT_DIMENSIONS),
    statuses: [...ACTIVE_MEMORY_STATUSES].sort()
  };
}

function normalizeDimensions(dimensions) {
  const value = Number(dimensions || DEFAULT_DIMENSIONS);
  if (!Number.isInteger(value) || value < 8 || value > 512) throw new Error(`Invalid projection dimensions: ${dimensions}`);
  return value;
}

async function readProjectionConfig(vault) {
  try {
    return JSON.parse(await readFile(projectionConfigPath(vault), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return normalizeProjectionConfig();
    throw error;
  }
}

async function projectionExists(vault) {
  try {
    await access(projectionIndexPath(vault));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function projectionRoot(vault) {
  return join(vault.home, "projections");
}

function projectionIndexPath(vault) {
  return join(projectionRoot(vault), "memory-projection.json");
}

function projectionConfigPath(vault) {
  return join(projectionRoot(vault), "memory-projection.config.json");
}

function projectionLockPath(vault) {
  return join(projectionRoot(vault), ".projection.lock");
}

function disabledProjection(kind) {
  return { enabled: false, kind };
}

function sanitizeLabel(value) {
  if (value === undefined || value === null) return null;
  const sanitized = sanitizeMemoryText(String(value));
  return sanitized.accepted ? sanitized.text.slice(0, 400) : "[REDACTED]";
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) nodes.set(node.id, dropNull(node));
}

function addEdge(edges, edge) {
  const normalized = dropNull(edge);
  const key = stableJson(normalized);
  if (!edges.has(key)) edges.set(key, normalized);
}

function compareEntries(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function compareGraphItem(left, right) {
  return stableJson(left).localeCompare(stableJson(right));
}

function dropNull(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}
