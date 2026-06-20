export function renderAutopilotMemoryPolicy() {
  return {
    schemaVersion: "0.1",
    provider: "across-context",
    defaultWriteStatus: "pending",
    adapterContract: {
      writeReviewSummary: {
        cli: "across-context remember <autopilot-review-summary-json> --scope global --type session --status pending --json",
        mcpTool: "remember_context",
        defaultStatus: "pending",
        structuredSummary: {
          schema: "across-autopilot-memory/1.0",
          fields: [
            "review_id",
            "generated_at",
            "source_count",
            "focus_areas",
            "candidate_backlog_ids",
            "risk_summary",
            "decision"
          ]
        }
      },
      writePromotionSummary: {
        cli: "across-context remember <promotion-report-summary-json> --scope global --type decision --status pending --json",
        mcpTool: "remember_context",
        defaultStatus: "pending",
        structuredSummary: {
          schema: "across-autopilot-promotion-memory/1.0",
          fields: [
            "candidate_id",
            "target_product",
            "target_version",
            "readiness",
            "required_missing",
            "failed_gates",
            "rollback_target"
          ]
        }
      }
    },
    allowedWrites: ["session", "decision", "note"],
    neverPersist: [
      "secrets",
      "credentials",
      "raw web pages",
      "raw transcripts",
      "large logs",
      "private screenshots",
      "signing assets",
      "local absolute source paths"
    ],
    lifecycle: {
      automaticWritesStartAs: "pending",
      activeMemoryRequiresReview: true,
      duplicatePolicy: "reuse_or_update_existing_memory"
    }
  };
}

export function renderAutopilotMemoryPromptText() {
  const policy = renderAutopilotMemoryPolicy();
  return [
    "Use Across Context as the memory provider for Across Autopilot.",
    "",
    "Autopilot may remember compact review summaries and promotion decisions as pending memory.",
    `Default write status: ${policy.defaultWriteStatus}.`,
    "Do not persist raw web pages, raw transcripts, secrets, credentials, signing assets, or local absolute source paths.",
    "Promotion memories should include candidate id, target product, readiness, missing gates, failed gates, and rollback target.",
    "Treat all automatic Autopilot writes as candidates until a human or host policy approves them."
  ].join("\n");
}

