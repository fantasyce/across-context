import { renderAgentLoopMemoryPolicy } from "./loop-memory-policy.js";

export async function renderAgentCard(vault) {
  const loopMemoryPolicy = renderAgentLoopMemoryPolicy();
  return {
    name: "Across Context",
    version: "0.8.6",
    description: "Local-first shared memory provider for coding agents.",
    url: "https://github.com/fantasyce/across-context",
    capabilities: {
      memory: true,
      semanticSearch: true,
      pendingApproval: true,
      agentLoopMemoryHooks: true,
      agentLoopMemoryHooksV2: true,
      evidenceGraphMemory: true,
      agentTeamTrustReceipts: true,
      allProjectPendingReview: true,
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
      loopMemoryPolicy
    },
    memory: {
      storage: "local-jsonl",
      types: ["preference", "decision", "note", "command", "session"],
      scopes: ["global", "project"],
      retrievalModes: ["keyword", "semantic", "hybrid"],
      loopHooks: loopMemoryPolicy.hooks.map((hook) => hook.id),
      evidenceGraphSchema: "across-evidence-graph/1.0",
      agentTeamReceiptSchema: "across-agent-team-receipt-memory/1.0",
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
        id: "evidence-graph-memory",
        name: "Evidence Graph Memory",
        description: "Store compact cross-agent evidence graphs as pending memory without raw tool payloads."
      },
      {
        id: "agent-team-trust-receipts",
        name: "Agent Team Trust Receipts",
        description: "Store workflow adoption and promotion receipts as pending team-visible memory."
      },
      {
        id: "memory-review",
        name: "Memory Review",
        description: "Review pending automatic memories before activating them."
      },
      {
        id: "team-context",
        name: "Team Context",
        description: "Export team-safe project memories without private local paths."
      }
    ]
  };
}
