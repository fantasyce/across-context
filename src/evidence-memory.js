import { createHash } from "node:crypto";
import { enforceLoopMemoryPolicy } from "./autopilot-loop-memory.js";
import { ACTIVE_MEMORY_STATUSES } from "./vault.js";

export const EVIDENCE_MEMORY_SCHEMA = "across-evidence-memory/1.0";
export const EVIDENCE_RECALL_SCHEMA = "across-context-evidence-recall/1.0";

export async function rememberEvidenceMemory(vault, input = {}) {
  const graph = requiredObject(input.graph || input.evidence_graph, "graph");
  const specId = required(input.specId || input.spec_id || graph.spec_id, "spec id");
  const runId = required(input.runId || input.run_id || graph.run_id, "run id");
  const compactGraph = compactEvidenceGraph(graph);
  const summary = String(input.summary || compactGraph.summary_text || `Evidence graph for ${specId}/${runId}`).trim();
  let payload = evidenceMemoryPayload({ specId, runId, summary, compactGraph, includeRefs: true });
  let payloadText = stableJson(payload);
  if (payloadText.length > 1000) {
    payload = evidenceMemoryPayload({ specId, runId, summary, compactGraph, includeRefs: false });
    payloadText = stableJson(payload);
  }
  const policy = enforceLoopMemoryPolicy(payloadText);
  if (policy.status === "rejected") {
    return {
      schema_version: EVIDENCE_MEMORY_SCHEMA,
      provider: "across-context",
      spec_id: specId,
      run_id: runId,
      status: "rejected",
      reason: policy.reason,
      memory: null
    };
  }
  const entry = await vault.remember({
    text: policy.text,
    scope: "global",
    type: "session",
    tags: ["evidence-graph", "agent-loop-evidence", `spec:${specId}`, `run:${runId}`],
    source: "evidence-graph",
    auto: true,
    status: "pending",
    visibility: "private"
  });
  return {
    schema_version: EVIDENCE_MEMORY_SCHEMA,
    provider: "across-context",
    spec_id: specId,
    run_id: runId,
    status: policy.status,
    redactions: policy.redactions || 0,
    memory: entry
  };
}

export async function recallEvidenceMemory(vault, options = {}) {
  const specId = options.specId || options.spec_id;
  const runId = options.runId || options.run_id;
  const limit = Number(options.limit || 10);
  const memories = await vault.listMemories({
    includeGlobal: true,
    includeProjects: true,
    ...recallStatusFilter(options)
  });
  const parsed = memories
    .map((entry) => ({ entry, payload: parseEvidenceMemory(entry.text) }))
    .filter((item) => item.payload)
    .filter((item) => !specId || item.payload.spec_id === specId)
    .filter((item) => !runId || item.payload.run_id === runId)
    .sort((a, b) => String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)))
    .slice(0, limit);
  return {
    schema_version: EVIDENCE_RECALL_SCHEMA,
    provider: "across-context",
    spec_id: specId || null,
    run_id: runId || null,
    result_count: parsed.length,
    results: parsed.map(({ entry, payload }) => ({
      memory_id: entry.id,
      status: entry.status,
      created_at: entry.createdAt,
      spec_id: payload.spec_id,
      run_id: payload.run_id,
      summary: payload.summary,
      graph_summary: payload.evidence_graph?.summary || {},
      graph_hash: payload.evidence_graph?.graph_hash || null,
      goal_id: payload.evidence_graph?.goal_id || null,
      goal_revision: payload.evidence_graph?.goal_revision || null,
      input_fingerprint: payload.evidence_graph?.input_fingerprint || null,
      criterion_ids: payload.evidence_graph?.criterion_ids || []
    }))
  };
}

