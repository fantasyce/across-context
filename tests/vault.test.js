import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";

async function tempVault() {
  const home = await mkdtemp(join(tmpdir(), "across-context-vault-"));
  return new ContextVault({ home });
}

test("ContextVault stores global memories in append-only jsonl", async () => {
  const vault = await tempVault();

  const entry = await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer pnpm over npm for JavaScript projects.",
    tags: ["javascript", "package-manager"]
  });

  assert.match(entry.id, /^mem_/);
  assert.equal(entry.scope, "global");
  const raw = await readFile(join(vault.home, "global", "memories.jsonl"), "utf8");
  assert.match(raw, /Prefer pnpm over npm/);
});

test("ContextVault ignores old .across-context vaults", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-legacy-home-"));
  const acrossHome = await mkdtemp(join(tmpdir(), "across-home-"));
  const legacyGlobal = join(home, ".across-context", "global");
  await mkdir(legacyGlobal, { recursive: true });
  await writeFile(
    join(legacyGlobal, "memories.jsonl"),
    `${JSON.stringify({
      id: "mem_legacy",
      scope: "global",
      type: "preference",
      text: "Legacy shared memory should migrate.",
      tags: [],
      status: "active",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z"
    })}\n`,
    "utf8"
  );

  const vault = new ContextVault({ env: { HOME: home, ACROSS_HOME: acrossHome } });
  const memories = await vault.listMemories();

  assert.equal(vault.home, join(acrossHome, "data", "across-context"));
  assert.deepEqual(memories, []);
});

test("ContextVault does not backfill old .across-context files when ACROSS_HOME data already exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-backfill-home-"));
  const acrossHome = await mkdtemp(join(tmpdir(), "across-home-"));
  const newGlobal = join(acrossHome, "data", "across-context", "global");
  const legacyProject = join(home, ".across-context", "projects", "legacy-project");
  await mkdir(newGlobal, { recursive: true });
  await mkdir(legacyProject, { recursive: true });
  await writeFile(
    join(newGlobal, "memories.jsonl"),
    `${JSON.stringify({
      id: "mem_current",
      scope: "global",
      type: "note",
      text: "Current shared memory should remain.",
      tags: [],
      status: "active",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z"
    })}\n`,
    "utf8"
  );
  await writeFile(
    join(legacyProject, "memories.jsonl"),
    `${JSON.stringify({
      id: "mem_legacy_project",
      scope: "project",
      type: "decision",
      text: "Legacy project memory should backfill.",
      tags: [],
      status: "active",
      projectId: "legacy-project",
      projectName: "legacy",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z"
    })}\n`,
    "utf8"
  );

  const vault = new ContextVault({ env: { HOME: home, ACROSS_HOME: acrossHome } });
  await vault.init();

  assert.match(
    await readFile(join(vault.home, "global", "memories.jsonl"), "utf8"),
    /Current shared memory should remain/
  );
  assert.match(
    await readFile(join(vault.home, "global", "memories.jsonl"), "utf8"),
    /Current shared memory should remain/
  );
  await assert.rejects(
    () => readFile(join(vault.home, "projects", "legacy-project", "memories.jsonl"), "utf8"),
    { code: "ENOENT" }
  );
});

test("ContextVault stores project memories with a stable project id", async () => {
  const vault = await tempVault();
  const projectRoot = join(vault.home, "workspace", "demo-app");

  const first = await vault.remember({
    scope: "project",
    type: "decision",
    text: "Do not replace the Swift client with Electron.",
    projectRoot
  });
  const second = await vault.remember({
    scope: "project",
    type: "command",
    text: "Run npm test before committing frontend changes.",
    projectRoot
  });

  assert.equal(first.projectId, second.projectId);
  assert.equal(first.projectName, "demo-app");
});

test("ContextVault searches project and global memories by relevance", async () => {
  const vault = await tempVault();
  const projectRoot = join(vault.home, "workspace", "demo-app");
  await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer concise Chinese summaries for status updates."
  });
  await vault.remember({
    scope: "project",
    type: "decision",
    text: "The release gate requires browser screenshots.",
    projectRoot
  });

  const results = await vault.search({
    query: "release screenshots",
    projectRoot,
    includeGlobal: true
  });

  assert.match(results[0].entry.text, /release gate/);
  assert.ok(results[0].score > 0);
});
