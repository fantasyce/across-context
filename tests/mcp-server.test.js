import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const server = join(process.cwd(), "src", "mcp-server.js");

test("MCP stdio server lists and calls tools", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-mcp-stdio-"));
  const child = spawn("node", [server], {
    env: { ...process.env, ACROSS_CONTEXT_HOME: home },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const messages = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "remember_context",
      arguments: {
        text: "Use screenshots for UI tasks.",
        scope: "global",
        type: "preference"
      }
    }
  }) + "\n");

  await waitFor(() => messages.length >= 3);
  child.kill("SIGTERM");
  await once(child, "exit");

  assert.equal(messages[0].result.serverInfo.name, "across-context");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "remember_context"));
  assert.match(messages[2].result.content[0].text, /Use screenshots/);
});

async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) {
      throw new Error("Timed out waiting for MCP server response");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
