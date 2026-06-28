export const AGENT_TEAM_RECEIPT_MEMORY_SCHEMA = "across-agent-team-receipt-memory/1.0";
export const AGENT_TEAM_RECEIPT_RECALL_SCHEMA = "across-context-agent-team-receipt-recall/1.0";

export async function rememberAgentTeamReceipt(vault, input = {}) {
  const receipt = requiredObject(input.receipt || input.trust_receipt, "receipt");
  const productCard = optionalObject(input.product_card || input.productCard);
  const protocolReadiness = optionalObject(input.protocol_readiness || input.protocolReadiness);
  const packId = required(input.packId || input.pack_id || receipt.pack_id || productCard.pack_id, "pack id");
  const status = String(input.status || receipt.status || "pending").trim();
  const payload = {
    schema_version: AGENT_TEAM_RECEIPT_MEMORY_SCHEMA,
    provider: "across-context",
    pack_id: packId,
    receipt_id: truncate(receipt.receipt_id, 100),
    status,
    headline: truncate(productCard.headline || receipt.promise, 160),
    primary_user: truncate(productCard.primary_user, 120),
    competitive_position: truncate(productCard.competitive_position, 160),
    check_summary: compactCheckSummary(receipt.acceptance_checklist),
    evidence_contract: compactEvidenceContract(receipt.evidence_contract),
    protocol_summary: compactProtocolSummary(protocolReadiness.summary || receipt.protocol_summary),
  };
  const entry = await vault.remember({
    text: stableJson(payload),
    scope: "global",
    type: "session",
    tags: ["agent-team-receipt", `pack:${packId}`],
    source: "agent-team-receipt",
    auto: true,
    status: "pending",
    visibility: "team"
  });
  return {
    schema_version: AGENT_TEAM_RECEIPT_MEMORY_SCHEMA,
    provider: "across-context",
    pack_id: packId,
    status: "accepted_pending",
    memory: entry
  };
}

export async function recallAgentTeamReceipts(vault, options = {}) {
  const packId = options.packId || options.pack_id;
  const limit = Number(options.limit || 10);
  const memories = await vault.listMemories({
    includeGlobal: true,
    includeProjects: true,
    status: options.status
  });
  const parsed = memories
    .map((entry) => ({ entry, payload: parseReceiptMemory(entry.text) }))
    .filter((item) => item.payload)
    .filter((item) => !packId || item.payload.pack_id === packId)
    .sort((a, b) => String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)))
    .slice(0, limit);
  return {
    schema_version: AGENT_TEAM_RECEIPT_RECALL_SCHEMA,
    provider: "across-context",
    pack_id: packId || null,
    result_count: parsed.length,
    results: parsed.map(({ entry, payload }) => ({
      memory_id: entry.id,
      status: entry.status,
      created_at: entry.createdAt,
      pack_id: payload.pack_id,
      receipt_id: payload.receipt_id,
      headline: payload.headline,
      competitive_position: payload.competitive_position,
      protocol_summary: payload.protocol_summary
    }))
  };
}

function compactCheckSummary(items) {
  const values = Array.isArray(items) ? items : [];
  const required = values.filter((item) => item?.required).length;
  const passed = values.filter((item) => String(item?.status || "") === "passed").length;
  return {
    total: values.length,
    required,
    passed,
    ids: values.map((item) => truncate(item?.id, 48)).filter(Boolean).slice(0, 6)
  };
}

function compactEvidenceContract(contract) {
  const value = optionalObject(contract);
  const required = Array.isArray(value.required) ? value.required : [];
  return {
    required: required.map((item) => truncate(item, 48)).filter(Boolean).slice(0, 6),
    graph_schema: truncate(value.graph_schema, 80),
    memory_policy: truncate(value.memory_policy, 80)
  };
}

function compactProtocolSummary(summary) {
  const value = optionalObject(summary);
  return {
    score: Number(value.score || 0),
    passed_count: Number(value.passed_count || 0),
    partial_count: Number(value.partial_count || 0),
    planned_count: Number(value.planned_count || 0),
    honest_protocol_claims: value.honest_protocol_claims === true,
    frontier_ready: value.frontier_ready === true
  };
}

function truncate(value, limit) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

function parseReceiptMemory(text) {
  try {
    const payload = JSON.parse(text);
    return payload?.schema_version === AGENT_TEAM_RECEIPT_MEMORY_SCHEMA ? payload : null;
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

function optionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
