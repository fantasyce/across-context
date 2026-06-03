import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { runHook } from "../src/hooks.js";

test("task-start hook returns relevant context for deterministic agent bootstrap", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-hooks-"));
  const projectRoot = join(home, "project");
  const vault = new ContextVault({ home });
  await vault.remember({
    scope: "project",
    projectRoot,
    type: "command",
    text: "Run npm test before final answers."
  });

  const result = await runHook(vault, {
    name: "task-start",
    query: "test command",
    projectRoot
  });

  assert.match(result.text, /Run npm test/);
  assert.equal(result.memories.length, 1);
});

test("task-end hook stores session summaries as pending automatic memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-hooks-"));
  const vault = new ContextVault({ home });

  const result = await runHook(vault, {
    name: "task-end",
    summary: "Implemented dashboard and semantic search in v0.2.",
    projectRoot: home
  });

  assert.equal(result.entry.status, "pending");
  assert.equal((await vault.listMemories({ projectRoot: home, status: "pending" })).length, 1);
});
