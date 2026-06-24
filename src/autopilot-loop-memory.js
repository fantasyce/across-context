const LOOP_MEMORY_SCHEMA = "across-loop-memory/1.0";
const RECALL_SCHEMA = "across-context-loop-recall/1.0";
const DIFF_SCHEMA = "across-context-loop-memory-diff/1.0";
const CONTEXT_PACK_SCHEMA = "across-context-pack-summary/1.0";

const REJECT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN .*PRIVATE KEY-----/,
  /\b(api[_-]?key|token|secret|password|cookie)\s*[:=]\s*\S+/i
];

const REDACT_PATTERNS = [
  /\/Users\/[^\s]+\/Documents\/projects\/[^\s]+/g,
  /\/Users\/[^\s]+\/Desktop\/[^\s]+/g,
  /\/Users\/[^\s]+\/Downloads\/[^\s]+/g
];

export async function rememberLoopMemory(vault, input = {}) {
  const specId = required(input.specId || input.spec_id, "spec id");
  const runId = required(input.runId || input.run_id, "run id");
  const policy = enforceLoopMemoryPolicy(String(input.text || "").trim());
  if (policy.status === "rejected") {
    return {
      schema_version: LOOP_MEMORY_SCHEMA,
      provider: "across-context",
      spec_id: specId,
      run_id: runId,
      status: "rejected",
      reason: policy.reason,
      memory: null
    };
  }
  const text = JSON.stringify({
    schema_version: LOOP_MEMORY_SCHEMA,
    spec_id: specId,
    run_id: runId,
    status: policy.status,
    text: policy.text,
    summary: input.summary || {},
    created_at: new Date().toISOString()
  });
  const agentPluginId = input.agentPluginId || input.agent_plugin_id;
  const tags = ["autopilot-loop", `spec:${specId}`, `run:${runId}`];
  if (agentPluginId) tags.push(`agent-plugin:${agentPluginId}`);
  const entry = await vault.remember({
    text,
    scope: "global",
    type: "session",
    tags,
    source: "autopilot-loop",
    auto: true,
    status: "pending",
    visibility: "private"
  });
  return {
    schema_version: LOOP_MEMORY_SCHEMA,
    provider: "across-context",
    spec_id: specId,
    run_id: runId,
    status: policy.status,
    redactions: policy.redactions,
    memory: entry
  };
}

export async function recallLoopMemory(vault, options = {}) {
  const specId = options.specId || options.spec_id;
  const runId = options.runId || options.run_id;
  const limit = Number(options.limit || 10);
  const memories = await vault.listMemories({
    includeGlobal: true,
    includeProjects: true,
    status: options.status
  });
  const parsed = memories
    .map((entry) => ({ entry, payload: parseLoopMemory(entry.text) }))
    .filter((item) => item.payload)
    .filter((item) => !specId || item.payload.spec_id === specId)
    .filter((item) => !runId || item.payload.run_id === runId)
    .sort((a, b) => String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)))
    .slice(0, limit);
  return {
    schema_version: RECALL_SCHEMA,
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
      text: payload.text,
      summary: payload.summary || {},
      policy_status: payload.status
    }))
  };
}

export async function loopHistory(vault, options = {}) {
  const recall = await recallLoopMemory(vault, { specId: options.specId, limit: options.limit || 50 });
  const bySpec = {};
  for (const result of recall.results) {
    const bucket = bySpec[result.spec_id] || { spec_id: result.spec_id, run_count: 0, pending_count: 0, redacted_count: 0 };
    bucket.run_count += 1;
    if (result.status === "pending") bucket.pending_count += 1;
    if (result.policy_status === "redacted_pending") bucket.redacted_count += 1;
    bySpec[result.spec_id] = bucket;
  }
  return {
    schema_version: "across-context-loop-history/1.0",
    provider: "across-context",
    specs: Object.values(bySpec).sort((a, b) => a.spec_id.localeCompare(b.spec_id))
  };
}

