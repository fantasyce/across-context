export async function renderAgentCard(vault) {
  return {
    name: "Across Context",
    version: "0.2.0",
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
