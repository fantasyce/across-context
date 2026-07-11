import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { buildMemoryProjection, readMemoryProjection, rebuildMemoryProjection } from "../src/memory-projection.js";
import { createEmbeddingAdapter } from "../src/embedding-adapter.js";

test("projection rebuild is deterministic and excludes restricted legacy content", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-projection-privacy-"));
  const vault = new ContextVault({ home });
  await vault.init();
  const localPath = ["", "Users", "example", "Documents", "private-project", "report.json"].join("/");
  const fakeSecret = ["sk", "projectionsecret1234567890"].join("-");
  const records = [
    {
      id: "legacy-private",
      scope: "global",
      type: "decision",
      status: "active",
      text: JSON.stringify({ summary: `Inspect ${localPath}`, raw_transcript: "private chat transcript", hidden_reasoning: "private chain of thought" }),
      tags: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    },
    {
      id: "legacy-secret",
      scope: "global",
      type: "note",
      status: "active",
      text: `api_key=${fakeSecret}`,
      tags: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    },
    {
      id: "pending-record",
      scope: "global",
      type: "note",
      status: "pending",
      text: "Pending content must not enter projections.",
      tags: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    }
  ];
  await writeFile(join(home, "global", "memories.jsonl"), `${records.map(JSON.stringify).join("\n")}\n`, "utf8");

  const first = await rebuildMemoryProjection(vault);
  const second = await rebuildMemoryProjection(vault);
  const raw = JSON.stringify(second);

  assert.deepEqual(second, first);
  assert.equal(second.source_record_count, 2);
  assert.equal(second.included_record_count, 1);
  assert.equal(second.excluded_record_count, 1);
  assert.doesNotMatch(raw, new RegExp(localPath.replaceAll("/", "\\/")));
  assert.doesNotMatch(raw, /private chat transcript|private chain of thought|projectionsecret/);
  assert.doesNotMatch(raw, /Pending content/);
  assert.match(raw, /REDACTED_LOCAL_PATH/);
  assert.match(raw, /REDACTED_RAW_TRANSCRIPT/);
  assert.match(raw, /REDACTED_HIDDEN_REASONING/);
  assert.equal(second.privacy_policy.network_required, false);
  assert.equal(second.authoritative_store, "jsonl_vault");
});

test("projection refresh propagates status updates and forget operations", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-projection-forget-"));
  const vault = new ContextVault({ home });
  const entry = await vault.remember({ scope: "global", type: "decision", status: "active", text: "Keep JSONL authoritative." });
  await rebuildMemoryProjection(vault);
  assert.ok((await readMemoryProjection(vault)).graph.nodes.some((node) => node.memory_id === entry.id));

  await vault.updateStatus(entry.id, "pending");
  assert.equal((await readMemoryProjection(vault)).graph.nodes.some((node) => node.memory_id === entry.id), false);

  await vault.updateStatus(entry.id, "pinned");
  assert.ok((await readMemoryProjection(vault)).graph.nodes.some((node) => node.memory_id === entry.id));

  await vault.forget(entry.id);
  assert.equal((await readMemoryProjection(vault)).graph.nodes.some((node) => node.memory_id === entry.id), false);
});

test("pure projection builder produces stable local hash vectors", () => {
  const entries = [{
    id: "stable-vector",
    scope: "global",
    type: "command",
    status: "active",
    text: "Run npm check before release.",
    tags: ["release"],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }];
  assert.deepEqual(buildMemoryProjection(entries), buildMemoryProjection(entries));
});

test("projection accepts an injected embedding adapter and falls back locally", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-projection-adapter-"));
  const vault = new ContextVault({ home });
  await vault.remember({ scope: "global", type: "command", status: "active", text: "Run package checks before release." });
  const provider = createEmbeddingAdapter({
    provider: "fixture",
    model: "fixture-v1",
    dimensions: 8,
    embed: async (texts) => texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0])
  });
  const projected = await rebuildMemoryProjection(vault, { graph: false, embeddingAdapter: provider });
  assert.equal(projected.vectors.provider, "fixture");
  assert.equal(projected.vectors.dimensions, 8);
  assert.equal(projected.vectors.network_performed, false);

  const broken = createEmbeddingAdapter({
    provider: "broken",
    model: "broken-v1",
    dimensions: 8,
    embed: async () => { throw new Error("offline"); }
  });
  const fallback = await rebuildMemoryProjection(vault, { embeddingAdapter: broken });
  assert.equal(fallback.vectors.provider, "local");
  assert.equal(fallback.vectors.fallback_used, true);
  assert.equal(fallback.vectors.network_performed, false);
});
