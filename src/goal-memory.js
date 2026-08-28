import { createHash } from "node:crypto";
import { ACTIVE_MEMORY_STATUSES } from "./vault.js";
import { containsSecret } from "./memory-policy.js";
import { goalMemoryAuthorityLabel } from "./memory-provenance.js";


export const GOAL_CONTRACT_SCHEMA = "across-goal-contract/1.0";
export const GOAL_CHANGE_PROPOSAL_SCHEMA = "across-goal-change-proposal/1.0";
export const GOAL_MEMORY_SUMMARY_SCHEMA = "across-goal-memory-summary/1.0";
export const GOAL_MEMORY_RECALL_SCHEMA = "across-context-goal-memory-recall/1.0";

const executionProfiles = new Set(["direct", "orchestrated", "workflow-pack"]);
const reviewPolicies = new Set(["automatic", "human", "independent_agent", "quality_gate", "security_policy"]);
const proposalOperations = new Set(["add", "replace", "remove"]);
const proposalDecisions = new Set(["pending", "accepted", "partially_accepted", "rejected", "superseded"]);
const hostOwnedPaths = new Set(["/confirmed_by", "/confirmed_at", "/revision", "/goal_id", "/task_id"]);
const absolutePathPattern = /(?:^|\s)(?:\/Users\/|\/home\/|\/workspace\/|\/Volumes\/|\/Applications\/|\/(?:private\/)?tmp\/|[A-Za-z]:\\)/;
const rawTranscriptPattern = /(?:BEGIN (?:RAW|FULL|CHAT) TRANSCRIPT|(?:raw|full|chat) transcript\s*:)/i;
const safeReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;


function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}


function requiredText(value, name) {
  const normalized = normalizedText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}


function positiveRevision(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}


function objectValue(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}


