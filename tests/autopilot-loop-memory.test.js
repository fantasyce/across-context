import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextVault } from "../src/vault.js";
import { createContextMcpServerDefinition } from "../src/mcp.js";
import { loopHistory, recallLoopMemory, rememberLoopMemory } from "../src/autopilot-loop-memory.js";

test("loop memory recall distinguishes accepted and redacted pending memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-loop-"));
  const vault = new ContextVault({ home });

  const accepted = await rememberLoopMemory(vault, {
    specId: "daily-news-brief",
    runId: "run-1",
    text: "safe summary",
    summary: {
      model_decision: {
        provider: "minimax",
        model: "MiniMax-M3",
        decision_hash: "abc123",
        patch_count: 1
      }
    }
  });
  const privatePath = ["", "Users", "example", "Documents", "projects", "private"].join("/");
  const privatePathPrefix = ["", "Users", "example", "Documents"].join("/");
  const redacted = await rememberLoopMemory(vault, {
    specId: "daily-news-brief",
    runId: "run-2",
    text: `path ${privatePath}`
  });
  const recalled = await recallLoopMemory(vault, { specId: "daily-news-brief" });
  const history = await loopHistory(vault);

  assert.equal(accepted.status, "accepted_pending");
  assert.equal(redacted.status, "redacted_pending");
  assert.equal(recalled.result_count, 2);
  assert.equal(recalled.results.find((item) => item.run_id === "run-1").summary.model_decision.provider, "minimax");
  assert.equal(history.specs[0].redacted_count, 1);
  assert.equal(JSON.stringify(recalled).includes(privatePathPrefix), false);
});

test("MCP exposes loop memory tools without duplicate writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-loop-"));
  const vault = new ContextVault({ home });
  const server = createContextMcpServerDefinition(vault);
  const tool = server.tools.find((item) => item.name === "remember_loop_memory");

  const response = await tool.handler({
    specId: "github-plugin-radar",
    runId: "run-1",
    text: "plugin radar summary"
  });
  const recalled = await recallLoopMemory(vault, { specId: "github-plugin-radar" });

  assert.match(response.content[0].text, /accepted_pending/);
  assert.equal(recalled.result_count, 1);
});
