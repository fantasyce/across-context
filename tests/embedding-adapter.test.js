import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddingAdapter, embedWithFallback } from "../src/embedding-adapter.js";

test("embedding adapter normalizes provider vectors", async () => {
  const adapter = createEmbeddingAdapter({
    provider: "fixture",
    model: "fixture-v1",
    dimensions: 8,
    embed: async (texts) => texts.map(() => [2, 0, 0, 0, 0, 0, 0, 0])
  });
  const result = await embedWithFallback(["memory"], { adapter, fallback: () => Array(8).fill(0) });
  assert.equal(result.provider, "fixture");
  assert.equal(result.fallback_used, false);
  assert.deepEqual(result.vectors[0], [1, 0, 0, 0, 0, 0, 0, 0]);
});

test("embedding adapter failure reliably falls back without networking", async () => {
  const adapter = createEmbeddingAdapter({
    provider: "broken-fixture",
    model: "broken-v1",
    dimensions: 8,
    localOnly: false,
    embed: async () => { throw new Error("provider unavailable"); }
  });
  const result = await embedWithFallback(["memory"], { adapter, fallback: () => [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(result.provider, "local");
  assert.equal(result.fallback_used, true);
  assert.equal(result.network_performed, false);
  assert.match(result.fallback_reason, /provider unavailable/);
});
