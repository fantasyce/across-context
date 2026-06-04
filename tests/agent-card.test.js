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
  assert.equal(card.endpoints.mcp.command, "across-context");
  assert.equal(card.protocols.mcp.transport, "stdio");
  assert.equal(card.protocols.mcp.resources, true);
  assert.equal(card.protocols.a2a.discoveryReady, true);
  assert.equal(card.governance.pendingApproval, true);
  assert.deepEqual(card.memory.types, ["preference", "decision", "note", "command", "session"]);
  assert.equal(card.vault.storage, "local-jsonl");
  assert.equal(card.vault.home, undefined);
  assert.doesNotMatch(JSON.stringify(card), new RegExp(escapeRegExp(home)));
  assert.ok(card.skills.some((skill) => skill.id === "shared-memory"));
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
