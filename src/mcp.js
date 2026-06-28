import { resolve } from "node:path";
import { exportContext, renderContextDocument } from "./exporters.js";
import { learnProject } from "./project.js";
import { renderAgentCard } from "./agent-card.js";
import { renderAgentLoopMemoryPolicy, renderAgentLoopMemoryPromptText } from "./loop-memory-policy.js";
import { contextPackSummary, loopHistory, loopMemoryDiff, recallLoopMemory, rememberLoopMemory } from "./autopilot-loop-memory.js";
import { recallEvidenceMemory, rememberEvidenceMemory } from "./evidence-memory.js";
import { recallAgentTeamReceipts, rememberAgentTeamReceipt } from "./agent-team-receipts.js";

export function createContextMcpServerDefinition(vault) {
  return {
    name: "across-context",
    version: "0.8.7",
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
      },
      {
        uri: "across-context://agent-loop-memory-metrics",
        name: "Agent Loop Memory Metrics",
        description: "Aggregate lifecycle metrics for structured Agent Loop memory candidates.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://context-packs",
        name: "Context Packs",
        description: "Grouped Memory OS style context packs, including optional generic agent plugin tags.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://evidence-memory-policy",
        name: "Evidence Memory Policy",
        description: "Compact evidence graph memory policy for cross-agent E2E traces.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://agent-team-receipts",
        name: "Agent Team Trust Receipts",
        description: "Pending trust receipts for workflow adoption and promotion reviews.",
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
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired"] },
            agentPluginId: { type: "string" },
            agent_plugin_id: { type: "string" },
            agentScope: { type: "string", enum: ["prefer", "only", "fallback"], default: "prefer" },
            agent_scope: { type: "string", enum: ["prefer", "only", "fallback"], default: "prefer" }
          },
          required: ["query"]
        },
        handler: async (args) => {
          const agentPluginId = args.agentPluginId || args.agent_plugin_id;
          const requestedLimit = args.limit || 10;
          const results = await vault.search({
            query: args.query,
            projectRoot: args.projectRoot,
            limit: agentPluginId ? Math.max(requestedLimit * 4, 20) : requestedLimit,
            mode: args.mode || "hybrid",
            status: args.status,
            includeGlobal: true
          });
          const scopedResults = prioritizeAgentPluginResults(results, {
            agentPluginId,
            agentScope: args.agentScope || args.agent_scope || "prefer",
            limit: requestedLimit
          });
          return textResult(
            scopedResults.map((result) => `- ${result.entry.text}`).join("\n") || "No matching context found.",
            { results: scopedResults }
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
            includeProjects: !args.projectRoot,
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
        name: "get_agent_loop_memory_metrics",
        description: "Return aggregate Agent Loop memory candidate lifecycle metrics without raw memory text.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false }
          }
        },
        handler: async (args) => {
          const metrics = await vault.agentLoopMemoryMetrics({
            projectRoot: args.projectRoot,
            includeProjects: Boolean(args.includeProjects)
          });
          return textResult(JSON.stringify(metrics, null, 2), { metrics });
        }
      },
      {
        name: "get_context_packs",
        description: "Summarize memories into Context Pack / Memory OS groups for generic agent plugin loading.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: true },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired"] },
            agentPluginId: { type: "string" },
            agent_plugin_id: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await contextPackSummary(vault, {
            projectRoot: args.projectRoot,
            includeProjects: args.includeProjects !== false,
            status: args.status,
            agentPluginId: args.agentPluginId || args.agent_plugin_id
          });
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "remember_loop_memory",
        description: "Store a pending Loop Engineering memory summary with policy enforcement.",
        inputSchema: {
          type: "object",
          properties: {
            specId: { type: "string" },
            runId: { type: "string" },
            text: { type: "string" },
            summary: { type: "object" },
            agentPluginId: { type: "string" },
            agent_plugin_id: { type: "string" }
          },
          required: ["specId", "runId", "text"]
        },
        handler: async (args) => {
          const result = await rememberLoopMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "recall_loop_memory",
        description: "Recall prior loop memories by spec id or run id.",
        inputSchema: {
          type: "object",
          properties: {
            specId: { type: "string" },
            runId: { type: "string" },
            limit: { type: "number", default: 10 },
            status: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await recallLoopMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "remember_evidence_memory",
        description: "Store a compact across-evidence-graph/1.0 memory candidate as pending review.",
        inputSchema: {
          type: "object",
          properties: {
            graph: { type: "object" },
            evidence_graph: { type: "object" },
            specId: { type: "string" },
            runId: { type: "string" },
            summary: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await rememberEvidenceMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "recall_evidence_memory",
        description: "Recall compact evidence graph memories by spec id or run id.",
        inputSchema: {
          type: "object",
          properties: {
            specId: { type: "string" },
            runId: { type: "string" },
            limit: { type: "number", default: 10 },
            status: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await recallEvidenceMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "remember_agent_team_receipt",
        description: "Store an agent-team trust receipt as pending memory for later adoption or promotion review.",
        inputSchema: {
          type: "object",
          properties: {
            packId: { type: "string" },
            pack_id: { type: "string" },
            receipt: { type: "object" },
            trust_receipt: { type: "object" },
            product_card: { type: "object" },
            protocol_readiness: { type: "object" }
          }
        },
        handler: async (args) => {
          const result = await rememberAgentTeamReceipt(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "recall_agent_team_receipts",
        description: "Recall pending or active agent-team trust receipts by workflow pack id.",
        inputSchema: {
          type: "object",
          properties: {
            packId: { type: "string" },
            pack_id: { type: "string" },
            limit: { type: "number", default: 10 },
            status: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await recallAgentTeamReceipts(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "get_loop_history",
        description: "Summarize loop memory history by spec.",
        inputSchema: {
          type: "object",
          properties: {
            specId: { type: "string" },
            limit: { type: "number", default: 50 }
          }
        },
        handler: async (args) => {
          const result = await loopHistory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "diff_loop_memory",
        description: "Compare loop memory between two runs.",
        inputSchema: {
          type: "object",
          properties: {
            runIdA: { type: "string" },
            runIdB: { type: "string" }
          },
          required: ["runIdA", "runIdB"]
        },
        handler: async (args) => {
          const result = await loopMemoryDiff(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
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
  if (uri === "across-context://agent-loop-memory-metrics") {
    const metrics = await vault.agentLoopMemoryMetrics({
      projectRoot: args.projectRoot,
      includeProjects: Boolean(args.includeProjects)
    });
    return resourceResult(uri, "application/json", JSON.stringify(metrics, null, 2));
  }
  if (uri === "across-context://context-packs") {
    const summary = await contextPackSummary(vault, {
      projectRoot: args.projectRoot,
      includeProjects: args.includeProjects !== false,
      status: args.status,
      agentPluginId: args.agentPluginId || args.agent_plugin_id
    });
    return resourceResult(uri, "application/json", JSON.stringify(summary, null, 2));
  }
  if (uri === "across-context://evidence-memory-policy") {
    return resourceResult(uri, "application/json", JSON.stringify({
      schema_version: "across-evidence-memory-policy/1.0",
      provider: "across-context",
      write_status: "pending",
      graph_schema: "across-evidence-graph/1.0",
      stored_fields: ["id", "type", "status", "hash", "from", "to", "relation", "summary"],
      raw_payloads_persisted: false,
      rejects_secrets: true
    }, null, 2));
  }
  if (uri === "across-context://agent-team-receipts") {
    const result = await recallAgentTeamReceipts(vault, {
      packId: args.packId || args.pack_id,
      limit: args.limit,
      status: args.status
    });
    return resourceResult(uri, "application/json", JSON.stringify(result, null, 2));
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

function prioritizeAgentPluginResults(results, { agentPluginId, agentScope = "prefer", limit = 10 } = {}) {
  if (!agentPluginId) return results.slice(0, limit);
  const scoped = [];
  const fallback = [];
  for (const result of results) {
    const pluginIds = resultAgentPluginIds(result);
    const matched = pluginIds.includes(agentPluginId);
    const annotated = {
      ...result,
      score: matched ? Math.round((Number(result.score || 0) + 100) * 1000) / 1000 : result.score,
      explanation: {
        ...(result.explanation || {}),
        agentPluginScope: matched ? "matched" : "fallback_global",
        filteredAgentPluginId: agentPluginId
      }
    };
    if (matched) scoped.push(annotated);
    else fallback.push(annotated);
  }
  if (agentScope === "only") return scoped.slice(0, limit);
  if (agentScope === "fallback") return [...scoped, ...fallback].slice(0, limit);
  return (scoped.length ? [...scoped, ...fallback] : fallback).slice(0, limit);
}

function resultAgentPluginIds(result) {
  const tags = result?.entry?.tags || [];
  return [...new Set(tags
    .map((tag) => String(tag || ""))
    .filter((tag) => tag.startsWith("agent-plugin:"))
    .map((tag) => tag.slice("agent-plugin:".length))
    .filter(Boolean))];
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
