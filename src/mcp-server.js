#!/usr/bin/env node
import { createInterface } from "node:readline";
import { ContextVault } from "./vault.js";
import { createContextMcpServerDefinition } from "./mcp.js";

if (process.argv.includes("--help")) {
  console.log("Usage: across-context mcp\n\nStarts the Across Context MCP stdio server.");
  process.exit(0);
}

const vault = new ContextVault();
const definition = createContextMcpServerDefinition(vault);

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const result = await handleMessage(message);
    if (message.id !== undefined) {
      writeJson({ jsonrpc: "2.0", id: message.id, result });
    }
  } catch (error) {
    writeJson({
      jsonrpc: "2.0",
      id: message?.id ?? null,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

async function handleMessage(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: definition.name,
        version: definition.version
      }
    };
  }
  if (message.method === "tools/list") {
    return {
      tools: definition.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }))
    };
  }
  if (message.method === "tools/call") {
    const tool = definition.tools.find((item) => item.name === message.params?.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${message.params?.name}`);
    }
    return tool.handler(message.params?.arguments || {});
  }
  if (message.method === "notifications/initialized") {
    return {};
  }
  throw new Error(`Unsupported method: ${message.method}`);
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