export function compactEvidenceGraph(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const goalFieldsPresent = [graph.goal_id, graph.goal_revision, graph.input_fingerprint, graph.criterion_ids]
    .some((value) => value !== undefined && value !== null);
  let goalBinding = {};
  if (goalFieldsPresent) {
    if (typeof graph.goal_id !== "string" || !graph.goal_id.trim()) {
      throw new TypeError("Goal evidence binding requires goal_id");
    }
    if (!Number.isInteger(graph.goal_revision) || graph.goal_revision < 1) {
      throw new TypeError("Goal evidence binding goal_revision must be a positive integer");
    }
    if (typeof graph.input_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(graph.input_fingerprint)) {
      throw new TypeError("Goal evidence binding input_fingerprint must be a sha256 digest");
    }
    if (!Array.isArray(graph.criterion_ids)
      || graph.criterion_ids.length === 0
      || graph.criterion_ids.some((item) => typeof item !== "string" || !item.trim())) {
      throw new TypeError("Goal evidence binding criterion_ids must be non-empty strings");
    }
    goalBinding = {
      goal_id: graph.goal_id.trim(),
      goal_revision: graph.goal_revision,
      input_fingerprint: graph.input_fingerprint,
      criterion_ids: [...new Set(graph.criterion_ids.map((item) => item.trim()))].sort()
    };
  }
  const compact = {
    schema_version: "across-evidence-graph/1.0",
    run_id: graph.run_id || null,
    spec_id: graph.spec_id || null,
    status: graph.status || "unknown",
    ...goalBinding,
    nodes: nodes.slice(0, 200).map((node) => ({
      id: String(node.id || ""),
      type: String(node.type || "unknown"),
      status: String(node.status || "unknown"),
      hash: String(node.hash || sha256(stableJson(node.payload ?? node.id ?? "")))
    })).filter((node) => node.id),
    edges: edges.slice(0, 400).map((edge) => ({
      from: String(edge.from || ""),
      to: String(edge.to || ""),
      relation: String(edge.relation || "related")
    })).filter((edge) => edge.from && edge.to),
    summary: {
      ...(graph.summary || {}),
      compacted: nodes.length > 200 || edges.length > 400,
      original_node_count: nodes.length,
      original_edge_count: edges.length
    }
  };
  return {
    ...compact,
    graph_hash: sha256(stableJson(compact)),
    summary_text: `${compact.summary.original_node_count} evidence nodes and ${compact.summary.original_edge_count} evidence edges`
  };
}

function evidenceMemoryPayload({ specId, runId, summary, compactGraph, includeRefs }) {
  const evidenceGraph = {
    schema_version: compactGraph.schema_version,
    run_id: compactGraph.run_id,
    spec_id: compactGraph.spec_id,
    status: compactGraph.status,
    summary: compactGraph.summary,
    graph_hash: compactGraph.graph_hash
  };
  if (compactGraph.goal_id) {
    evidenceGraph.goal_id = compactGraph.goal_id;
    evidenceGraph.goal_revision = compactGraph.goal_revision;
    evidenceGraph.input_fingerprint = compactGraph.input_fingerprint;
    evidenceGraph.criterion_ids = compactGraph.criterion_ids;
  }
  if (includeRefs) {
    evidenceGraph.node_refs = compactGraph.nodes.slice(0, 3).map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      hash: node.hash
    }));
    evidenceGraph.edge_refs = compactGraph.edges.slice(0, 4).map((edge) => ({
      from: edge.from,
      to: edge.to,
      relation: edge.relation
    }));
  }
  return {
    schema_version: EVIDENCE_MEMORY_SCHEMA,
    provider: "across-context",
    spec_id: specId,
    run_id: runId,
    status: "pending",
    summary,
    evidence_graph: evidenceGraph,
    created_at: new Date().toISOString()
  };
}

function parseEvidenceMemory(text) {
  try {
    const payload = JSON.parse(text);
    return payload?.schema_version === EVIDENCE_MEMORY_SCHEMA ? payload : null;
  } catch {
    return null;
  }
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function requiredObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  return value;
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function recallStatusFilter(options = {}) {
  return options.status !== undefined && String(options.status).trim() !== ""
    ? { status: options.status }
    : { statuses: ACTIVE_MEMORY_STATUSES };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}
