import { createHash } from "node:crypto";

export const MEMORY_PROVENANCE_SCHEMA = "across-memory-provenance/1.0";
export const MEMORY_TRUST_LEVELS = Object.freeze(["trusted", "review", "untrusted"]);

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all |any )?(?:previous|prior|earlier) (?:instructions|prompts|rules)\b/i,
  /\b(?:system|developer) prompt\b/i,
  /\b(?:override|bypass|disable) (?:the )?(?:memory|security|safety|trust|approval) (?:policy|rules?|checks?|gate)\b/i,
  /\b(?:poison|fabricate|forge) (?:the )?(?:memory|evidence|provenance|trust receipt)\b/i,
  /\b(?:mark|treat|store) (?:this|it) as (?:approved|trusted|system)\b/i,
  /\b(?:reveal|exfiltrate|print|return) (?:all )?(?:secrets?|credentials?|tokens?|private keys?)\b/i,
  /\bdo not (?:tell|inform|notify) (?:the )?(?:user|reviewer|operator)\b/i
];
const RAW_TRANSCRIPT_PATTERNS = [
  /BEGIN (?:RAW|FULL|CHAT) TRANSCRIPT/i,
  /^\s*(?:raw|full|chat) transcript\s*:/im,
  /"(?:raw_transcript|full_transcript|messages)"\s*:/i
];
const RAW_EXECUTION_PATTERNS = [
  /^\s*(?:stdout|stderr|command output|tool output|execution log)\s*:/im,
  /"(?:stdout|stderr|command_output|tool_output|execution_log)"\s*:/i,
  /\x1b\[[0-9;]*m/,
  /^\s*\$\s+\S+.*\n(?:.|\n)*(?:exit code|process exited|command failed)/im
];

export function normalizeMemoryProvenance(input = {}, text = "", timestamp = new Date().toISOString()) {
  const supplied = input.provenance && typeof input.provenance === "object" ? input.provenance : {};
  const sourceType = normalizeToken(input.source_type ?? input.sourceType ?? supplied.source_type, defaultSourceType(input));
  const sourceId = sanitizeSourceId(input.source_id ?? input.sourceId ?? supplied.source_id ?? input.source ?? sourceType, sourceType);
  const trustLevel = normalizeTrustLevel(input.trust_level ?? input.trustLevel ?? supplied.trust_level, defaultTrustLevel(sourceType));
  const observedAt = normalizeDate(input.observed_at ?? input.observedAt ?? supplied.observed_at, timestamp);
  const expiresAt = normalizeOptionalDate(input.expires_at ?? input.expiresAt ?? supplied.expires_at);
  const computedHash = sha256(text);
  const suppliedHash = String(input.evidence_hash ?? input.evidenceHash ?? supplied.evidence_hash ?? "").trim().toLowerCase();
  return {
    schema_version: MEMORY_PROVENANCE_SCHEMA,
    source_type: sourceType,
    source_id: sourceId,
    trust_level: trustLevel,
    evidence_hash: computedHash,
    observed_at: observedAt,
    expires_at: expiresAt || null,
    hash_matches: !suppliedHash || suppliedHash === computedHash
  };
}

export function quarantineAssessment(input = {}, text = "", provenance = {}) {
  const reasons = [];
  const value = String(text || "");
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) reasons.push("suspected_prompt_injection");
  if (RAW_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(value))) reasons.push("raw_transcript");
  if (RAW_EXECUTION_PATTERNS.some((pattern) => pattern.test(value))) reasons.push("raw_execution_log");
  if (looksLikeMalformedJson(value)) reasons.push("malformed_or_truncated_json");
  if (provenance.hash_matches === false) reasons.push("evidence_hash_mismatch");
  if (provenance.source_type === "plugin" && provenance.trust_level !== "trusted") reasons.push("untrusted_plugin_output");
  if (provenance.trust_level === "untrusted") reasons.push("untrusted_source");
  return [...new Set(reasons)].sort();
}

export function isMemoryExpired(entry, at = new Date()) {
  const expiresAt = entry?.provenance?.expires_at;
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires <= at.getTime();
}

