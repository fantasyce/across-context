import { createHash } from "node:crypto";
import { classifyMemory, MEMORY_SCHEMAS } from "./memory-schema.js";
import { normalizeMemoryText, sanitizeMemoryText } from "./memory-policy.js";
import { tokenize } from "./semantic-search.js";

export const DISTILLED_MEMORY_PROPOSAL_SCHEMA = "across-context-distilled-memory-proposal/1.0";
export const DISTILLATION_RESULT_SCHEMA = "across-context-memory-distillation/1.0";

export async function improveMemory(vault, input = {}) {
  const records = await vault.listMemories({
    projectRoot: input.projectRoot,
    includeGlobal: input.includeGlobal !== false,
    includeProjects: Boolean(input.includeProjects)
  });
  const existingProposals = records.filter(isDistilledProposal);
  const allowedStatuses = new Set(input.statuses || ["pending", "active", "pinned"]);
  const selected = records.filter((entry) => allowedStatuses.has(entry.status || "active") && isDistillationSource(entry, input));
  const prepared = prepareSources(selected);
  const clusters = clusterSources(prepared.sources, input);
  const proposals = [];
  const duplicates = [];

  for (const cluster of clusters) {
    const payload = buildProposalPayload(cluster, input);
    const digest = payload.distillation.cluster_digest;
    const existing = existingProposals.find((entry) => parseProposal(entry)?.distillation?.cluster_digest === digest);
    if (existing) {
      duplicates.push({ cluster_digest: digest, memory_id: existing.id });
      continue;
    }
    const scope = cluster[0].entry.scope === "project" && input.projectRoot ? "project" : "global";
    const memory = await vault.remember({
      scope,
      projectRoot: scope === "project" ? input.projectRoot : undefined,
      type: proposalMemoryType(payload.memory_schema),
      text: JSON.stringify(payload),
      tags: ["distilled-memory", `memory-schema:${payload.memory_schema}`],
      source: "memory-distillation",
      status: "pending",
      auto: true,
      visibility: cluster.every((item) => item.entry.visibility === "team") ? "team" : "private"
    });
    proposals.push({ memory, proposal: payload });
  }

  return {
    schema_version: DISTILLATION_RESULT_SCHEMA,
    status: "completed",
    local_only: true,
    deterministic: true,
    approval_required: true,
    source_count: selected.length,
    eligible_source_count: selected.length - prepared.rejected.length,
    rejected_source_count: prepared.rejected.length,
    cluster_count: clusters.length,
    proposal_count: proposals.length,
    duplicate_proposal_count: duplicates.length,
    rejected_sources: prepared.rejected,
    duplicates,
    proposals
  };
}

export async function approveDistilledMemory(vault, id) {
  const proposal = await requireProposal(vault, id);
  if (proposal.entry.status !== "pending") throw new Error(`Distilled proposal must be pending before approval: ${id}`);
  const sourceTransitions = proposal.payload.provenance.sources
    .filter((source) => source.status === "pending" || source.type === "session")
    .map((source) => ({ id: source.memory_id, status: "archived" }));
  const result = await vault.updateStatusTransitions([
    { id, status: "active" },
    ...sourceTransitions
  ], { allowMissing: true });
  return {
    schema_version: "across-context-distilled-memory-approval/1.0",
    proposal_id: id,
    status: "active",
    archived_source_ids: result.updated.filter((entry) => entry.id !== id).map((entry) => entry.id),
    missing_source_ids: result.missing
  };
}

export async function approveGovernedMemory(vault, id) {
  const records = await vault.listMemories({ includeGlobal: true, includeProjects: true });
  const entry = records.find((item) => item.id === id);
  if (!entry) throw new Error(`Memory not found: ${id}`);
  return isDistilledProposal(entry) ? approveDistilledMemory(vault, id) : vault.updateStatus(id, "active");
}

export async function rollbackDistilledMemory(vault, id) {
  const proposal = await requireProposal(vault, id);
  const transitions = [{ id, status: "archived" }];
  for (const source of proposal.payload.provenance.sources) {
    transitions.push({ id: source.memory_id, status: source.status });
  }
  const result = await vault.updateStatusTransitions(transitions, { allowMissing: true });
  return {
    schema_version: "across-context-distilled-memory-rollback/1.0",
    proposal_id: id,
    status: "archived",
    restored_source_ids: result.updated.filter((entry) => entry.id !== id).map((entry) => entry.id),
    missing_source_ids: result.missing
  };
}

export function isDistilledProposal(entry) {
  return parseProposal(entry)?.schema_version === DISTILLED_MEMORY_PROPOSAL_SCHEMA;
}

export function proposalSourceIds(entry) {
  const payload = parseProposal(entry);
  return payload?.provenance?.sources?.map((source) => source.memory_id).filter(Boolean) || [];
}

function isDistillationSource(entry, input) {
  if (isDistilledProposal(entry)) return false;
  if (input.sourceIds?.length && !input.sourceIds.includes(entry.id)) return false;
  return entry.type === "session" || entry.status === "pending";
}

