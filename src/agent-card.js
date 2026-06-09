export async function renderAgentCard(vault) {
  return {
    name: "Across Context",
    version: "0.4.1",
    description: "Local-first shared memory provider for coding agents.",
    url: "https://github.com/fantasyce/across-context",
    capabilities: {
      memory: true,
      semanticSearch: true,
      pendingApproval: true,
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
      localFirst: true,
      rejectsSecrets: true,
      teamVisibility: true
    },
    memory: {
      storage: "local-jsonl",
      types: ["preference", "decision", "note", "command", "session"],
      scopes: ["global", "project"],
      retrievalModes: ["keyword", "semantic", "hybrid"],
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
