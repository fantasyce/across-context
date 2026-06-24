import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MemoryPolicyEngine, isSensitivePolicyDecision, normalizeMemoryText } from "./memory-policy.js";
import { searchEntries } from "./semantic-search.js";
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

export class ContextVault {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.home = resolve(options.home || defaultHome(this.env));
    this.policy = new MemoryPolicyEngine(options.policy || {});
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

    const existing = await this.listMemories({
      projectRoot: input.projectRoot,
      includeGlobal: true
    });
    const decision = this.policy.evaluate({
      text: input.text,
      scope,
      type,
      projectRoot: input.projectRoot,
      tags: input.tags || [],
      auto: Boolean(input.auto),
      status: input.status
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
      tags: splitTags(input.tags),
      source: input.source,
      status: normalizeStatus(decision.memoryStatus || input.status || "active"),
      visibility: normalizeVisibility(input.visibility || "private"),
      policy: {
        status: decision.status,
        trimmed: Boolean(decision.trimmed)
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
  }

  async listMemories(options = {}) {
    await this.init();
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
    return memories
      .filter((entry) => !options.status || (entry.status || "active") === options.status)
      .filter((entry) => !options.visibility || (entry.visibility || "private") === options.visibility)
      .filter((entry) => !options.type || entry.type === options.type)
      .filter((entry) => !options.scope || entry.scope === options.scope)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async stats(options = {}) {
    const memories = await this.listMemories(options);
    return {
      home: this.home,
      total: memories.length,
      byScope: countBy(memories, "scope"),
      byType: countBy(memories, "type"),
      byStatus: countBy(memories.map((entry) => ({ ...entry, status: entry.status || "active" })), "status")
    };
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

    let forgotten = 0;
    for (const file of await this.#memoryFiles()) {
      const memories = await readJsonl(file);
      const forgottenCandidates = [];
      const kept = memories.filter((entry) => {
        if (entry.id === targetId) {
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
    return { forgotten };
  }

  async updateStatus(id, status) {
    await this.init();
    const nextStatus = normalizeStatus(status);
    const targetId = String(id || "").trim();
    if (!targetId) {
      throw new Error("Memory id is required");
    }

    for (const file of await this.#memoryFiles()) {
      const memories = await readJsonl(file);
      const index = memories.findIndex((entry) => entry.id === targetId);
      if (index === -1) continue;
      const updated = {
        ...memories[index],
        status: nextStatus,
        updatedAt: nowIso()
      };
      memories[index] = updated;
      await writeJsonl(file, memories);
      return updated;
    }
    throw new Error(`Memory not found: ${targetId}`);
  }

  async updateStatuses(ids, status) {
    await this.init();
    const nextStatus = normalizeStatus(status);
    const targetIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!targetIds.length) {
      throw new Error("At least one memory id is required");
    }

    const targets = new Set(targetIds);
    const updated = [];
    for (const file of await this.#memoryFiles()) {
      const memories = await readJsonl(file);
      let changed = false;
      for (let index = 0; index < memories.length; index += 1) {
        if (!targets.has(memories[index].id)) continue;
        const entry = {
          ...memories[index],
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
  }

  async exportTeamMemory(options = {}) {
    const memories = await this.listMemories({
      projectRoot: options.projectRoot,
      includeGlobal: false,
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
  }

  async search(input) {
    const query = String(input.query || "").trim();
    if (!query && !input.allowEmptyQuery) {
      return [];
    }
    const memories = await this.listMemories({
      projectRoot: input.projectRoot,
      includeGlobal: input.includeGlobal !== false,
      status: input.status,
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
    try {
      await readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(file, "", "utf8");
    }
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
  await writeFile(file, content ? `${content}\n` : "", "utf8");
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

function isSensitivePolicyEvent(event) {
  return isSensitivePolicyDecision({
    sensitive: event.sensitive,
    category: event.policyCategory,
    reason: event.reason
  });
}

function normalizeStatus(status) {
  const value = String(status || "active");
  if (!["pending", "active", "pinned", "archived", "expired"].includes(value)) {
    throw new Error(`Invalid memory status: ${status}`);
  }
  return value;
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
    projectName: entry.projectName,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}