function prepareSources(entries) {
  const sources = [];
  const rejected = [];
  const exact = new Map();
  for (const entry of [...entries].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const sanitized = sanitizeMemoryText(entry.text);
    if (!sanitized.accepted) {
      rejected.push({ memory_id: entry.id, reason: "secret_detected" });
      continue;
    }
    const text = compactSourceText(sanitized.text);
    const key = `${entry.projectId || "global"}:${normalizeMemoryText(text)}`;
    if (exact.has(key)) {
      exact.get(key).duplicates.push({ entry, text, privacy: privacySummary(sanitized) });
      continue;
    }
    const source = {
      entry,
      text,
      classification: classifyMemory({ ...entry, text }),
      privacy: privacySummary(sanitized),
      duplicates: []
    };
    sources.push(source);
    exact.set(key, source);
  }
  return { sources, rejected };
}

function clusterSources(sources, input) {
  const threshold = Number(input.similarityThreshold || 0.34);
  const maxClusterSize = Math.max(1, Math.min(6, Number(input.maxClusterSize || 4)));
  const clusters = [];
  for (const source of sources) {
    const target = clusters.find((cluster) => cluster.length < maxClusterSize && sameCluster(cluster[0], source, threshold));
    if (target) target.push(source);
    else clusters.push([source]);
  }
  return clusters.map((cluster) => cluster.sort((a, b) => String(a.entry.id).localeCompare(String(b.entry.id))));
}

function sameCluster(left, right, threshold) {
  if ((left.entry.projectId || "global") !== (right.entry.projectId || "global")) return false;
  if (left.classification.primary_schema !== right.classification.primary_schema) return false;
  const leftTokens = new Set(tokenize(left.text).filter((token) => token.length > 2));
  const rightTokens = new Set(tokenize(right.text).filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union >= threshold;
}

function buildProposalPayload(cluster, input) {
  const memorySchema = cluster[0].classification.primary_schema;
  const sourceSummaries = cluster.map((source) => source.text).filter(Boolean);
  const distilledText = distillText(sourceSummaries, Number(input.maxProposalLength || 420));
  const sourceRecords = cluster.flatMap((source) => [source, ...source.duplicates].map((item) => ({
    memory_id: item.entry.id,
    digest: sha256(item.text),
    type: item.entry.type,
    status: item.entry.status || "active",
    scope: item.entry.scope,
    project_id: item.entry.projectId || null,
    redactions: item.privacy.redaction_count
  }))).sort((left, right) => left.memory_id.localeCompare(right.memory_id));
  const clusterDigest = sha256(sourceRecords.map((source) => source.digest).sort().join(":"));
  return {
    schema_version: DISTILLED_MEMORY_PROPOSAL_SCHEMA,
    memory_schema: memorySchema,
    distilled_text: distilledText,
    governance: {
      status: "pending",
      approval_required: true,
      activation: "explicit_approval_only",
      rollback_supported: true,
      forgetting_propagates: true
    },
    provenance: {
      source_count: sourceRecords.length,
      sources: sourceRecords
    },
    distillation: {
      algorithm: "deterministic-token-cluster-compression-v1",
      cluster_digest: clusterDigest,
      duplicate_strategy: "normalized_exact_then_schema_token_jaccard",
      merge_strategy: "stable_sentence_union",
      provider_used: false,
      network_performed: false
    }
  };
}

function compactSourceText(text) {
  try {
    const payload = JSON.parse(text);
    const candidates = [payload.summary, payload.outcome, payload.goal, payload.text, payload.pr_ready_summary]
      .filter((value) => typeof value === "string" && value.trim());
    return candidates.length ? candidates.join(" ") : text;
  } catch {
    return text;
  }
}

function distillText(values, maxLength) {
  const sentences = [];
  const seen = new Set();
  for (const value of values) {
    for (const sentence of String(value).split(/(?<=[.!?])\s+|\n+/)) {
      const normalized = normalizeMemoryText(sentence);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      sentences.push(sentence.trim());
    }
  }
  const joined = sentences.join(" ");
  if (joined.length <= maxLength) return joined;
  return `${joined.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

async function requireProposal(vault, id) {
  const records = await vault.listMemories({ includeGlobal: true, includeProjects: true });
  const entry = records.find((item) => item.id === id);
  if (!entry) throw new Error(`Memory not found: ${id}`);
  const payload = parseProposal(entry);
  if (!payload || payload.schema_version !== DISTILLED_MEMORY_PROPOSAL_SCHEMA) {
    throw new Error(`Memory is not a distilled proposal: ${id}`);
  }
  return { entry, payload };
}

function parseProposal(entry) {
  try {
    const payload = JSON.parse(String(entry?.text || ""));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function proposalMemoryType(schema) {
  if (schema === MEMORY_SCHEMAS.DECISION) return "decision";
  if (schema === MEMORY_SCHEMAS.COMMAND) return "command";
  if (schema === MEMORY_SCHEMAS.PROJECT_CONVENTION) return "preference";
  return "note";
}

function privacySummary(sanitized) {
  return {
    redaction_count: sanitized.redactionCount,
    path_redactions: sanitized.localPathRedactions,
    transcript_redactions: sanitized.rawTranscriptRedactions,
    reasoning_redactions: sanitized.hiddenReasoningRedactions
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
