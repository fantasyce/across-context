import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";

async function tempVault(options = {}) {
  const home = await mkdtemp(join(tmpdir(), "across-context-vault-management-"));
  return new ContextVault({ home, ...options });
}

test("ContextVault rejects sensitive memories through the policy engine", async () => {
  const vault = await tempVault();
  const fakeToken = ["ghp", "1234567890abcdefghijklmnop"].join("_");

  await assert.rejects(() => vault.remember({
    scope: "global",
    type: "note",
    text: `The GitHub token is ${fakeToken}.`
  }), /Memory rejected/i);

  const raw = await readFile(join(vault.home, "global", "memories.jsonl"), "utf8");
  assert.equal(raw, "");
});

test("ContextVault returns duplicate matches without appending another record", async () => {
  const vault = await tempVault();

  const first = await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer concise Chinese status updates."
  });
  const second = await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer concise Chinese status updates."
  });

  const raw = await readFile(join(vault.home, "global", "memories.jsonl"), "utf8");
  assert.equal(second.duplicateOf, first.id);
  assert.equal(raw.trim().split("\n").length, 1);
});

test("ContextVault lists, forgets, and reports memory stats", async () => {
  const vault = await tempVault();
  const entry = await vault.remember({
    scope: "global",
    type: "command",
    text: "Run npm test before release."
  });

  assert.equal((await vault.listMemories()).length, 1);
  const stats = await vault.stats();
  assert.equal(stats.total, 1);
  assert.equal(stats.byType.command, 1);

  const result = await vault.forget(entry.id);
  assert.equal(result.forgotten, 1);
  assert.equal((await vault.listMemories()).length, 0);
});

test("ContextVault compacts duplicate jsonl records already on disk", async () => {
  const vault = await tempVault();
  await vault.init();
  const file = join(vault.home, "global", "memories.jsonl");
  const duplicate = {
    id: "mem_duplicate_a",
    scope: "global",
    type: "note",
    text: "Keep the release checklist short.",
    tags: [],
    status: "active",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z"
  };
  await writeFile(file, `${JSON.stringify(duplicate)}\n${JSON.stringify({ ...duplicate, id: "mem_duplicate_b" })}\n`, "utf8");

  const result = await vault.compact();
  const memories = await vault.listMemories();

  assert.equal(result.removed, 1);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].id, "mem_duplicate_a");
});
