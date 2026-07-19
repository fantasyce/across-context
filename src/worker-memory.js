import { createHash } from "node:crypto";

export const WORKER_MEMORY_SCHEMA = "across-worker-memory/1.0";

const FORBIDDEN_KEYS = /(?:private[_-]?key|pairing[_-]?code|authorization|api[_-]?key|password|prompt|response|raw[_-]?log|transcript|token|credential)/i;
const ABSOLUTE_PATH = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[^\s]*)?/g;
const SECRET_TEXT = /(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|(?:sk|gh[op])[-_][A-Za-z0-9_-]{16,})/gi;
const ABSOLUTE_PATH_DETECT = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[^\s]*)?/;
const SECRET_TEXT_DETECT = /(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|(?:sk|gh[op])[-_][A-Za-z0-9_-]{16,})/i;

export function compactWorkerOutcome(input, { now = new Date() } = {}) {
  assertObject(input, "worker outcome");
  for (const key of ["run_id", "job_id", "node_id", "artifact_hash", "evidence_hash", "terminal_state"]) {
    if (!safeId(input[key])) throw new Error(`${key} is required`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(input.artifact_hash)) || !/^[0-9a-f]{64}$/.test(String(input.evidence_hash))) {
    throw new Error("worker outcome hashes must be sha256");
  }
  const observedAt = iso(input.observed_at || now);
  const expiresAt = iso(input.expires_at || new Date(new Date(observedAt).getTime() + 30 * 24 * 60 * 60 * 1000));
  if (new Date(expiresAt) <= new Date(observedAt)) throw new Error("worker memory expiry must follow observation");
  const conclusion = redactText(String(input.conclusion || "").trim()).slice(0, 1200);
  if (!conclusion) throw new Error("worker outcome conclusion is required");
  const failure = compactFailure(input.failure);
  const record = {
    schema_version: WORKER_MEMORY_SCHEMA,
    source_type: "worker_job",
    run_id: String(input.run_id),
    job_id: String(input.job_id),
    node_id: String(input.node_id),
    artifact_hash: String(input.artifact_hash),
    evidence_hash: String(input.evidence_hash),
    terminal_state: String(input.terminal_state),
    workflow_id: safeId(input.workflow_id) ? String(input.workflow_id) : null,
    platform: compactPlatform(input.platform),
    executor: safeText(input.executor, 64),
    isolation_level: safeText(input.isolation_level, 32),
    transport: ["local", "direct", "overlay", "relay"].includes(input.transport) ? input.transport : "unknown",
    conclusion,
    failure,
    observed_at: observedAt,
    expires_at: expiresAt,
    revoked: Boolean(input.revoked),
    cleanup_status: safeText(input.cleanup_status, 64),
    provenance_hash: hashJson({
      run_id: input.run_id,
      job_id: input.job_id,
      node_id: input.node_id,
      artifact_hash: input.artifact_hash,
      evidence_hash: input.evidence_hash
    })
  };
  return dropNull(record);
}

export async function rememberWorkerOutcome(vault, input, { projectRoot = null, now = new Date() } = {}) {
  if (!vault?.remember) throw new Error("Context vault is required");
  const record = compactWorkerOutcome(input, { now });
  const text = JSON.stringify(record);
  const memoryEvidenceHash = createHash("sha256").update(text).digest("hex");
  const entry = await vault.remember({
    scope: projectRoot ? "project" : "global",
    projectRoot,
    type: "note",
    text,
    tags: ["worker-job", `node:${record.node_id}`, `state:${record.terminal_state}`],
    source: "across-worker-evidence",
    source_type: "worker_job",
    source_id: `${record.run_id}:${record.job_id}`,
    trust_level: "review",
    evidence_hash: memoryEvidenceHash,
    observed_at: record.observed_at,
    expires_at: record.expires_at,
    provenance: {
      schema_version: "across-memory-provenance/1.0",
      source_type: "worker_job",
      source_id: `${record.run_id}:${record.job_id}`,
      evidence_hash: memoryEvidenceHash,
      observed_at: record.observed_at,
      expires_at: record.expires_at,
      trust_level: "review",
      node_id: record.node_id,
      artifact_hash: record.artifact_hash
    },
    auto: true,
    status: "pending"
  });
  return { ...entry, worker_memory: record };
}

