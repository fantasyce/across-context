import { resolve } from "node:path";
import { exportContext, renderContextDocument } from "./exporters.js";
import { learnProject } from "./project.js";
import { renderAgentCard } from "./agent-card.js";

export function createContextMcpServerDefinition(vault) {
  return {
    name: "across-context",
    version: "0.2.0",
    tools: [
      {
        name: "remember_context",
        description: "Store a user preference, project decision, command, note, or session summary in the local Across Context vault.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            scope: { type: "string", enum: ["global", "project"], default: "global" },
            type: { type: "string", enum: ["preference", "decision", "note", "command", "session"], default: "note" },
            projectRoot: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            auto: { type: "boolean", default: true },
            visibility: { type: "string", enum: ["private", "team"], default: "private" }
          },
          required: ["text"]
        },
        handler: async (args) => {
          const entry = await vault.remember({
            text: args.text,
            scope: args.scope || "global",
            type: args.type || "note",
            projectRoot: args.projectRoot,
            tags: args.tags || [],
            auto: args.auto !== false,
            visibility: args.visibility,
            source: "mcp"
          });
          return textResult(`Remembered ${entry.status} ${entry.scope} ${entry.type}: ${entry.text}`);
        }
      },
      {
        name: "search_context",
        description: "Search global and project memory for relevant context.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            projectRoot: { type: "string" },
            limit: { type: "number", default: 10 },
            mode: { type: "string", enum: ["keyword", "semantic", "hybrid"], default: "hybrid" },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired"] }
          },
          required: ["query"]
        },
        handler: async (args) => {
          const results = await vault.search({
            query: args.query,
            projectRoot: args.projectRoot,
            limit: args.limit || 10,
            mode: args.mode || "hybrid",
            status: args.status,
            includeGlobal: true
          });
          return textResult(results.map((result) => `- ${result.entry.text}`).join("\n") || "No matching context found.");
        }
      },
      {
        name: "get_project_context",
        description: "Return an AGENTS.md style context document for the current project.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" }
          },
          required: ["projectRoot"]
        },
        handler: async (args) => {
          const projectRoot = resolve(args.projectRoot);
          const profile = await learnProject(projectRoot);
          await vault.saveProjectProfile(profile);
          const document = await renderContextDocument(vault, { projectRoot, target: "agents" });
          return textResult(document);
        }
      },
      {
        name: "review_pending_memories",
        description: "List automatic memory writes that are pending user review.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" }
          }
        },
        handler: async (args) => {
          const memories = await vault.listMemories({
            projectRoot: args.projectRoot,
            includeGlobal: true,
            status: "pending"
          });
          return textResult(memories.map((entry) => `- ${entry.id}: ${entry.text}`).join("\n") || "No pending memories.");
        }
      },
      {
        name: "approve_memory",
        description: "Approve a pending memory by id so agents can use it as active context.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" }
          },
          required: ["id"]
        },
        handler: async (args) => {
          const entry = await vault.updateStatus(args.id, "active");
          return textResult(`Approved ${entry.id}: ${entry.text}`);
        }
      },
      {
        name: "get_agent_card",
        description: "Return the Across Context agent card for A2A-style discovery.",
        inputSchema: {
          type: "object",
          properties: {}
        },
        handler: async () => textResult(JSON.stringify(await renderAgentCard(vault), null, 2))
      },
      {
        name: "export_agent_instructions",
        description: "Write AGENTS.md, CLAUDE.md, Cursor rules, or Markdown context exports for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            target: { type: "string", enum: ["agents", "claude", "cursor", "markdown"], default: "agents" }
          },
          required: ["projectRoot"]
        },
        handler: async (args) => {
          const result = await exportContext(vault, {
            projectRoot: args.projectRoot,
            target: args.target || "agents"
          });
          return textResult(`Exported ${result.target} context to ${result.path}`);
        }
      }
    ]
  };
}

export function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
