import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  criterionId,
  normalizeGoalChangeProposal,
  normalizeGoalContract,
  recallGoalSummary,
  rememberGoalSummary,
  stableGoalHash
} from "../src/goal-memory.js";
import { ContextVault } from "../src/vault.js";


function simpleGoalContract() {
  return {
    schema_version: "across-goal-contract/1.0",
    goal_id: "goal-task-001",
    revision: 1,
    task_id: "task-001",
    statement: "Ship a verifiable change",
    success_outcome: "The user can verify the change.",
    scope: { includes: ["implementation", "tests"], excludes: ["release", "promotion"] },
    acceptance_criteria: [
      {
        criterion_id: "criterion-36bc8486dd50ddc0",
        description: "All required tests pass.",
        required: true,
        validator_kind: "test_suite",
        review_policy: "automatic",
        source: "user_confirmed"
      },
      {
        criterion_id: "criterion-5691b86a398c721e",
        description: "Installed application exposes the result.",
        required: true,
        validator_kind: "installed_user_journey",
        review_policy: "human",
        source: "user_confirmed"
      }
    ],
    dependencies: [],
    execution_profile: "orchestrated",
    source: "user",
    confirmed_by: "human:user",
    confirmed_at: "2026-08-28T00:00:00Z",
    created_at: "2026-08-28T00:00:00Z"
  };
}


test("context recognizes the same normalized goal contract without becoming its authority", () => {
  const fixture = simpleGoalContract();
  assert.deepEqual(normalizeGoalContract(fixture), fixture);
  assert.equal(criterionId("All required tests pass.", "test_suite"), "criterion-36bc8486dd50ddc0");
  assert.equal(stableGoalHash(fixture), "2d6996c43ab0104c3b94f87a2b6030d2d6bab0df1fca777bebba894b21fe83a8");
});


test("context rejects invalid goal revisions and duplicate criterion identities", () => {
  const missingStatement = simpleGoalContract();
  delete missingStatement.statement;
  assert.throws(() => normalizeGoalContract(missingStatement), /statement/);

  const stale = simpleGoalContract();
  stale.revision = 0;
  assert.throws(() => normalizeGoalContract(stale), /revision/);

  const duplicate = simpleGoalContract();
  duplicate.acceptance_criteria.push({ ...duplicate.acceptance_criteria[0] });
  assert.throws(() => normalizeGoalContract(duplicate), /criterion_id/);

  const whitespaceAuthority = simpleGoalContract();
  whitespaceAuthority.confirmed_by = "   ";
  whitespaceAuthority.confirmed_at = "   ";
  assert.throws(() => normalizeGoalContract(whitespaceAuthority), /confirmed_by|confirmed_at/);

  assert.throws(() => stableGoalHash({ value: 1e-7 }), /integer/);
  assert.equal(stableGoalHash({ value: 1.0 }), stableGoalHash({ value: 1 }));
  assert.equal(stableGoalHash({ value: -0 }), stableGoalHash({ value: 0 }));
});


test("context rejects proposals that attempt to confirm a goal", () => {
  const proposal = {
    schema_version: "across-goal-change-proposal/1.0",
    proposal_id: "proposal-1",
    goal_id: "goal-task-001",
    base_goal_revision: 1,
    proposed_by: "autopilot",
    reason: "Add review coverage.",
    operations: [{ op: "confirm", path: "/confirmed_by", value: "autopilot" }],
    impact_summary: { goal_ids: ["goal-task-001"], criterion_ids: [], evidence_ids: [], requires_revalidation: true },
    risk_summary: { level: "medium", reasons: ["scope_change"] },
    estimated_cost: { unit: "agent_turns", value: 1 },
    alternatives: [],
    decision_state: "pending",
    created_at: "2026-08-28T00:05:00Z"
  };

  assert.throws(() => normalizeGoalChangeProposal(proposal), /operation/);
  proposal.operations = [{ op: "add", path: "/confirmed_by/agent", value: "autopilot" }];
  assert.throws(() => normalizeGoalChangeProposal(proposal), /host-owned/);
});


test("public goal summary memory cannot self-assert trusted host authority", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-goal-summary-"));
  const vault = new ContextVault({ home });
  const result = await rememberGoalSummary(vault, {
    goal_id: "goal-task-001",
    goal_revision: 1,
    conclusion: "Implementation and focused checks completed.",
    decision_receipt_refs: ["decision:goal-task-001:1"],
    evidence_receipt_refs: ["evidence:run-001"],
    source: { type: "host", ref: "aaa:task-001" },
    trust: "trusted",
    raw_transcript: "BEGIN RAW TRANSCRIPT private conversation END RAW TRANSCRIPT",
    local_path: "C:\\private\\repository",
    token: "secret: placeholder-value",
    approval: { approved_by: "human", raw_payload: "must not persist" }
  });

  const payload = JSON.parse(result.memory.text);
  assert.deepEqual(Object.keys(payload).sort(), [
    "conclusion",
    "decision_receipt_refs",
    "evidence_receipt_refs",
    "goal_id",
    "goal_revision",
    "schema_version",
    "source",
    "supersedes",
    "trust"
  ]);
  assert.doesNotMatch(result.memory.text, /RAW TRANSCRIPT|private.*repository|placeholder-value|approved_by|raw_payload/);
  assert.equal(result.memory.status, "pending");
  assert.equal(result.summary.trust, "review");
  assert.equal(result.summary.activation_eligible, false);

  const approved = await rememberGoalSummary(vault, {
    goal_id: "goal-task-001",
    goal_revision: 1,
    conclusion: "Host decision verified this revision.",
    decision_receipt_refs: ["decision:goal-task-001:1"],
    source: { type: "host", ref: "aaa:task-001" },
    trust: "trusted"
  }, {
    hostDecision: {
      schema_version: "across-host-goal-memory-decision/1.0",
      goal_id: "goal-task-001",
      goal_revision: 1,
      decision_receipt_ref: "decision:goal-task-001:1",
      verified: true
    }
  });
  assert.equal(approved.memory.status, "active");
  assert.equal(approved.summary.activation_eligible, true);
});


