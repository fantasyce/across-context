import { resolve } from "node:path";
import { exportContext, renderContextDocument } from "./exporters.js";
import { learnProject } from "./project.js";

export function createContextMcpServerDefinition(vault) {
  return {
    name: "across-context",
    version: "0.1.0",
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
            tags: { type: "array", items: { type: "string" } }
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
            source: "mcp"
          });
          return textResult(`Remembered ${entry.scope} ${entry.type}: ${entry.text}`);
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
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        },
        handler: async (args) => {
          const results = await vault.search({
            query: args.query,
            projectRoot: args.projectRoot,
            limit: args.limit || 10,
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