export function effectiveMemoryStatus(entry, at = new Date()) {
  const status = entry?.status || "active";
  if (["active", "pinned", "pending"].includes(status) && isMemoryExpired(entry, at)) return "expired";
  return status;
}

export function isTrustedForActivation(entry, at = new Date()) {
  if (!entry?.provenance) return !isMemoryExpired(entry, at);
  return entry.provenance.schema_version === MEMORY_PROVENANCE_SCHEMA
    && entry.provenance.trust_level === "trusted"
    && !isMemoryExpired(entry, at)
    && !(entry.policy?.quarantineReasons || []).length;
}

export function goalMemoryAuthorityLabel(entry, payload, currentGoalRevision, at = new Date()) {
  const eligible = payload?.trust === "trusted"
    && ["active", "pinned"].includes(effectiveMemoryStatus(entry, at))
    && isTrustedForActivation(entry, at);
  return eligible
    && currentGoalRevision !== undefined
    && currentGoalRevision !== null
    && Number(currentGoalRevision) === Number(payload?.goal_revision)
    ? "current_authority_reference"
    : "historical_memory";
}

export function compactTrustSummary(entries = [], at = new Date()) {
  const normalized = entries.map((entry) => ({ ...entry, status: effectiveMemoryStatus(entry, at) }));
  return {
    schema_version: "across-memory-trust-summary/1.0",
    provenance_schema: MEMORY_PROVENANCE_SCHEMA,
    memory_count: normalized.length,
    by_trust_level: countBy(normalized, (entry) => entry.provenance?.trust_level || "legacy_unspecified"),
    by_source_type: countBy(normalized, (entry) => entry.provenance?.source_type || "legacy"),
    by_status: countBy(normalized, (entry) => entry.status),
    freshness: {
      fresh: normalized.filter((entry) => entry.provenance?.expires_at && entry.status !== "expired").length,
      expired: normalized.filter((entry) => entry.status === "expired").length,
      no_expiry: normalized.filter((entry) => !entry.provenance?.expires_at).length
    },
    records: normalized.map((entry) => ({
      id: entry.id,
      status: entry.status,
      source_type: entry.provenance?.source_type || "legacy",
      source_id_hash: sha256(entry.provenance?.source_id || "legacy").slice(0, 16),
      trust_level: entry.provenance?.trust_level || "legacy_unspecified",
      evidence_hash: entry.provenance?.evidence_hash || null,
      observed_at: entry.provenance?.observed_at || entry.createdAt || null,
      expires_at: entry.provenance?.expires_at || null,
      quarantine_reasons: entry.policy?.quarantineReasons || []
    }))
  };
}

function looksLikeMalformedJson(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("{") && !value.startsWith("[")) return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

function defaultSourceType(input) {
  if (String(input.source || "").includes("plugin")) return "plugin";
  if (input.auto) return "agent";
  return "user";
}

function defaultTrustLevel(sourceType) {
  return sourceType === "plugin" ? "untrusted" : sourceType === "agent" ? "review" : "trusted";
}

function normalizeTrustLevel(value, fallback) {
  const normalized = normalizeToken(value, fallback);
  if (!MEMORY_TRUST_LEVELS.includes(normalized)) throw new Error(`Invalid memory trust level: ${value}`);
  return normalized;
}

function normalizeToken(value, fallback) {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

function normalizeDate(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid provenance timestamp: ${value}`);
  return date.toISOString();
}

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeDate(value);
}

function sanitizeSourceId(value, fallback) {
  const sourceId = String(value || fallback).trim().slice(0, 160) || fallback;
  if (/\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{20,})\b/i.test(sourceId)) return "[REDACTED_SOURCE_ID]";
  if (/\b(?:api[_-]?key|token|secret|password|cookie)\s*[:=]/i.test(sourceId)) return "[REDACTED_SOURCE_ID]";
  return sourceId;
}

function countBy(entries, getter) {
  return entries.reduce((result, entry) => {
    const key = getter(entry) || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
