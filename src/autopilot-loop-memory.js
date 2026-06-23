const LOOP_MEMORY_SCHEMA = "across-loop-memory/1.0";
const RECALL_SCHEMA = "across-context-loop-recall/1.0";
const DIFF_SCHEMA = "across-context-loop-memory-diff/1.0";

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
  const entry = await vault.remember({
    text,
    scope: "global",
    type: "session",
    tags: ["autopilot-loop", `spec:${specId}`, `run:${runId}`],
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

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
