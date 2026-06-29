import { renderAgentLoopMemoryPolicy } from "./loop-memory-policy.js";
import { resolveMemoryBackend } from "./memory-backend.js";

export async function renderAgentCard(vault) {
  const loopMemoryPolicy = renderAgentLoopMemoryPolicy();
  const memoryBackend = resolveMemoryBackend({ env: vault?.env || process.env });
  return {
    name: "Across Context",
    version: "0.8.8",
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
      agentTeamTrustReceiptsA2AV2: true,
      skillsBridge: true,
      codexSkillsAutoDiscovery: true,
      memoryBackendSwitch: true,
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
        complementsMcp: true,
        trustReceiptSchema: "across-agent-team-trust-receipt/1.0",
        delegationSchema: "across-a2a-task-delegation/2.0"
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
      supportedBackends: ["vault", "mem0", "graphrag"],
      activeBackend: memoryBackend.backend,
      reviewModes: ["global", "project", "all-projects"],
      explanations: true
    },
    vault: {
      storage: "local-jsonl",
      scope: "user-controlled",
      backend: memoryBackend
    },
    skill_bridge: {
      export_schema: "agentskills.io-export/1.0",
      import_schema: "across-context-skill-memory-import/1.0",
      default_discovery_roots: ["~/.codex/skills", "~/.claude/skills", "~/.qwen/skills"],
      raw_skill_bodies_included: false,
      secrets_included: false
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
      },
      {
        id: "skills-bridge",
        name: "Skills Bridge",
        description: "Export Across Context skills and import local agent skill directories as pending redacted summaries."
      }
    ]
  };
}
