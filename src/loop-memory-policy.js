export function renderAgentLoopMemoryPolicy() {
  return {
    schemaVersion: "0.1",
    provider: "across-context",
    defaultReadStatus: "active",
    defaultWriteStatus: "pending",
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
    `Default write status: ${policy.defaultWriteStatus}.`,
    "Do not persist secrets, full transcripts, large logs, screenshots, or one-off observations.",
    "Treat memory writes as candidates until a human or host policy approves them."
  ].join("\n");
}
