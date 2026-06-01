import { mkdtemp, readFile } from "node:fs/promises";
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
