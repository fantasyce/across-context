export function renderAgentLoopMemoryPolicy() {
  return {
    schemaVersion: "0.2",
    provider: "across-context",
    defaultReadStatus: "active",
    defaultWriteStatus: "pending",
    adapterContract: {
      search: {
        cli: "across-context search <query> --project <path> --status active --json",
        mcpTool: "search_context",
        activeStatus: "active",
        includesGlobal: true
      },
      writeCandidate: {
        cli: "across-context remember <summary> --scope project --project <path> --status pending --json",
        mcpTool: "remember_context",
        defaultStatus: "pending",
        defaultType: "session"
      },
      review: {
        cli: "across-context pending --project <path> --json",
        allProjectsCli: "across-context pending --all-projects --json",
        approveCli: "across-context approve <memory-id> --json",
        mcpTools: ["review_pending_memories", "approve_memory"]
      }
    },
    hostLoopControls: {
      actions: ["cancel", "reject_action", "retry_step"],
      events: "read from the orchestrator loop event stream",
      ownership: "Across Context records memory candidates only; the orchestrator owns loop control state."
    },
    hooks: [
      {
        id: "pre_loop_search",
        phase: "context",
        action: "Search active global and project memory before planning each durable loop run."
      },
      {
        id: "step_context_attach",
        phase: "act",
        action: "Attach relevant memory ids and search explanations to loop steps instead of copying full memory text into every observation."
      },
      {
        id: "post_loop_pending_summary",
        phase: "remember",
        action: "Write only compact durable loop summaries as pending memory candidates after useful work is complete."
      }
    ],
    allowedWrites: ["preference", "decision", "command", "session", "note"],
    neverPersist: [
      "secrets",
      "credentials",
      "full transcripts",
      "large logs",
      "private screenshots",
      "temporary tool errors",
      "one-off observations"
    ],
    lifecycle: {
      automaticWritesStartAs: "pending",
      activeMemoryRequiresReview: true,
      duplicatePolicy: "reuse_or_update_existing_memory"
    }
  };
}

export function renderAgentLoopMemoryPromptText() {
  const policy = renderAgentLoopMemoryPolicy();
  const hooks = policy.hooks.map((hook) => `- ${hook.id}: ${hook.action}`).join("\n");
  return [
    "Use Across Context as the memory provider for durable agent loop runs.",
    "",
    "Agent loop memory lifecycle:",
    "Pre-loop search, step context attach, and post-loop pending summary are the only default hooks.",
    hooks,
    "",
    `Host loop controls: ${policy.hostLoopControls.actions.join(", ")}.`,
    `Default write status: ${policy.defaultWriteStatus}.`,
    "Do not persist secrets, full transcripts, large logs, screenshots, or one-off observations.",
    "Treat memory writes as candidates until a human or host policy approves them."
  ].join("\n");
}
