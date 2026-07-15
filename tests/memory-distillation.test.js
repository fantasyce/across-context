import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import {
  approveDistilledMemory,
  DISTILLED_MEMORY_PROPOSAL_SCHEMA,
  improveMemory,
  rollbackDistilledMemory
} from "../src/memory-distillation.js";

test("improve distills session and pending candidates into governed proposals", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-improve-"));
  const vault = new ContextVault({ home });
  const localPath = ["", "Users", "example", "Documents", "private", "repo"].join("/");
  const first = await vault.remember({
    scope: "global",
    type: "session",
    status: "pending",
    text: `Recurring timeout failure in repository checks. Inspect ${localPath} before retry.`,
    tags: ["failure-pattern"]
  });
  const second = await vault.remember({
    scope: "global",
    type: "session",
    status: "pending",
    text: "Recurring timeout failure in repository checks requires bounded retry.",
    tags: ["failure-pattern"]
  });
  await vault.remember({
    scope: "global",
    type: "note",
    status: "active",
    text: "An ordinary active note is not a distillation source."
  });

  const result = await improveMemory(vault);
  assert.equal(result.status, "completed");
  assert.equal(result.proposal_count, 1);
  const proposalEntry = result.proposals[0].memory;
  const proposal = JSON.parse(proposalEntry.text);
  assert.equal(proposalEntry.status, "pending");
  assert.equal(proposalEntry.provenance.schema_version, "across-memory-provenance/1.0");
  assert.equal(proposalEntry.provenance.trust_level, "trusted");
  assert.equal(proposal.schema_version, DISTILLED_MEMORY_PROPOSAL_SCHEMA);
  assert.equal(proposal.governance.approval_required, true);
  assert.deepEqual(proposal.provenance.sources.map((source) => source.memory_id), [first.id, second.id].sort());
  assert.ok(proposal.provenance.sources.every((source) => source.source_type && source.evidence_hash && source.observed_at));
  assert.doesNotMatch(proposalEntry.text, /\/Users\/example/);
  assert.match(proposal.distilled_text, /REDACTED_LOCAL_PATH/);

  const duplicateRun = await improveMemory(vault);
  assert.equal(duplicateRun.proposal_count, 0);
  assert.equal(duplicateRun.duplicate_proposal_count, 1);

  const approved = await approveDistilledMemory(vault, proposalEntry.id);
  assert.equal(approved.status, "active");
  let records = await vault.listMemories({ includeGlobal: true });
  assert.equal(records.find((entry) => entry.id === first.id).status, "archived");
  assert.equal(records.find((entry) => entry.id === second.id).status, "archived");

  const rolledBack = await rollbackDistilledMemory(vault, proposalEntry.id);
  assert.equal(rolledBack.status, "archived");
  records = await vault.listMemories({ includeGlobal: true });
  assert.equal(records.find((entry) => entry.id === first.id).status, "pending");
  assert.equal(records.find((entry) => entry.id === second.id).status, "pending");
});

test("improve rejects legacy secret sources and forgetting propagates to proposals", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-improve-forget-"));
  const vault = new ContextVault({ home });
  await vault.init();
  const source = await vault.remember({
    scope: "global",
    type: "session",
    status: "pending",
    text: "Package failure requires a verified repair command.",
    tags: ["failure-pattern"]
  });
  const file = join(home, "global", "memories.jsonl");
  const current = await readFile(file, "utf8");
  const secret = ["sk", "legacydistillationsecret123456789"].join("-");
  await writeFile(file, `${current}${JSON.stringify({
    id: "legacy-secret-source",
    scope: "global",
    type: "session",
    status: "pending",
    text: `api_key=${secret}`,
    tags: [],
    createdAt: "2026-07-01T00:00:00.000Z"
  })}\n`);

  const result = await improveMemory(vault);
  assert.equal(result.rejected_source_count, 1);
  assert.equal(result.rejected_sources[0].memory_id, "legacy-secret-source");
  assert.doesNotMatch(JSON.stringify(result), /legacydistillationsecret/);
  const proposalId = result.proposals[0].memory.id;

  const forgotten = await vault.forget(source.id);
  assert.equal(forgotten.forgotten, 2);
  assert.deepEqual(new Set(forgotten.forgottenIds), new Set([source.id, proposalId]));
  const remaining = await vault.listMemories({ includeGlobal: true });
  assert.equal(remaining.some((entry) => entry.id === proposalId), false);
});

test("improve preserves provenance for a large exact-duplicate group", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-improve-provenance-"));
  const vault = new ContextVault({ home, policy: { allowDuplicates: true } });
  for (let index = 0; index < 6; index += 1) {
    await vault.remember({
      scope: "global",
      type: "session",
      status: "pending",
      text: "Repeated quality gate timeout should use heartbeat evidence before retry.",
      source: `fixture-${index}`
    });
  }
  const result = await improveMemory(vault);
  const proposal = JSON.parse(result.proposals[0].memory.text);
  assert.equal(result.eligible_source_count, 6);
  assert.equal(result.proposal_count, 1);
  assert.equal(proposal.provenance.source_count, 6);
  assert.equal(proposal.provenance.sources.length, 6);
  assert.equal(result.proposals[0].memory.policy.trimmed, false);
});
