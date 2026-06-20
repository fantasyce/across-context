import { renderAgentLoopMemoryPolicy } from "./loop-memory-policy.js";
import { renderAutopilotMemoryPolicy } from "./autopilot-memory-policy.js";

export async function renderAgentCard(vault) {
  const loopMemoryPolicy = renderAgentLoopMemoryPolicy();
  return {
    name: "Across Context",
    version: "0.7.8",
    description: "Local-first shared memory provider for coding agents.",
    url: "https://github.com/fantasyce/across-context",
    capabilities: {
      memory: true,
      semanticSearch: true,
      pendingApproval: true,
      agentLoopMemoryHooks: true,
      agentLoopMemoryHooksV2: true,
      allProjectPendingReview: true,
      autopilotMemoryPolicy: true,
      teamExport: true,
      localFirst: true
    },
    endpoints: {
      mcp: {
        transport: "stdio",
        command: "across-context",
        args: ["mcp"]
      },
      dashboard: {
        command: "across-context",
        args: ["dashboard"]
      }
    },
    protocols: {
      mcp: {
        transport: "stdio",
        command: "across-context",
        args: ["mcp"],
        tools: true,
        resources: true,
        prompts: true
      },
      a2a: {
        discoveryReady: true,
        role: "memory-context-provider",
        complementsMcp: true
      }
    },
    governance: {
      pendingApproval: true,
      lifecycle: ["pending", "active", "pinned", "archived", "expired"],
      allProjectPendingReview: true,
      localFirst: true,
      rejectsSecrets: true,
      teamVisibility: true,
      loopMemoryPolicy,
      autopilotMemoryPolicy: renderAutopilotMemoryPolicy()
    },
    memory: {
      storage: "local-jsonl",
      types: ["preference", "decision", "note", "command", "session"],
      scopes: ["global", "project"],
      retrievalModes: ["keyword", "semantic", "hybrid"],
      loopHooks: loopMemoryPolicy.hooks.map((hook) => hook.id),
      reviewModes: ["global", "project", "all-projects"],
      explanations: true
    },
    vault: {
      storage: "local-jsonl",
      scope: "user-controlled"
    },
    skills: [
      {
        id: "shared-memory",
        name: "Shared Memory",
        description: "Search and write durable local context across coding agents."
      },
      {
        id: "agent-loop-memory-hooks",
        name: "Agent Loop Memory Hooks",
        description: "Provide pre-loop search, step context attachment, and post-loop pending summary policy."
      },
      {
        id: "memory-review",
        name: "Memory Review",
        description: "Review pending automatic memories before activating them."
      },
      {
        id: "autopilot-memory-policy",
        name: "Autopilot Memory Policy",
        description: "Store compact Across Autopilot review and promotion summaries as pending memory."
      },
      {
        id: "team-context",
        name: "Team Context",
        description: "Export team-safe project memories without private local paths."
      }
    ]
  };
}
