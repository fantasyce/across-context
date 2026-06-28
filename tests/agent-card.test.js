import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { renderAgentCard } from "../src/agent-card.js";

test("renderAgentCard describes Across Context as a local memory provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-agent-card-"));
  const vault = new ContextVault({ home });
  const card = await renderAgentCard(vault);

  assert.equal(card.name, "Across Context");
  assert.equal(card.capabilities.memory, true);
  assert.equal(card.capabilities.agentLoopMemoryHooks, true);
  assert.equal(card.capabilities.evidenceGraphMemory, true);
  assert.equal(card.capabilities.agentTeamTrustReceipts, true);
  assert.equal(card.capabilities.allProjectPendingReview, true);
  assert.equal(card.endpoints.mcp.command, "across-context");
  assert.equal(card.protocols.mcp.transport, "stdio");
  assert.equal(card.protocols.mcp.resources, true);
  assert.equal(card.protocols.a2a.discoveryReady, true);
  assert.equal(card.governance.pendingApproval, true);
  assert.equal(card.governance.allProjectPendingReview, true);
  assert.equal(card.governance.loopMemoryPolicy.defaultWriteStatus, "pending");
  assert.equal(card.governance.loopMemoryPolicy.adapterContract.review.allProjectsCli, "across-context pending --all-projects --json");
  assert.equal(card.governance.loopMemoryPolicy.neverPersist.includes("full transcripts"), true);
  assert.deepEqual(card.memory.types, ["preference", "decision", "note", "command", "session"]);
  assert.deepEqual(card.memory.loopHooks, ["pre_loop_search", "step_context_attach", "post_loop_pending_summary"]);
  assert.deepEqual(card.memory.reviewModes, ["global", "project", "all-projects"]);
  assert.equal(card.memory.evidenceGraphSchema, "across-evidence-graph/1.0");
  assert.equal(card.memory.agentTeamReceiptSchema, "across-agent-team-receipt-memory/1.0");
  assert.equal(card.vault.storage, "local-jsonl");
  assert.equal(card.vault.home, undefined);
  assert.doesNotMatch(JSON.stringify(card), new RegExp(escapeRegExp(home)));
  assert.ok(card.skills.some((skill) => skill.id === "shared-memory"));
  assert.ok(card.skills.some((skill) => skill.id === "agent-loop-memory-hooks"));
  assert.ok(card.skills.some((skill) => skill.id === "evidence-graph-memory"));
  assert.ok(card.skills.some((skill) => skill.id === "agent-team-trust-receipts"));
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