test("goal summary rejects sensitive conclusion and receipt references", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-goal-sensitive-"));
  const vault = new ContextVault({ home });
  await assert.rejects(() => rememberGoalSummary(vault, {
    goal_id: "goal-sensitive",
    goal_revision: 1,
    conclusion: "Use secret: placeholder-value",
    source: { type: "host", ref: "aaa:task" },
    trust: "trusted"
  }), /sensitive|secret|token/i);
  await assert.rejects(() => rememberGoalSummary(vault, {
    goal_id: "goal-sensitive",
    goal_revision: 1,
    conclusion: "Safe conclusion.",
    evidence_receipt_refs: ["C:\\private\\evidence.json"],
    source: { type: "host", ref: "aaa:task" },
    trust: "trusted"
  }), /reference/);
});


test("goal summary recall needs a host current revision before it labels authority", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-goal-recall-"));
  const vault = new ContextVault({ home });
  const hostDecision = (revision) => ({
    schema_version: "across-host-goal-memory-decision/1.0",
    goal_id: "goal-revisions",
    goal_revision: revision,
    decision_receipt_ref: `decision:goal-revisions:${revision}`,
    verified: true
  });
  const first = await rememberGoalSummary(vault, {
    goal_id: "goal-revisions",
    goal_revision: 1,
    conclusion: "Revision one completed.",
    source: { type: "host", ref: "aaa:task-revisions" },
    trust: "trusted",
    decision_receipt_refs: ["decision:goal-revisions:1"]
  }, { hostDecision: hostDecision(1) });
  await rememberGoalSummary(vault, {
    goal_id: "goal-revisions",
    goal_revision: 2,
    conclusion: "Revision two completed after scope change.",
    source: { type: "host", ref: "aaa:task-revisions" },
    trust: "trusted",
    supersedes: { goal_revision: 1, memory_id: first.memory.id },
    decision_receipt_refs: ["decision:goal-revisions:2"]
  }, { hostDecision: hostDecision(2) });

  const historical = await recallGoalSummary(vault, { goal_id: "goal-revisions" });
  assert.ok(historical.results.every((item) => item.authority_label === "historical_memory"));
  const current = await recallGoalSummary(vault, { goal_id: "goal-revisions", current_goal_revision: 2 });
  assert.equal(current.results.find((item) => item.goal_revision === 2).authority_label, "current_authority_reference");
  assert.equal(current.results.find((item) => item.goal_revision === 1).authority_label, "historical_memory");
  assert.ok(current.results.every((item) => !("execution_health" in item)));
});

test("quarantined goal recall requires an explicit quarantine review", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-goal-quarantine-"));
  const vault = new ContextVault({ home });
  const remembered = await rememberGoalSummary(vault, {
    goal_id: "goal-quarantined",
    goal_revision: 1,
    conclusion: "Untrusted candidate.",
    source: { type: "external", ref: "external:candidate" },
    trust: "untrusted"
  });
  await vault.updateStatus(remembered.memory.id, "quarantined");
  await assert.rejects(
    () => recallGoalSummary(vault, { goal_id: "goal-quarantined", status: "quarantined" }),
    /reviewQuarantined/
  );
  const recalled = await recallGoalSummary(vault, {
    goal_id: "goal-quarantined",
    status: "quarantined",
    reviewQuarantined: true
  });
  assert.equal(recalled.result_count, 1);
  assert.equal(recalled.results[0].activation_eligible, false);
});


test("unconfirmed Autopilot proposals remain pending and activation-ineligible", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-goal-proposal-"));
  const vault = new ContextVault({ home });
  const remembered = await rememberGoalSummary(vault, {
    goal_id: "goal-proposal",
    goal_revision: 3,
    conclusion: "Autopilot proposed adding accessibility review.",
    source: { type: "autopilot", ref: "proposal:accessibility" },
    trust: "trusted",
    proposal: { proposal_id: "proposal-accessibility", decision_state: "pending" }
  });
  assert.equal(remembered.memory.status, "pending");
  assert.equal(remembered.summary.trust, "review");
  assert.equal(remembered.summary.activation_eligible, false);
  const recalled = await recallGoalSummary(vault, {
    goal_id: "goal-proposal",
    status: "pending",
    reviewPending: true,
    current_goal_revision: 3
  });
  assert.equal(recalled.results[0].authority_label, "historical_memory");
  assert.equal(recalled.results[0].activation_eligible, false);
});