export function parseWorkerMemory(memory) {
  if (!memory || typeof memory !== "object") return null;
  try {
    const value = typeof memory.text === "string" ? JSON.parse(memory.text) : memory.worker_memory || memory;
    if (value?.schema_version !== WORKER_MEMORY_SCHEMA) return null;
    return compactWorkerOutcome(value, { now: new Date(value.observed_at) });
  } catch {
    return null;
  }
}

export function recallableWorkerMemories(memories, { now = new Date(), nodeId = null } = {}) {
  const timestamp = new Date(now);
  return (Array.isArray(memories) ? memories : [])
    .filter((memory) => ["active", "pinned"].includes(memory.status))
    .map((memory) => ({ memory, parsed: parseWorkerMemory(memory) }))
    .filter(({ parsed }) => parsed && !parsed.revoked && new Date(parsed.expires_at) > timestamp)
    .filter(({ parsed }) => !nodeId || parsed.node_id === nodeId)
    .map(({ memory, parsed }) => ({ ...parsed, memory_id: memory.id, memory_status: memory.status }));
}

export function mergeWorkerExperiences(memories, { now = new Date() } = {}) {
  const records = recallableWorkerMemories(memories, { now });
  const byNode = new Map();
  for (const record of records) {
    const current = byNode.get(record.node_id) || {
      node_id: record.node_id,
      observations: 0,
      completed: 0,
      failures: {},
      transports: new Set(),
      latest_observed_at: null,
      evidence_hashes: new Set()
    };
    current.observations += 1;
    if (record.terminal_state === "completed") current.completed += 1;
    if (record.failure?.category) current.failures[record.failure.category] = (current.failures[record.failure.category] || 0) + 1;
    current.transports.add(record.transport);
    current.evidence_hashes.add(record.evidence_hash);
    if (!current.latest_observed_at || record.observed_at > current.latest_observed_at) current.latest_observed_at = record.observed_at;
    byNode.set(record.node_id, current);
  }
  return [...byNode.values()]
    .map((item) => ({
      ...item,
      success_rate: item.observations ? item.completed / item.observations : 0,
      transports: [...item.transports].sort(),
      evidence_hashes: [...item.evidence_hashes].sort()
    }))
    .sort((left, right) => left.node_id.localeCompare(right.node_id));
}

export async function revokeWorkerMemories(vault, nodeId, { projectRoot = null, now = new Date() } = {}) {
  if (!safeId(nodeId)) throw new Error("node id is required");
  const memories = await vault.listMemories({ projectRoot, includeGlobal: true });
  const ids = memories
    .filter((memory) => parseWorkerMemory(memory)?.node_id === nodeId)
    .map((memory) => memory.id);
  if (!ids.length) return { node_id: nodeId, revoked: 0 };
  const result = await vault.updateStatuses(ids, "archived", { projectRoot });
  return { node_id: nodeId, revoked: ids.length, updated_at: iso(now), result };
}

function compactFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = ["worker", "code", "network", "provider", "quality_gate", "resource", "cancelled", "security", "unknown"];
  const category = allowed.includes(value.category) ? value.category : "unknown";
  return dropNull({
    category,
    code: safeText(value.code, 80),
    retryable: Boolean(value.retryable),
    summary: redactText(safeText(value.summary, 400))
  });
}

function compactPlatform(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return dropNull({ os: safeText(value.os, 24), architecture: safeText(value.architecture, 24), version: safeText(value.version, 48) });
}

function redactText(value) {
  return String(value || "")
    .replace(ABSOLUTE_PATH, "<user-path>")
    .replace(SECRET_TEXT, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertWorkerMemorySafe(value) {
  const visit = (item, path = "$", key = "") => {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`worker memory contains forbidden field at ${path}`);
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${path}[${index}]`));
    if (item && typeof item === "object") return Object.entries(item).forEach(([name, child]) => visit(child, `${path}.${name}`, name));
    if (typeof item === "string" && (ABSOLUTE_PATH_DETECT.test(item) || SECRET_TEXT_DETECT.test(item))) throw new Error(`worker memory contains sensitive text at ${path}`);
  };
  visit(value);
  return true;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(sortObject(value))).digest("hex");
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortObject(child)]));
}

function safeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value || ""));
}

function safeText(value, limit) {
  const text = String(value || "").trim();
  return text ? text.slice(0, limit) : null;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid worker memory timestamp");
  return date.toISOString();
}

function dropNull(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
