import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";

async function tempVault() {
  const home = await mkdtemp(join(tmpdir(), "across-context-semantic-"));
  return new ContextVault({ home });
}

test("semantic search matches related agent-memory terms without exact words", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "decision",
    text: "Store durable preferences in the local vault before switching coding assistants.",
    tags: ["memory", "agents"]
  });
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Use blue screenshots in the README."
  });

  const results = await vault.search({
    query: "shared context between agents",
    mode: "semantic",
    includeGlobal: true
  });

  assert.match(results[0].entry.text, /durable preferences/);
  assert.ok(results[0].score > 0);
  assert.equal(results[0].matchMode, "semantic");
});

test("hybrid search ranks exact matches above semantic-only matches", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Project release checklist should include screenshots."
  });
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Agent memory should capture reusable deployment context."
  });

  const results = await vault.search({
    query: "release screenshots",
    mode: "hybrid",
    includeGlobal: true
  });

  assert.match(results[0].entry.text, /release checklist/);
  assert.equal(results[0].matchMode, "hybrid");
});

test("hybrid search returns score explanations and matched fields", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "command",
    text: "Run npm test before publishing v0.3.",
    tags: ["release", "verification"]
  });

  const [result] = await vault.search({
    query: "release verification",
    mode: "hybrid",
    includeGlobal: true
  });

  assert.equal(result.matchMode, "hybrid");
  assert.ok(result.explanation.scoreComponents.exact > 0);
  assert.ok(result.explanation.matchedFields.includes("tags"));
  assert.ok(result.explanation.matchedTerms.includes("release"));
});

test("dashboard search can return recent filtered memories without a query", async () => {
  const vault = await tempVault();
  await vault.remember({ scope: "global", type: "note", text: "Old note." });
  const newest = await vault.remember({
    scope: "global",
    type: "decision",
    text: "Newest decision."
  });

  const results = await vault.search({
    query: "",
    mode: "hybrid",
    includeGlobal: true,
    allowEmptyQuery: true,
    type: "decision"
  });

  assert.equal(results[0].entry.id, newest.id);
  assert.equal(results[0].explanation.reason, "recent");
});
