import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { renderAgentCard } from "./agent-card.js";

export const SKILL_EXPORT_SCHEMA = "agentskills.io-export/1.0";
export const SKILL_IMPORT_SCHEMA = "across-context-skill-memory-import/1.0";

export async function renderSkillExport(vault, options = {}) {
  const card = await renderAgentCard(vault);
  const files = [];
  for (const skill of card.skills || []) {
    const dir = safeName(skill.id);
    files.push({
      path: `${dir}/SKILL.md`,
      content: skillMarkdown(skill)
    });
    files.push({
      path: `${dir}/agents/openai.yaml`,
      content: openaiAgentYaml(skill)
    });
  }
  const payload = {
    schema_version: SKILL_EXPORT_SCHEMA,
    status: "passed",
    provider: "across-context",
    format: "agentskills.io",
    file_count: files.length,
    skills: (card.skills || []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      files: [`${safeName(skill.id)}/SKILL.md`, `${safeName(skill.id)}/agents/openai.yaml`]
    })),
    files,
    boundaries: {
      raw_memory_included: false,
      raw_transcripts_included: false,
      secrets_included: false
    }
  };
  if (options.outputDir) {
    const root = resolve(options.outputDir);
    for (const file of files) {
      const target = join(root, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    payload.output_dir = root;
  }
  return payload;
}

export async function importSkillDirectories(vault, options = {}) {
  const roots = normalizeRoots(options.roots || options.root || defaultSkillRoots(options.env || process.env));
  const discovered = [];
  const remembered = [];
  for (const root of roots) {
    const source = await scanRoot(root);
    discovered.push(source);
    for (const skill of source.skills) {
      const entry = await vault.remember({
        text: JSON.stringify({
          schema_version: "across-skill-memory-summary/1.0",
          skill_id: skill.id,
          name: skill.name,
          source: source.id,
          summary: skill.summary,
          format: skill.format,
          raw_skill_body_included: false
        }),
        scope: "global",
        type: "note",
        tags: ["external-skill", `skill-source:${source.id}`, `skill:${skill.id}`],
        source: "skill-import",
        auto: true,
        status: "pending",
        visibility: "team"
      });
      remembered.push({ skill_id: skill.id, memory_id: entry.id, status: entry.status });
    }
  }
  return {
    schema_version: SKILL_IMPORT_SCHEMA,
    status: "accepted_pending",
    roots,
    discovered,
    remembered,
    summary: {
      source_count: discovered.length,
      skill_count: discovered.reduce((count, source) => count + source.skills.length, 0),
      memory_count: remembered.length,
      raw_skill_bodies_included: false,
      secrets_included: false
    }
  };
}

export function defaultSkillRoots(env = process.env) {
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  return [
    join(codexHome, "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".qwen", "skills")
  ];
}

async function scanRoot(root) {
  const source = {
    id: sourceId(root),
    root,
    status: "missing",
    skills: []
  };
  try {
    const entries = await readdir(root, { withFileTypes: true });
    source.status = "passed";
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, "SKILL.md");
      try {
        source.skills.push(summarizeSkill(entry.name, path, await readFile(path, "utf8")));
      } catch {
        continue;
      }
    }
  } catch {
    return source;
  }
  return source;
}

function summarizeSkill(id, path, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = (lines.find((line) => line.startsWith("# ")) || "").replace(/^#\s+/, "") || id;
  const summary = redact(lines.find((line) => !line.startsWith("#") && !line.startsWith("-")) || "");
  return {
    id,
    name,
    path,
    status: "passed",
    summary: summary.slice(0, 240),
    format: "agentskills.io"
  };
}

function skillMarkdown(skill) {
  return [
    `# ${skill.name || skill.id}`,
    "",
    skill.description || "Across Context skill.",
    "",
    "Use this skill when an agent needs shared local memory, pending review, evidence memory, or context-pack handoff from Across Context.",
    "",
    "Boundaries: do not store raw secrets, provider keys, hidden reasoning, or full transcripts as long-term memory. Automatic writes stay pending for review."
  ].join("\n") + "\n";
}

function openaiAgentYaml(skill) {
  return [
    "schema_version: agents/openai.yaml",
    `name: ${JSON.stringify(skill.name || skill.id)}`,
    `skill_id: ${JSON.stringify(skill.id)}`,
    "provider: across-context",
    "memory_policy:",
    "  default_write_status: pending",
    "  raw_transcripts_included: false",
    "  secrets_included: false"
  ].join("\n") + "\n";
}

function normalizeRoots(value) {
  const roots = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(roots.map((root) => resolve(String(root || "").replace(/^~/, homedir()))).filter(Boolean))];
}

function sourceId(root) {
  if (root.includes(".codex/skills")) return "codex-skills";
  if (root.includes(".claude/skills")) return "claude-code-skills";
  if (root.includes(".qwen/skills")) return "qwen-code-skills";
  return basename(root) || "skills";
}

function safeName(value) {
  return String(value || "skill").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function redact(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,}/g, "[redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{16,}/g, "[redacted]")
    .replace(/\/Users\/[^\s]+\/(Documents|Desktop|Downloads)\/[^\s]+/g, "[redacted-local-path]");
}
