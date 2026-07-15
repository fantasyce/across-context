import { appendFile, mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile, withFileLock } from "./file-lock.js";
import { MemoryPolicyEngine, isSensitivePolicyDecision, normalizeMemoryText } from "./memory-policy.js";
import { resolveMemoryBackend } from "./memory-backend.js";
import { searchEntries } from "./semantic-search.js";
import {
  compactTrustSummary,
  effectiveMemoryStatus,
  isTrustedForActivation
} from "./memory-provenance.js";
import {
  defaultHome,
  newMemoryId,
  normalizeMemoryType,
  normalizeScope,
  nowIso,
  projectName,
  splitTags,
  stableProjectId
} from "./paths.js";

const AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA = "agent-loop-memory-candidate/1.0";
export const ACTIVE_MEMORY_STATUSES = Object.freeze(["active", "pinned"]);

export class ContextVault {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.home = resolve(options.home || defaultHome(this.env));
    this.policy = new MemoryPolicyEngine(options.policy || {});
    this.backend = resolveMemoryBackend({ ...options, env: this.env });
  }

  async init() {
    await mkdir(join(this.home, "global"), { recursive: true });
    await mkdir(join(this.home, "projects"), { recursive: true });
    await mkdir(join(this.home, "events"), { recursive: true });
    await this.#ensureJsonl(join(this.home, "global", "memories.jsonl"));
    await this.#ensureJsonl(join(this.home, "events", "memory-policy.jsonl"));
    return { home: this.home };
  }

  async remember(input) {
    await this.init();
    const scope = normalizeScope(input.scope);
    const type = normalizeMemoryType(input.type);
    if (!input.text || !String(input.text).trim()) {
      throw new Error("Memory text is required");
    }
    if (scope === "project" && !input.projectRoot) {
      throw new Error("projectRoot is required for project memories");
    }

    const result = await this.#withVaultLock(async () => {
      const existing = await this.#listMemoriesUnlocked({
        projectRoot: input.projectRoot,
        includeGlobal: true
      });
      const decision = this.policy.evaluate({
        text: input.text,
        scope,
        type,
        projectRoot: input.projectRoot,
        tags: input.tags || [],
        source: input.source,
        auto: Boolean(input.auto),
        status: input.status,
        source_type: input.source_type ?? input.sourceType,
        source_id: input.source_id ?? input.sourceId,
        trust_level: input.trust_level ?? input.trustLevel,
        evidence_hash: input.evidence_hash ?? input.evidenceHash,
        observed_at: input.observed_at ?? input.observedAt,
        expires_at: input.expires_at ?? input.expiresAt,
        provenance: input.provenance
      }, existing);

      if (decision.status === "deny") {
        await this.#recordPolicyEvent(input, decision);
        throw new Error(`Memory rejected: ${decision.reason}`);
      }
      if (decision.status === "duplicate") {
        await this.#recordPolicyEvent(input, decision);
        return {
          ...decision.entry,
          duplicateOf: decision.matchedId,
          policy: {
            status: decision.status,
            reason: decision.reason
          }
        };
      }

      const timestamp = nowIso();
      const entry = {
        id: newMemoryId(),
        scope,
        type,
        text: decision.text,
        tags: splitTags(decision.tags || input.tags),
        source: input.source,
        provenance: decision.provenance,
        status: normalizeStatus(decision.memoryStatus || input.status || "active"),
        visibility: normalizeVisibility(input.visibility || "private"),
        policy: {
          status: decision.status,
          trimmed: Boolean(decision.trimmed),
          redactions: Number(decision.redactions || 0),
          localPathRedacted: Boolean(decision.localPathRedacted),
          rawTranscriptRedacted: Boolean(decision.rawTranscriptRedacted),
          hiddenReasoningRedacted: Boolean(decision.hiddenReasoningRedacted),
          tagRedactions: Number(decision.tagRedactions || 0),
          quarantineReasons: decision.quarantineReasons || []
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };

      let file = join(this.home, "global", "memories.jsonl");
      if (scope === "project") {
        const root = resolve(input.projectRoot);
        const projectId = stableProjectId(root);
        entry.projectId = projectId;
        entry.projectName = projectName(root);
        file = join(this.home, "projects", projectId, "memories.jsonl");
        await mkdir(dirname(file), { recursive: true });
        await this.#ensureJsonl(file);
      }

      await appendFile(file, `${JSON.stringify(dropUndefined(entry))}\n`, "utf8");
      await this.#recordPolicyEvent(input, decision, entry);
      return dropUndefined(entry);
    });
    if (!result.duplicateOf) await this.#refreshProjectionIfPresent();
    return result;
  }

  async listMemories(options = {}) {
    await this.init();
    return this.#withVaultLock(() => this.#listMemoriesUnlocked(options));
  }

  async #listMemoriesUnlocked(options = {}) {
    const memories = [];
    if (options.includeGlobal !== false) {
      memories.push(...await readJsonl(join(this.home, "global", "memories.jsonl")));
    }
    if (options.projectRoot) {
      const projectId = stableProjectId(resolve(options.projectRoot));
      memories.push(...await readJsonl(join(this.home, "projects", projectId, "memories.jsonl")));
    } else if (options.includeProjects) {
      const projectsRoot = join(this.home, "projects");
      try {
        const entries = await readdir(projectsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            memories.push(...await readJsonl(join(projectsRoot, entry.name, "memories.jsonl")));
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const statusSet = normalizeStatusSet(options);
    return memories
      .map((entry) => ({ ...entry, status: effectiveMemoryStatus(entry) }))
      .filter((entry) => !statusSet || statusSet.has(entry.status || "active"))
      .filter((entry) => !options.visibility || (entry.visibility || "private") === options.visibility)
      .filter((entry) => !options.type || entry.type === options.type)
      .filter((entry) => !options.scope || entry.scope === options.scope)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async stats(options = {}) {
    const memories = await this.listMemories(options);
    return {
      home: this.home,
      memoryBackend: this.backend,
      total: memories.length,
      byScope: countBy(memories, "scope"),
      byType: countBy(memories, "type"),
      byStatus: countBy(memories.map((entry) => ({ ...entry, status: entry.status || "active" })), "status"),
      trust: compactTrustSummary(memories)
    };
  }

  async trustSummary(options = {}) {
    const memories = await this.listMemories({
      projectRoot: options.projectRoot,
      includeGlobal: options.includeGlobal !== false,
      includeProjects: Boolean(options.includeProjects)
    });
    return compactTrustSummary(memories);
  }

  async agentLoopMemoryMetrics(options = {}) {
    await this.init();
    const memories = await this.listMemories({
      projectRoot: options.projectRoot,
      includeGlobal: true,
      includeProjects: Boolean(options.includeProjects)
    });
    const candidates = memories.filter((entry) => agentLoopCandidateSchema(entry.text) === AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA);
    const policyEvents = (await readJsonl(this.#policyEventFile()))
      .filter((event) => event.candidateSchema === AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA);
    const byStatus = countBy(candidates.map((entry) => ({ ...entry, status: entry.status || "active" })), "status");
    const approvedCount = (byStatus.active || 0) + (byStatus.pinned || 0);
    const duplicateCount = policyEvents.filter((event) => event.policyStatus === "duplicate").length;
    const deniedEvents = policyEvents.filter((event) => event.policyStatus === "deny");
    const sensitiveDeniedCount = deniedEvents.filter(isSensitivePolicyEvent).length;
    const forgottenCount = policyEvents.filter((event) => event.policyStatus === "forgotten").length;
    const dimensions = {
      candidate_schema: AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA,
      source: "post_loop_pending_summary",
      scope: options.projectRoot ? "project" : "all"
    };
    const metric = (name, value, extra = {}) => ({
      schema_version: "agent-loop-memory-metric/1.0",
      metric: name,
      value,
      unit: "count",
      dimensions: dropUndefined({ ...dimensions, ...extra })
    });
    return {
      schema_version: "agent-loop-memory-metrics/1.0",
      candidate_schema: AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA,
      home: this.home,
      projectRoot: options.projectRoot,
      includeProjects: Boolean(options.includeProjects),
      totals: {
        candidate_count: candidates.length,
        pending_count: byStatus.pending || 0,
        approved_count: approvedCount,
        archived_count: byStatus.archived || 0,
        expired_count: byStatus.expired || 0,
        forgotten_count: forgottenCount,
        duplicate_reused_count: duplicateCount,
        denied_count: deniedEvents.length,
        sensitive_denied_count: sensitiveDeniedCount
      },
      byStatus,
      byScope: countBy(candidates, "scope"),
      metrics: [
        metric("memory_candidate.produced_count", candidates.length + forgottenCount),
        metric("memory_candidate.pending_count", byStatus.pending || 0, { status: "pending" }),
        metric("memory_candidate.approved_count", approvedCount, { status: "active_or_pinned" }),
        metric("memory_candidate.archived_count", byStatus.archived || 0, { status: "archived" }),
        metric("memory_candidate.expired_count", byStatus.expired || 0, { status: "expired" }),
        metric("memory_candidate.forgotten_count", forgottenCount),
        metric("memory_candidate.duplicate_reused_count", duplicateCount),
        metric("memory_candidate.denied_count", deniedEvents.length),
        metric("memory_candidate.sensitive_denied_count", sensitiveDeniedCount)
      ]
    };
  }

  async forget(id) {
    await this.init();
    const targetId = String(id || "").trim();
    if (!targetId) {
      throw new Error("Memory id is required");
    }

    const result = await this.#withVaultLock(async () => {
      let forgotten = 0;
      const forgottenIds = new Set();
      const allMemories = [];
      for (const file of await this.#memoryFiles()) allMemories.push(...await readJsonl(file));
      const targetIds = dependentMemoryIds(allMemories, targetId);
      for (const file of await this.#memoryFiles()) {
        const memories = await readJsonl(file);
        const forgottenCandidates = [];
        const kept = memories.filter((entry) => {
          if (targetIds.has(entry.id)) {
            forgottenIds.add(entry.id);
            if (agentLoopCandidateSchema(entry.text) === AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA) {
              forgottenCandidates.push(entry);
            }
            forgotten += 1;
            return false;
          }
          return true;
        });
        if (kept.length !== memories.length) {
          await writeJsonl(file, kept);
        }
        for (const entry of forgottenCandidates) {
          await this.#recordPolicyEvent({
            text: entry.text,
            scope: entry.scope,
            type: entry.type,
            projectRoot: entry.projectRoot,
            source: "forget"
          }, { status: "forgotten", reason: "Memory was forgotten." }, entry);
        }
      }
      return {
        forgotten,
        forgottenIds: [...forgottenIds]
      };
    });
    if (result.forgotten) await this.#refreshProjectionIfPresent();
    return result;
  }

  async updateStatus(id, status) {
    await this.init();
    const nextStatus = normalizeStatus(status);
    const targetId = String(id || "").trim();
    if (!targetId) {
      throw new Error("Memory id is required");
    }

    const updated = await this.#withVaultLock(async () => {
      for (const file of await this.#memoryFiles()) {
        const memories = await readJsonl(file);
        const index = memories.findIndex((entry) => entry.id === targetId);
        if (index === -1) continue;
        const current = prepareStatusTransition(memories[index], nextStatus);
        const entry = {
          ...current,
          status: nextStatus,
          updatedAt: nowIso()
        };
        memories[index] = entry;
        await writeJsonl(file, memories);
        return entry;
      }
      throw new Error(`Memory not found: ${targetId}`);
    });
    await this.#refreshProjectionIfPresent();
    return updated;
  }

  async approve(id) {
    await this.init();
    const targetId = String(id || "").trim();
    if (!targetId) throw new Error("Memory id is required");
    const updated = await this.#withVaultLock(async () => {
      for (const file of await this.#memoryFiles()) {
        const memories = await readJsonl(file);
        const index = memories.findIndex((entry) => entry.id === targetId);
        if (index === -1) continue;
        const current = memories[index];
        const promoted = prepareStatusTransition(current, "active");
        const entry = { ...promoted, status: "active", updatedAt: nowIso() };
        memories[index] = entry;
        await writeJsonl(file, memories);
        return entry;
      }
      throw new Error(`Memory not found: ${targetId}`);
    });
    await this.#refreshProjectionIfPresent();
    return updated;
  }

  async updateStatuses(ids, status) {
    await this.init();
    const nextStatus = normalizeStatus(status);
    const targetIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!targetIds.length) {
      throw new Error("At least one memory id is required");
    }

    const result = await this.#withVaultLock(async () => {
      const targets = new Set(targetIds);
      const updated = [];
      for (const file of await this.#memoryFiles()) {
        const memories = await readJsonl(file);
        let changed = false;
        for (let index = 0; index < memories.length; index += 1) {
          if (!targets.has(memories[index].id)) continue;
          const current = prepareStatusTransition(memories[index], nextStatus);
          const entry = {
            ...current,
            status: nextStatus,
            updatedAt: nowIso()
          };
          memories[index] = entry;
          targets.delete(entry.id);
          updated.push(entry);
          changed = true;
        }
        if (changed) {
          await writeJsonl(file, memories);
        }
      }
      return {
        updated,
        missing: targetIds.filter((id) => targets.has(id))
      };
    });
    if (result.updated.length) await this.#refreshProjectionIfPresent();
    return result;
  }

  async updateStatusTransitions(transitions, options = {}) {
    await this.init();
    const normalized = [...new Map((transitions || []).map((transition) => {
      const id = String(transition?.id || "").trim();
      if (!id) throw new Error("Memory transition id is required");
      return [id, { id, status: normalizeStatus(transition.status) }];
    })).values()];
    if (!normalized.length) throw new Error("At least one memory transition is required");

    const result = await this.#withVaultLock(async () => {
      const pending = new Map(normalized.map((transition) => [transition.id, transition.status]));
      const updated = [];
      for (const file of await this.#memoryFiles()) {
        const memories = await readJsonl(file);
        let changed = false;
        for (let index = 0; index < memories.length; index += 1) {
          const nextStatus = pending.get(memories[index].id);
          if (!nextStatus) continue;
          const current = prepareStatusTransition(memories[index], nextStatus);
          memories[index] = { ...current, status: nextStatus, updatedAt: nowIso() };
          updated.push(memories[index]);
          pending.delete(memories[index].id);
          changed = true;
        }
        if (changed) await writeJsonl(file, memories);
      }
      const missing = [...pending.keys()];
      if (missing.length && !options.allowMissing) throw new Error(`Memory not found: ${missing.join(", ")}`);
      return { updated, missing };
    });
    if (result.updated.length) await this.#refreshProjectionIfPresent();
    return result;
  }

  async exportTeamMemory(options = {}) {
    const memories = await this.listMemories({
      projectRoot: options.projectRoot,
      includeGlobal: false,
      statuses: ACTIVE_MEMORY_STATUSES,
      visibility: "team"
    });
    return {
      version: 1,
      generatedAt: nowIso(),
      project: options.projectRoot ? projectName(options.projectRoot) : undefined,
      memories: memories.map((entry) => sanitizeTeamMemory(entry))
    };
  }

  async compact(options = {}) {
    await this.init();
    const result = await this.#withVaultLock(async () => {
      let removed = 0;
      const files = await this.#memoryFiles(options.projectRoot);
      for (const file of files) {
        const memories = await readJsonl(file);
        const seen = new Set();
        const kept = [];
        for (const entry of memories) {
          const key = `${entry.scope}:${entry.projectId || "global"}:${entry.type}:${normalizeMemoryText(entry.text)}`;
          if (seen.has(key)) {
            removed += 1;
            continue;
          }
          seen.add(key);
          kept.push(entry);
        }
        if (kept.length !== memories.length) {
          await writeJsonl(file, kept);
        }
      }
      return { removed };
    });
    if (result.removed) await this.#refreshProjectionIfPresent();
    return result;
  }

  async search(input) {
    if ((input.status === "quarantined" || input.statuses?.includes?.("quarantined")) && input.reviewQuarantined !== true) {
      throw new Error("Quarantined memory retrieval requires reviewQuarantined=true.");
    }
    const query = String(input.query || "").trim();
    if (!query && !input.allowEmptyQuery) {
      return [];
    }
    const memories = await this.listMemories({
      projectRoot: input.projectRoot,
      includeGlobal: input.includeGlobal !== false,
      ...searchStatusFilter(input),
      visibility: input.visibility,
      type: input.type,
      scope: input.scope
    });
    return searchEntries(memories, {
      query,
      mode: input.mode || "keyword",
      limit: input.limit || 20,
      allowEmptyQuery: Boolean(input.allowEmptyQuery)
    });
  }

  async saveProjectProfile(profile) {
    await this.init();
    const file = join(this.home, "projects", profile.id, "profile.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    return profile;
  }

  async getProjectProfile(projectRoot) {
    const projectId = stableProjectId(resolve(projectRoot));
    const file = join(this.home, "projects", projectId, "profile.json");
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #ensureJsonl(file) {
    await mkdir(dirname(file), { recursive: true });
    const handle = await open(file, "a", 0o600);
    await handle.close();
  }

  #policyEventFile() {
    return join(this.home, "events", "memory-policy.jsonl");
  }

  async #recordPolicyEvent(input, decision, entry) {
    const candidateSchema = agentLoopCandidateSchema(input.text || entry?.text);
    if (candidateSchema !== AGENT_LOOP_MEMORY_CANDIDATE_SCHEMA) {
      return;
    }
    const projectRoot = input.projectRoot || entry?.projectRoot;
    const event = dropUndefined({
      id: `memory_policy_${newMemoryId().slice(4)}`,
      candidateSchema,
      policyStatus: decision.status,
      policyCategory: decision.category,
      sensitive: decision.sensitive === true ? true : undefined,
      reason: decision.reason,
      scope: input.scope || entry?.scope,
      type: input.type || entry?.type,
      memoryStatus: entry?.status || decision.memoryStatus,
      memoryId: entry?.id,
      duplicateOf: decision.matchedId,
      projectId: projectRoot ? stableProjectId(resolve(projectRoot)) : entry?.projectId,
      source: input.source,
      createdAt: nowIso()
    });
    await appendFile(this.#policyEventFile(), `${JSON.stringify(event)}\n`, "utf8");
  }

  async #memoryFiles(projectRoot) {
    const files = [join(this.home, "global", "memories.jsonl")];
    if (projectRoot) {
      files.push(join(this.home, "projects", stableProjectId(resolve(projectRoot)), "memories.jsonl"));
      return files;
    }

    const projectsRoot = join(this.home, "projects");
    try {
      const entries = await readdir(projectsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          files.push(join(projectsRoot, entry.name, "memories.jsonl"));
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return files;
  }

  #vaultLockPath() {
    return join(this.home, "events", ".vault.lock");
  }

  async #withVaultLock(task) {
    return withFileLock(this.#vaultLockPath(), task);
  }

  async #refreshProjectionIfPresent() {
    const { refreshMemoryProjectionIfPresent } = await import("./memory-projection.js");
    return refreshMemoryProjectionIfPresent(this);
  }
}

