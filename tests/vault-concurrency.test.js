import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { readMemoryProjection, rebuildMemoryProjection } from "../src/memory-projection.js";

test("concurrent remember update and forget operations preserve JSONL and projections", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-concurrency-"));
  const vaults = [new ContextVault({ home }), new ContextVault({ home }), new ContextVault({ home })];
  const created = await Promise.all(Array.from({ length: 30 }, (_, index) => vaults[index % vaults.length].remember({
    scope: "global",
    type: index % 2 ? "command" : "decision",
    status: "active",
    text: `Concurrent memory ${index} with unique payload.`
  })));

  const rawBeforeProjection = await readFile(join(home, "global", "memories.jsonl"), "utf8");
  assert.equal(rawBeforeProjection.trim().split("\n").length, 30);
  assert.doesNotThrow(() => rawBeforeProjection.trim().split("\n").map(JSON.parse));

  await rebuildMemoryProjection(vaults[0]);
  await Promise.all([
    ...created.slice(0, 8).map((entry, index) => vaults[index % vaults.length].updateStatus(entry.id, "pinned")),
    ...created.slice(8, 16).map((entry, index) => vaults[index % vaults.length].forget(entry.id)),
    ...Array.from({ length: 8 }, (_, index) => vaults[index % vaults.length].remember({
      scope: "global",
      type: "note",
      status: "active",
      text: `Projection concurrent addition ${index}.`
    }))
  ]);

  const memories = await vaults[0].listMemories({ statuses: ["active", "pinned"] });
  const raw = await readFile(join(home, "global", "memories.jsonl"), "utf8");
  const projection = await readMemoryProjection(vaults[0]);
  const projectedIds = new Set(projection.graph.nodes.filter((node) => node.type === "memory").map((node) => node.memory_id));

  assert.equal(memories.length, 30);
  assert.equal(raw.trim().split("\n").length, 30);
  assert.doesNotThrow(() => raw.trim().split("\n").map(JSON.parse));
  assert.deepEqual(projectedIds, new Set(memories.map((entry) => entry.id)));
  assert.equal(projection.included_record_count, 30);
});