export async function loopMemoryDiff(vault, options = {}) {
  const a = required(options.runIdA || options.run_id_a, "first run id");
  const b = required(options.runIdB || options.run_id_b, "second run id");
  const left = await recallLoopMemory(vault, { runId: a, limit: 100 });
  const right = await recallLoopMemory(vault, { runId: b, limit: 100 });
  const leftText = new Set(left.results.map((item) => item.text));
  const rightText = new Set(right.results.map((item) => item.text));
  return {
    schema_version: DIFF_SCHEMA,
    provider: "across-context",
    left_run_id: a,
    right_run_id: b,
    added: [...rightText].filter((text) => !leftText.has(text)),
    removed: [...leftText].filter((text) => !rightText.has(text)),
    unchanged_count: [...leftText].filter((text) => rightText.has(text)).length
  };
}

export async function contextPackSummary(vault, options = {}) {
  const agentPluginId = options.agentPluginId || options.agent_plugin_id;
  const memories = await vault.listMemories({
    projectRoot: options.projectRoot || options.project,
    includeGlobal: true,
    includeProjects: options.includeProjects !== false,
    status: options.status
  });
  const filtered = agentPluginId
    ? memories.filter((entry) => memoryAgentPluginIds(entry).includes(agentPluginId))
    : memories;
  const groups = new Map();
  const pluginIds = new Set();
  for (const entry of filtered) {
    for (const pluginId of memoryAgentPluginIds(entry)) pluginIds.add(pluginId);
    const groupPluginId = memoryAgentPluginIds(entry)[0] || null;
    const baseKey = [entry.scope || "unknown", entry.type || "note", entry.status || "active"].join(":");
    const key = groupPluginId ? [groupPluginId, baseKey].join(":") : baseKey;
    const group = groups.get(key) || {
      id: key,
      agent_plugin_id: groupPluginId,
      scope: entry.scope || "unknown",
      type: entry.type || "note",
      status: entry.status || "active",
      count: 0,
      latest_updated_at: null,
      tags: new Set()
    };
    group.count += 1;
    if (!group.latest_updated_at || String(entry.updatedAt || entry.createdAt || "").localeCompare(group.latest_updated_at) > 0) {
      group.latest_updated_at = entry.updatedAt || entry.createdAt || null;
    }
    for (const tag of entry.tags || []) group.tags.add(tag);
    groups.set(key, group);
  }
  const packs = [...groups.values()]
    .map((group) => ({ ...group, tags: [...group.tags].sort().slice(0, 12) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (agentPluginId && packs.length === 0) {
    packs.push(emptyAgentPluginPack(agentPluginId));
    pluginIds.add(agentPluginId);
  }
  const pendingCount = filtered.filter((entry) => entry.status === "pending").length;
  return {
    schema_version: CONTEXT_PACK_SCHEMA,
    provider: "across-context",
    status: pendingCount ? "attention" : "passed",
    summary: {
      memory_count: filtered.length,
      context_pack_count: packs.length,
      pending_count: pendingCount,
      agent_plugin_count: pluginIds.size,
      filtered_agent_plugin_id: agentPluginId || null
    },
    packs
  };
}

function emptyAgentPluginPack(agentPluginId) {
  return {
    id: `${agentPluginId}:empty`,
    agent_plugin_id: agentPluginId,
    scope: "agent-plugin",
    type: "context-pack",
    status: "empty",
    count: 0,
    latest_updated_at: null,
    tags: [`agent-plugin:${agentPluginId}`],
    virtual: true,
    ready_for_agent_loading: true
  };
}

export function enforceLoopMemoryPolicy(text) {
  if (!text) return { status: "rejected", reason: "Memory text is required.", text: "" };
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(text)) return { status: "rejected", reason: "Memory looks like a secret or credential.", text: "" };
  }
  let redacted = text;
  let count = 0;
  for (const pattern of REDACT_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      count += 1;
      return "[REDACTED_LOCAL_PATH]";
    });
  }
  if (count) return { status: "redacted_pending", reason: "Local path was redacted.", text: redacted, redactions: count };
  return { status: "accepted_pending", reason: "Memory passed loop policy.", text, redactions: 0 };
}

function parseLoopMemory(text) {
  try {
    const payload = JSON.parse(text);
    return payload?.schema_version === LOOP_MEMORY_SCHEMA ? payload : null;
  } catch {
    return null;
  }
}

function memoryAgentPluginIds(entry) {
  const ids = [];
  for (const tag of entry.tags || []) {
    const text = String(tag || "");
    if (text.startsWith("agent-plugin:")) ids.push(text.slice("agent-plugin:".length));
  }
  return [...new Set(ids.filter(Boolean))];
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
