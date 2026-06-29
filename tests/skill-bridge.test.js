import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { resolveMemoryBackend } from "../src/memory-backend.js";
import { importSkillDirectories, renderSkillExport } from "../src/skill-export.js";

test("skill export renders agentskills.io files without raw memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-skill-export-"));
  const output = await mkdtemp(join(tmpdir(), "across-context-skill-output-"));
  const vault = new ContextVault({ home });

  const exported = await renderSkillExport(vault, { outputDir: output });

  assert.equal(exported.schema_version, "agentskills.io-export/1.0");
  assert.equal(exported.status, "passed");
  assert.equal(exported.boundaries.raw_memory_included, false);
  assert.ok(exported.files.some((file) => file.path.endsWith("SKILL.md")));
  assert.ok(exported.files.some((file) => file.path.endsWith("agents/openai.yaml")));
  assert.match(await readFile(join(output, "shared-memory", "SKILL.md"), "utf8"), /# Shared Memory/);
});

test("skill import stores redacted pending summaries only", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-skill-import-"));
  const root = await mkdtemp(join(tmpdir(), "across-context-skills-"));
  const skill = join(root, "demo-skill");
  await mkdir(skill, { recursive: true });
  const fakeKey = "s" + "k-" + "shouldnotleak1234567890";
  const privatePath = "/" + ["Users", "example", "Documents", "private"].join("/");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(
    join(skill, "SKILL.md"),
    `# Demo Skill\n\nUse for local review. ${fakeKey} ${privatePath}\n`,
    "utf8"
  ));
  const vault = new ContextVault({ home });

  const imported = await importSkillDirectories(vault, { roots: [root] });
  const memories = await vault.listMemories({ includeGlobal: true, status: "pending" });
  const raw = JSON.stringify(memories);

  assert.equal(imported.schema_version, "across-context-skill-memory-import/1.0");
  assert.equal(imported.summary.memory_count, 1);
  assert.equal(imported.summary.raw_skill_bodies_included, false);
  assert.equal(memories[0].visibility, "team");
  assert.doesNotMatch(raw, /shouldnotleak/);
  assert.doesNotMatch(raw, /Documents\/private/);
});

test("memory backend switch remains local and redacted-summary only", () => {
  const mem0 = resolveMemoryBackend({ backend: "mem0" });
  const graph = resolveMemoryBackend({ backend: "graphrag" });
  const fallback = resolveMemoryBackend({ backend: "unknown" });

  assert.equal(mem0.backend, "mem0");
  assert.equal(mem0.network_dependency_required, false);
  assert.equal(mem0.candidate_ingest_policy.outgoing_payload, "redacted_summary_only");
  assert.equal(graph.backend, "graphrag");
  assert.equal(fallback.backend, "vault");
  assert.equal(fallback.status, "fallback");
});