export async function readJsonl(file) {
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeJsonl(file, entries) {
  await mkdir(dirname(file), { recursive: true });
  const content = entries.map((entry) => JSON.stringify(dropUndefined(entry))).join("\n");
  await atomicWriteFile(file, content ? `${content}\n` : "");
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function countBy(entries, key) {
  return entries.reduce((counts, entry) => {
    const value = entry[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function agentLoopCandidateSchema(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    return parsed && typeof parsed === "object" ? parsed.schema_version || parsed.schemaVersion : undefined;
  } catch {
    return undefined;
  }
}

function dependentMemoryIds(memories, targetId) {
  const ids = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of memories) {
      if (ids.has(entry.id)) continue;
      const sourceIds = distilledProposalSourceIds(entry.text);
      if (sourceIds.some((sourceId) => ids.has(sourceId))) {
        ids.add(entry.id);
        changed = true;
      }
    }
  }
  return ids;
}

function distilledProposalSourceIds(text) {
  try {
    const payload = JSON.parse(String(text || ""));
    if (payload?.schema_version !== "across-context-distilled-memory-proposal/1.0") return [];
    return payload.provenance?.sources?.map((source) => source.memory_id).filter(Boolean) || [];
  } catch {
    return [];
  }
}

function isSensitivePolicyEvent(event) {
  return isSensitivePolicyDecision({
    sensitive: event.sensitive,
    category: event.policyCategory,
    reason: event.reason
  });
}

function normalizeStatus(status) {
  const value = String(status || "active");
  if (!["pending", "active", "pinned", "archived", "expired", "quarantined"].includes(value)) {
    throw new Error(`Invalid memory status: ${status}`);
  }
  return value;
}

function prepareStatusTransition(entry, nextStatus) {
  if (!["active", "pinned"].includes(nextStatus)) return entry;
  if (entry.status === "quarantined" || (entry.policy?.quarantineReasons || []).length) {
    throw new Error(`Quarantined memory cannot be promoted without replacing the unsafe content: ${entry.id}`);
  }
  if (entry.provenance?.trust_level === "untrusted") {
    throw new Error(`Untrusted memory cannot become ${nextStatus}: ${entry.id}`);
  }
  const promoted = entry.provenance?.trust_level === "review"
    ? { ...entry, provenance: { ...entry.provenance, trust_level: "trusted" } }
    : entry;
  if (!isTrustedForActivation(promoted)) {
    throw new Error(`Memory cannot become ${nextStatus} until trusted, unexpired provenance passes review: ${entry.id}`);
  }
  return promoted;
}

function normalizeStatusSet(options = {}) {
  if (options.statuses !== undefined) {
    const statuses = Array.isArray(options.statuses) ? options.statuses : [options.statuses];
    const normalized = statuses.map((status) => String(status || "").trim()).filter(Boolean).map(normalizeStatus);
    return normalized.length ? new Set(normalized) : null;
  }
  if (options.status !== undefined && String(options.status).trim() !== "") {
    return new Set([normalizeStatus(options.status)]);
  }
  return null;
}

function searchStatusFilter(input = {}) {
  if (input.statuses !== undefined || (input.status !== undefined && String(input.status).trim() !== "")) {
    return {
      status: input.status,
      statuses: input.statuses
    };
  }
  return { statuses: ACTIVE_MEMORY_STATUSES };
}

function normalizeVisibility(visibility) {
  const value = String(visibility || "private");
  if (!["private", "team"].includes(value)) {
    throw new Error(`Invalid memory visibility: ${visibility}`);
  }
  return value;
}

function sanitizeTeamMemory(entry) {
  return {
    id: entry.id,
    scope: entry.scope,
    type: entry.type,
    text: entry.text,
    tags: entry.tags || [],
    status: entry.status || "active",
    visibility: entry.visibility || "private",
    provenance: entry.provenance,
    projectName: entry.projectName,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}
