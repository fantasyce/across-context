import { resolve } from "node:path";
import { exportContext, renderContextDocument } from "./exporters.js";
import { learnProject } from "./project.js";
import { renderAgentCard } from "./agent-card.js";
import { renderAgentLoopMemoryPolicy, renderAgentLoopMemoryPromptText } from "./loop-memory-policy.js";

export function createContextMcpServerDefinition(vault) {
  return {
    name: "across-context",
    version: "0.6.1",
    resources: [
      {
        uri: "across-context://agent-card",
        name: "Agent Card",
        description: "A2A-style public metadata for Across Context.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://stats",
        name: "Vault Stats",
        description: "Counts and lifecycle summary for local memory.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memories",
        name: "Memories",
        description: "Global and project memories visible to the current request.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://project-context",
        name: "Project Context",
        description: "Generated AGENTS.md-style project context.",
        mimeType: "text/markdown"
      },
      {
        uri: "across-context://agent-loop-memory-policy",
        name: "Agent Loop Memory Policy",
        description: "Memory hook policy for durable agent loop runtimes.",
        mimeType: "application/json"
      }
    ],
    prompts: [
      {
        name: "task-start-context",
        description: "Retrieve relevant Across Context memory before planning or editing.",
        arguments: [
          { name: "query", description: "Task or topic to search for.", required: false },
          { name: "projectRoot", description: "Project root for project memory.", required: false }
        ]
      },
      {
        name: "task-end-summary",
        description: "Store a compact pending session summary after durable work.",
        arguments: [
          { name: "summary", description: "Compact handoff summary.", required: true },
          { name: "projectRoot", description: "Project root for project memory.", required: false }
        ]
      },
      {
        name: "memory-review",
        description: "Review pending automatic memories before activating them.",
        arguments: [
          { name: "projectRoot", description: "Project root for pending project memory.", required: false }
        ]
      },
      {
        name: "agent-loop-memory-policy",
        description: "Explain how agent loops should read, attach, and write Across Context memory.",
        arguments: []
      }
    ],
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
          return textResult(
            results.map((result) => `- ${result.entry.text}`).join("\n") || "No matching context found.",
            { results }
          );
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
        name: "get_agent_loop_memory_policy",
        description: "Return the Across Context memory lifecycle policy for durable agent loop runtimes.",
        inputSchema: {
          type: "object",
          properties: {}
        },
        handler: async () => textResult(
          JSON.stringify(renderAgentLoopMemoryPolicy(), null, 2),
          { policy: renderAgentLoopMemoryPolicy() }
        )
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
    ],
    readResource: async (uri, args = {}) => readResource(vault, uri, args),
    getPrompt: async (name, args = {}) => getPrompt(vault, name, args)
  };
}

async function readResource(vault, uri, args = {}) {
  if (uri === "across-context://agent-card") {
    return resourceResult(uri, "application/json", JSON.stringify(await renderAgentCard(vault), null, 2));
  }
  if (uri === "across-context://stats") {
    const stats = await vault.stats({ projectRoot: args.projectRoot });
    return resourceResult(uri, "application/json", JSON.stringify(stats, null, 2));
  }
  if (uri === "across-context://memories") {
    const memories = await vault.listMemories({
      projectRoot: args.projectRoot,
      includeGlobal: true,
      status: args.status,
      visibility: args.visibility
    });
    return resourceResult(uri, "application/json", JSON.stringify({ memories }, null, 2));
  }
  if (uri === "across-context://project-context") {
    const projectRoot = resolve(args.projectRoot || process.cwd());
    const document = await renderContextDocument(vault, { projectRoot, target: "agents" });
    return resourceResult(uri, "text/markdown", document);
  }
  if (uri === "across-context://agent-loop-memory-policy") {
    return resourceResult(uri, "application/json", JSON.stringify(renderAgentLoopMemoryPolicy(), null, 2));
  }
  throw new Error(`Unknown resource: ${uri}`);
}

async function getPrompt(vault, name, args = {}) {
  if (name === "task-start-context") {
    const query = args.query || "project context";
    return promptResult(
      name,
      "Search Across Context before planning or editing.",
      `Search Across Context for relevant active memory using query "${query}". Prefer hybrid search, include global and project memory when projectRoot is available, and use the results before making architecture, dependency, testing, release, or documentation decisions.`
    );
  }
  if (name === "task-end-summary") {
    const summary = args.summary || "<compact durable session summary>";
    return promptResult(
      name,
      "Store a compact pending session summary.",
      `Remember this session summary through Across Context as a project session memory when projectRoot is available, otherwise as global memory. Keep it compact and pending for review: ${summary}`
    );
  }
  if (name === "memory-review") {
    const memories = await vault.listMemories({
      projectRoot: args.projectRoot,
      includeGlobal: true,
      status: "pending"
    });
    const pending = memories.map((entry) => `- ${entry.id}: ${entry.text}`).join("\n") || "No pending memories.";
    return promptResult(
      name,
      "Review pending memories.",
      `Review pending memories and approve only durable, non-secret context.\n\n${pending}`
    );
  }
  if (name === "agent-loop-memory-policy") {
    return promptResult(
      name,
      "Apply Across Context memory hooks to an agent loop.",
      renderAgentLoopMemoryPromptText()
    );
  }
  throw new Error(`Unknown prompt: ${name}`);
}

function resourceResult(uri, mimeType, text) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text
      }
    ]
  };
}

function promptResult(name, description, text) {
  return {
    description,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text
        }
      }
    ],
    name
  };
}

export function textResult(text, structuredContent) {
  const result = {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
  if (structuredContent) {
    result.structuredContent = structuredContent;
  }
  return result;
}