function stringList(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${name} must be an array of non-empty strings`);
  }
  return value;
}


function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]));
  }
  return value;
}


function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}


export function criterionId(description, validatorKind) {
  const descriptionValue = requiredText(description, "description");
  const validatorValue = requiredText(validatorKind, "validator_kind").toLowerCase();
  const digest = createHash("sha256").update(`${validatorValue}\n${descriptionValue}`, "utf8").digest("hex");
  return `criterion-${digest.slice(0, 16)}`;
}


export function stableGoalHash(value = {}) {
  const payload = JSON.stringify(sortedJsonValue(objectValue(value, "value")));
  return createHash("sha256").update(payload, "utf8").digest("hex");
}


export function normalizeGoalContract(value = {}) {
  const contract = cloneJson(objectValue(value, "goal contract"));
  if (contract.schema_version !== GOAL_CONTRACT_SCHEMA) throw new TypeError(`schema_version must be ${GOAL_CONTRACT_SCHEMA}`);
  requiredText(contract.goal_id, "goal_id");
  positiveRevision(contract.revision, "revision");
  requiredText(contract.task_id, "task_id");
  requiredText(contract.statement, "statement");
  requiredText(contract.success_outcome, "success_outcome");
  const scope = objectValue(contract.scope, "scope");
  stringList(scope.includes, "scope.includes");
  stringList(scope.excludes, "scope.excludes");
  if (!Array.isArray(contract.acceptance_criteria) || contract.acceptance_criteria.length === 0) {
    throw new TypeError("acceptance_criteria must be a non-empty array");
  }
  const seen = new Set();
  for (const criterion of contract.acceptance_criteria) {
    objectValue(criterion, "criterion");
    const identifier = requiredText(criterion.criterion_id, "criterion_id");
    if (seen.has(identifier)) throw new TypeError(`duplicate criterion_id: ${identifier}`);
    seen.add(identifier);
    requiredText(criterion.description, "criterion description");
    if (typeof criterion.required !== "boolean") throw new TypeError("criterion required must be a boolean");
    requiredText(criterion.validator_kind, "validator_kind");
    if (!reviewPolicies.has(criterion.review_policy)) throw new TypeError("criterion review_policy is invalid");
    requiredText(criterion.source, "criterion source");
  }
  if (!Array.isArray(contract.dependencies)) throw new TypeError("dependencies must be an array");
  if (!executionProfiles.has(contract.execution_profile)) throw new TypeError("execution_profile is invalid");
  requiredText(contract.source, "source");
  if (Boolean(contract.confirmed_by) !== Boolean(contract.confirmed_at)) {
    throw new TypeError("confirmed_by and confirmed_at must be supplied together");
  }
  requiredText(contract.created_at, "created_at");
  stableGoalHash(contract);
  return contract;
}


export function normalizeGoalChangeProposal(value = {}) {
  const proposal = cloneJson(objectValue(value, "goal change proposal"));
  if (proposal.schema_version !== GOAL_CHANGE_PROPOSAL_SCHEMA) {
    throw new TypeError(`schema_version must be ${GOAL_CHANGE_PROPOSAL_SCHEMA}`);
  }
  requiredText(proposal.proposal_id, "proposal_id");
  requiredText(proposal.goal_id, "goal_id");
  positiveRevision(proposal.base_goal_revision, "base_goal_revision");
  requiredText(proposal.proposed_by, "proposed_by");
  requiredText(proposal.reason, "reason");
  if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
    throw new TypeError("operations must be a non-empty array");
  }
  for (const operation of proposal.operations) {
    objectValue(operation, "operation");
    if (!proposalOperations.has(operation.op)) throw new TypeError("proposal operation is invalid");
    const path = requiredText(operation.path, "operation path");
    if (!path.startsWith("/") || isHostOwnedPath(path)) throw new TypeError("proposal operation targets host-owned fields");
    if (operation.op !== "remove" && !("value" in operation)) throw new TypeError("proposal operation value is required");
  }
  const impact = objectValue(proposal.impact_summary, "impact_summary");
  stringList(impact.goal_ids, "impact_summary.goal_ids");
  stringList(impact.criterion_ids, "impact_summary.criterion_ids");
  stringList(impact.evidence_ids, "impact_summary.evidence_ids");
  if (typeof impact.requires_revalidation !== "boolean") {
    throw new TypeError("impact_summary.requires_revalidation must be a boolean");
  }
  objectValue(proposal.risk_summary, "risk_summary");
  objectValue(proposal.estimated_cost, "estimated_cost");
  stringList(proposal.alternatives, "alternatives");
  if (!proposalDecisions.has(proposal.decision_state)) throw new TypeError("decision_state is invalid");
  requiredText(proposal.created_at, "created_at");
  stableGoalHash(proposal);
  return proposal;
}


export async function rememberGoalSummary(vault, input = {}, options = {}) {
  if (!vault?.remember) throw new Error("Context vault is required");
  const goalId = requiredText(input.goal_id ?? input.goalId, "goal_id");
  const goalRevision = positiveRevision(input.goal_revision ?? input.goalRevision ?? input.revision, "goal_revision");
  const conclusion = compactSafeText(input.conclusion, "conclusion", 500);
  const source = normalizeSummarySource(input.source);
  const pendingProposal = input.proposal?.decision_state === "pending";
  const requestedTrust = normalizeSummaryTrust(input.trust);
  const trust = pendingProposal || source.type === "autopilot" ? "review" : requestedTrust;
  const payload = {
    schema_version: GOAL_MEMORY_SUMMARY_SCHEMA,
    goal_id: goalId,
    goal_revision: goalRevision,
    conclusion,
    decision_receipt_refs: safeReferences(input.decision_receipt_refs ?? input.decisionReceiptRefs),
    evidence_receipt_refs: safeReferences(input.evidence_receipt_refs ?? input.evidenceReceiptRefs),
    source,
    trust,
    supersedes: normalizeSupersedes(input.supersedes)
  };
  const text = stableJson(payload);
  const entry = await vault.remember({
    text,
    scope: options.projectRoot ? "project" : "global",
    projectRoot: options.projectRoot,
    type: "decision",
    tags: ["goal-summary", `goal:${goalId}`, `goal-revision:${goalRevision}`],
    source: "goal-summary",
    source_type: source.type === "autopilot" ? "agent" : source.type,
    source_id: source.ref,
    trust_level: trust,
    observed_at: (options.now || new Date()).toISOString(),
    auto: trust !== "trusted" || pendingProposal,
    status: trust === "trusted" && !pendingProposal ? "active" : "pending",
    visibility: "private"
  });
  return {
    schema_version: GOAL_MEMORY_SUMMARY_SCHEMA,
    status: entry.status,
    memory: entry,
    summary: {
      ...payload,
      activation_eligible: trust === "trusted" && !pendingProposal
    }
  };
}


export async function recallGoalSummary(vault, query = {}) {
  if (!vault?.listMemories) throw new Error("Context vault is required");
  const statuses = goalRecallStatuses(query);
  const currentRevision = query.current_goal_revision ?? query.currentGoalRevision;
  if (currentRevision !== undefined && currentRevision !== null) positiveRevision(Number(currentRevision), "current_goal_revision");
  const memories = await vault.listMemories({
    projectRoot: query.projectRoot,
    includeGlobal: true,
    includeProjects: Boolean(query.includeProjects),
    statuses
  });
  const goalId = query.goal_id ?? query.goalId;
  const results = memories
    .map((entry) => ({ entry, payload: parseGoalSummary(entry.text) }))
    .filter((item) => item.payload)
    .filter((item) => !goalId || item.payload.goal_id === goalId)
    .sort((left, right) => right.payload.goal_revision - left.payload.goal_revision
      || String(right.entry.createdAt).localeCompare(String(left.entry.createdAt)))
    .slice(0, Number(query.limit || 20))
    .map(({ entry, payload }) => {
      const activationEligible = payload.trust === "trusted"
        && entry.provenance?.trust_level === "trusted"
        && ["active", "pinned"].includes(entry.status);
      const authorityLabel = goalMemoryAuthorityLabel(entry, payload, currentRevision);
      return {
        memory_id: entry.id,
        status: entry.status,
        goal_id: payload.goal_id,
        goal_revision: payload.goal_revision,
        conclusion: payload.conclusion,
        decision_receipt_refs: payload.decision_receipt_refs,
        evidence_receipt_refs: payload.evidence_receipt_refs,
        source: payload.source,
        trust: payload.trust,
        supersedes: payload.supersedes,
        activation_eligible: activationEligible,
        authority_label: authorityLabel
      };
    });
  return {
    schema_version: GOAL_MEMORY_RECALL_SCHEMA,
    goal_id: goalId || null,
    current_goal_revision: currentRevision === undefined ? null : Number(currentRevision),
    result_count: results.length,
    results
  };
}


function isHostOwnedPath(path) {
  return [...hostOwnedPaths].some((owned) => path === owned || path.startsWith(`${owned}/`));
}


function compactSafeText(value, name, limit) {
  const text = requiredText(value, name);
  if (containsSecret(text)) throw new Error(`${name} contains sensitive or secret text`);
  if (absolutePathPattern.test(text)) throw new Error(`${name} contains a local path`);
  if (rawTranscriptPattern.test(text)) throw new Error(`${name} contains a raw transcript`);
  if (text.length > limit) throw new Error(`${name} exceeds ${limit} characters`);
  return text;
}


function safeReferences(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("receipt references must be an array");
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean).map((reference) => {
    if (!safeReferencePattern.test(reference) || containsSecret(reference)) throw new Error("receipt reference is unsafe");
    return reference;
  }))].sort();
}


function normalizeSummarySource(value) {
  const source = objectValue(value, "source");
  const type = requiredText(source.type, "source.type").toLowerCase();
  const ref = requiredText(source.ref, "source.ref");
  if (!safeReferencePattern.test(ref) || containsSecret(ref)) throw new Error("source reference is unsafe");
  return { type, ref };
}


function normalizeSummaryTrust(value) {
  const trust = String(value || "review").trim().toLowerCase();
  if (!["trusted", "review", "untrusted"].includes(trust)) throw new Error("goal summary trust is invalid");
  return trust;
}


function normalizeSupersedes(value) {
  if (value === undefined || value === null) return null;
  const item = objectValue(value, "supersedes");
  return {
    goal_revision: positiveRevision(item.goal_revision ?? item.goalRevision, "supersedes.goal_revision"),
    memory_id: requiredText(item.memory_id ?? item.memoryId, "supersedes.memory_id")
  };
}


function parseGoalSummary(text) {
  try {
    const payload = JSON.parse(text);
    return payload?.schema_version === GOAL_MEMORY_SUMMARY_SCHEMA ? payload : null;
  } catch {
    return null;
  }
}


function goalRecallStatuses(query) {
  const requested = query.status !== undefined ? [query.status] : query.statuses || [...ACTIVE_MEMORY_STATUSES];
  const statuses = requested.map((status) => String(status || "").trim()).filter(Boolean);
  if (statuses.includes("pending") && query.reviewPending !== true) {
    throw new Error("Pending goal memory retrieval requires reviewPending=true");
  }
  return statuses;
}


function stableJson(value) {
  return JSON.stringify(sortedJsonValue(value));
}
