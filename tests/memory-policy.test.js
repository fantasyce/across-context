import test from "node:test";
import assert from "node:assert/strict";
import { MemoryPolicyEngine, isSensitivePolicyDecision } from "../src/memory-policy.js";

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
  assert.equal(isSensitivePolicyDecision(decision), true);
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

test("MemoryPolicyEngine redacts local absolute paths before writing", () => {
  const policy = new MemoryPolicyEngine();
  const privatePath = ["", "Users", "example", "Documents", "projects", "private-repo"].join("/");

  const decision = policy.evaluate({
    text: `The local checkout is ${privatePath}.`,
    scope: "project",
    type: "note"
  }, []);

  assert.equal(decision.status, "allow");
  assert.equal(decision.localPathRedacted, true);
  assert.equal(decision.redactions, 1);
  assert.match(decision.text, /\[REDACTED_LOCAL_PATH\]/);
  assert.doesNotMatch(decision.text, /\/Users\/example/);
});

test("MemoryPolicyEngine redacts raw transcripts and hidden reasoning generically", () => {
  const policy = new MemoryPolicyEngine();
  const decision = policy.evaluate({
    text: JSON.stringify({
      summary: "Keep only the durable outcome.",
      nested_summary: "Raw transcript: private nested transcript",
      raw_transcript: [{ role: "user", content: "private full transcript" }],
      hidden_reasoning: "private internal chain of thought"
    }),
    scope: "global",
    type: "session"
  }, []);

  assert.equal(decision.status, "quarantine");
  assert.equal(decision.memoryStatus, "quarantined");
  assert.equal(decision.rawTranscriptRedacted, true);
  assert.equal(decision.hiddenReasoningRedacted, true);
  assert.match(decision.text, /REDACTED_RAW_TRANSCRIPT/);
  assert.match(decision.text, /REDACTED_HIDDEN_REASONING/);
  assert.doesNotMatch(decision.text, /private full transcript|private internal chain|private nested transcript/);
});

test("MemoryPolicyEngine applies generic privacy policy to tags", () => {
  const policy = new MemoryPolicyEngine();
  const localPath = ["", "home", "example", "private-project"].join("/");
  const redacted = policy.evaluate({ text: "Reusable project convention.", tags: [`checkout:${localPath}`] }, []);
  assert.equal(redacted.status, "allow");
  assert.match(redacted.tags[0], /REDACTED_LOCAL_PATH/);

  const fakeToken = ["ghp", "tagsecret1234567890123456"].join("_");
  const denied = policy.evaluate({ text: "Reusable project convention.", tags: [`token:${fakeToken}`] }, []);
  assert.equal(denied.status, "deny");
  assert.equal(denied.sensitive, true);
});

test("MemoryPolicyEngine preserves bounded structured distillation provenance", () => {
  const engine = new MemoryPolicyEngine();
  const text = JSON.stringify({
    schema_version: "across-context-distilled-memory-proposal/1.0",
    distilled_text: "A".repeat(400),
    provenance: { sources: Array.from({ length: 8 }, (_, index) => ({ memory_id: `memory-${index}`, digest: "f".repeat(64) })) }
  });
  const result = engine.evaluate({ text, scope: "global", type: "note", source: "memory-distillation", status: "pending" });
  assert.equal(result.status, "allow");
  assert.equal(result.trimmed, false);
  assert.equal(JSON.parse(result.text).provenance.sources.length, 8);
});
