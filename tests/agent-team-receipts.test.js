import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { recallAgentTeamReceipts, rememberAgentTeamReceipt } from "../src/agent-team-receipts.js";

function receiptFixture() {
  return {
    schema_version: "across-agent-team-trust-receipt/1.0",
    receipt_id: "receipt-template:plugin-compatibility-lab-v2",
    pack_id: "plugin-compatibility-lab-v2",
    status: "passed",
    title: "Plugin Adoption Trust Receipt",
    acceptance_checklist: [
      { id: "workflow_pack_valid", status: "passed", required: true }
    ],
    evidence_contract: {
      required: ["runtime_policy", "trust_boundary", "host_exports", "evidence_graph", "validation_gates"]
    }
  };
}

test("agent-team trust receipts are stored as pending team-visible memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-agent-team-receipt-"));
  const vault = new ContextVault({ home });
  const remembered = await rememberAgentTeamReceipt(vault, {
    receipt: receiptFixture(),
    product_card: {
      pack_id: "plugin-compatibility-lab-v2",
      headline: "Test an agent plugin before adoption.",
      primary_user: "plugin adopters",
      competitive_position: "trust layer for agent teams"
    },
    protocol_readiness: { summary: { score: 75, honest_protocol_claims: true } }
  });
  const recalled = await recallAgentTeamReceipts(vault, { packId: "plugin-compatibility-lab-v2" });

  assert.equal(remembered.schema_version, "across-agent-team-receipt-memory/1.0");
  assert.equal(remembered.status, "accepted_pending");
  assert.equal(remembered.memory.visibility, "team");
  assert.equal(remembered.memory.policy.trimmed, false);
  assert.ok(remembered.memory.text.length < 1200);
  assert.equal(recalled.schema_version, "across-context-agent-team-receipt-recall/1.0");
  assert.equal(recalled.result_count, 1);
  assert.equal(recalled.results[0].headline, "Test an agent plugin before adoption.");
  assert.equal(recalled.results[0].protocol_summary.score, 75);
});
