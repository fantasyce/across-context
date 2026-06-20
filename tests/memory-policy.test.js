import test from "node:test";
import assert from "node:assert/strict";
import { MemoryPolicyEngine } from "../src/memory-policy.js";

test("MemoryPolicyEngine denies sensitive secrets before writing", () => {
  const policy = new MemoryPolicyEngine();
  const fakeKey = ["sk", "test", "1234567890abcdef"].join("-");

  const decision = policy.evaluate({
    text: `Use OPENAI_API_KEY=${fakeKey} for local runs.`,
    scope: "global",
    type: "note"
  }, []);

  assert.equal(decision.status, "deny");
  assert.equal(decision.category, "sensitive");
  assert.equal(decision.sensitive, true);
  assert.match(decision.reason, /secret/i);
});

test("MemoryPolicyEngine detects duplicate durable memories", () => {
  const policy = new MemoryPolicyEngine();
  const decision = policy.evaluate({
    text: " Prefer small commits with tests. ",
    scope: "global",
    type: "preference"
  }, [
    {
      id: "mem_existing",
      scope: "global",
      type: "preference",
      text: "Prefer small commits with tests."
    }
  ]);

  assert.equal(decision.status, "duplicate");
  assert.equal(decision.matchedId, "mem_existing");
});

test("MemoryPolicyEngine trims long memories while preserving the policy decision", () => {
  const policy = new MemoryPolicyEngine({ maxTextLength: 48 });

  const decision = policy.evaluate({
    text: "Remember this stable project decision because it should be available to every local agent in future sessions.",
    scope: "project",
    type: "decision"
  }, []);

  assert.equal(decision.status, "allow");
  assert.equal(decision.trimmed, true);
  assert.ok(decision.text.length <= 48);
});
