import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MemoryPolicyEngine, normalizeMemoryText } from "./memory-policy.js";
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

export class ContextVault {
  constructor(options = {}) {
    this.home = resolve(options.home || defaultHome());
    this.policy = new MemoryPolicyEngine(options.policy || {});
  }

  async init() {
    await mkdir(join(this.home, "global"), { recursive: true });
    await mkdir(join(this.home, "projects"), { recursive: true });
    await this.#ensureJsonl(join(this.home, "global", "memories.jsonl"));
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
      tags: input.tags || []
    }, existing);

    if (decision.status === "deny") {
      throw new Error(`Memory rejected: ${decision.reason}`);
    }
    if (decision.status === "duplicate") {
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
      status: "active",
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
    }
    return memories.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
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

  async forget(id) {
    await this.init();
    const targetId = String(id || "").trim();
    if (!targetId) {
      throw new Error("Memory id is required");
    }

    let forgotten = 0;
    for (const file of await this.#memoryFiles()) {
      const memories = await readJsonl(file);
      const kept = memories.filter((entry) => {
        if (entry.id === targetId) {
          forgotten += 1;
          return false;
        }
        return true;
      });
      if (kept.length !== memories.length) {
        await writeJsonl(file, kept);
      }
    }
    return { forgotten };
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
    if (!query) {
      return [];
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const memories = await this.listMemories({
      projectRoot: input.projectRoot,
      includeGlobal: input.includeGlobal !== false
    });
    const scored = memories
      .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)));
    return scored.slice(0, input.limit || 20);
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

function scoreEntry(entry, terms) {
  const haystack = `${entry.text} ${entry.type} ${(entry.tags || []).join(" ")} ${entry.projectName || ""}`.toLowerCase();
  return terms.reduce((score, term) => {
    if (haystack.includes(term)) return score + 2;
    if (term.length > 3 && haystack.includes(term.slice(0, -1))) return score + 1;
    return score;
  }, 0);
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
