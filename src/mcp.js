import { resolve } from "node:path";
import { exportContext, renderContextDocument } from "./exporters.js";
import { learnProject } from "./project.js";
import { renderAgentCard } from "./agent-card.js";
import { renderAgentLoopMemoryPolicy, renderAgentLoopMemoryPromptText } from "./loop-memory-policy.js";
import { resolveMemoryBackend } from "./memory-backend.js";
import { ACTIVE_MEMORY_STATUSES } from "./vault.js";
import { contextPackSummary, loopHistory, loopMemoryDiff, recallLoopMemory, rememberLoopMemory } from "./autopilot-loop-memory.js";
import { recallEvidenceMemory, rememberEvidenceMemory } from "./evidence-memory.js";
import { recallAgentTeamReceipts, rememberAgentTeamReceipt } from "./agent-team-receipts.js";
import { importSkillDirectories, renderSkillExport } from "./skill-export.js";
import { retrieveAndMergeMemory, retrieveMemory, RETRIEVAL_ROUTE_DEFINITIONS } from "./memory-retrieval.js";
import { MEMORY_SCHEMA_DEFINITIONS, schemaAwareSummary } from "./memory-schema.js";
import { forgetProjectedMemory, inspectMemoryProjection, rebuildMemoryProjection } from "./memory-projection.js";
import { runRetrievalEvaluation } from "./retrieval-eval.js";
import { approveGovernedMemory, improveMemory, rollbackDistilledMemory } from "./memory-distillation.js";
import { mergeWorkerExperiences, recallableWorkerMemories, rememberWorkerOutcome, revokeWorkerMemories } from "./worker-memory.js";

export function createContextMcpServerDefinition(vault) {
  return {
    name: "across-context",
    version: "0.11.1",
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
        description: "Approved trust receipts by default; pending receipts require an explicit review request.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://skill-export",
        name: "Skills Bridge Export",
        description: "agentskills.io export files for Across Context native skills.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memory-backend",
        name: "Memory Backend Contract",
        description: "Local vault, Mem0, and GraphRAG backend switch contract with redacted-summary policy.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memory-schemas",
        name: "Memory Schema Classification",
        description: "Derived schema definitions and active-memory classification summary without JSONL migration.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://retrieval-routes",
        name: "Memory Retrieval Routes",
        description: "Explicit local deterministic retrieval route contracts.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memory-projection",
        name: "Memory Projection",
        description: "Optional graph/hash-vector projection status and privacy policy; JSONL remains authoritative.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memory-distillation-policy",
        name: "Memory Distillation Policy",
        description: "Governed local improve workflow, provenance, approval, rollback, and forgetting contract.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://memory-trust-summary",
        name: "Memory Trust Summary",
        description: "Compact provenance, quarantine, and freshness summary without raw memory text or source identifiers.",
        mimeType: "application/json"
      },
      {
        uri: "across-context://worker-experience",
        name: "Approved Worker Experience",
        description: "Approved, unexpired, redacted Worker outcomes grouped by node.",
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
            visibility: { type: "string", enum: ["private", "team"], default: "private" },
            source_type: { type: "string" },
            source_id: { type: "string" },
            trust_level: { type: "string", enum: ["trusted", "review", "untrusted"] },
            evidence_hash: { type: "string" },
            observed_at: { type: "string" },
            expires_at: { type: "string" }
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
            source: "mcp",
            source_type: args.source_type,
            source_id: args.source_id,
            trust_level: args.trust_level,
            evidence_hash: args.evidence_hash,
            observed_at: args.observed_at,
            expires_at: args.expires_at
          });
          return textResult(`Remembered ${entry.status} ${entry.scope} ${entry.type}: ${entry.text}`, { memory: entry });
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
            status: {
              type: "string",
              enum: ["pending", "active", "pinned", "archived", "expired", "quarantined"],
              description: "Omit for active and pinned memory only; pass pending explicitly for review."
            },
            reviewPending: {
              type: "boolean",
              default: false,
              description: "Must be true when status is pending."
            },
            reviewQuarantined: { type: "boolean", default: false },
            agentPluginId: { type: "string" },
            agent_plugin_id: { type: "string" },
            agentScope: { type: "string", enum: ["prefer", "only", "fallback"], default: "prefer" },
            agent_scope: { type: "string", enum: ["prefer", "only", "fallback"], default: "prefer" }
          },
          required: ["query"]
        },
        handler: async (args) => {
          if (args.status === "pending" && args.reviewPending !== true) {
            throw new Error("Pending search requires reviewPending=true; use review_pending_memories for the review queue.");
          }
          if (args.status === "quarantined" && args.reviewQuarantined !== true) {
            throw new Error("Quarantined search requires reviewQuarantined=true; use review_quarantined_memories for the review queue.");
          }
          const agentPluginId = args.agentPluginId || args.agent_plugin_id;
          const requestedLimit = args.limit || 10;
          const results = await vault.search({
            query: args.query,
            projectRoot: args.projectRoot,
            limit: agentPluginId ? Math.max(requestedLimit * 4, 20) : requestedLimit,
            mode: args.mode || "hybrid",
            status: args.status,
            reviewQuarantined: args.reviewQuarantined,
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
        name: "retrieve_context",
        description: "Use an explicit deterministic memory route. Normal retrieval reads active and pinned memory only; pending requires reviewPending=true.",
        inputSchema: {
          type: "object",
          properties: {
            route: { type: "string", enum: [...RETRIEVAL_ROUTE_DEFINITIONS.map((route) => route.id), "semantic_keyword"] },
            query: { type: "string" },
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false },
            limit: { type: "number", default: 10 },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired", "quarantined"] },
            reviewPending: { type: "boolean", default: false },
            reviewQuarantined: { type: "boolean", default: false }
          },
          required: ["route"]
        },
        handler: async (args) => {
          const result = await retrieveMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "retrieve_context_merged",
        description: "Run independent keyword, embedding, evidence graph, project profile, and loop routes, then merge them with explainable weighted reciprocal-rank fusion.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            routes: { type: "array", items: { type: "string", enum: RETRIEVAL_ROUTE_DEFINITIONS.map((route) => route.id) } },
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false },
            limit: { type: "number", default: 10 },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired", "quarantined"] },
            reviewPending: { type: "boolean", default: false },
            reviewQuarantined: { type: "boolean", default: false },
            includeRouteResults: { type: "boolean", default: false }
          },
          required: ["query"]
        },
        handler: async (args) => {
          const result = await retrieveAndMergeMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "improve_memory",
        description: "Deduplicate, cluster, merge, and compress session and pending candidates into governed pending permanent-memory proposals.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false },
            sourceIds: { type: "array", items: { type: "string" } },
            similarityThreshold: { type: "number", default: 0.34 },
            maxProposalLength: { type: "number", default: 420 }
          }
        },
        handler: async (args) => {
          const result = await improveMemory(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "rollback_distilled_memory",
        description: "Archive a distilled memory and restore its source lifecycle states from provenance.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        handler: async (args) => {
          const result = await rollbackDistilledMemory(vault, args.id);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "get_memory_schema_summary",
        description: "Classify active and pinned vault records into the Across Context memory schemas without changing JSONL.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false }
          }
        },
        handler: async (args) => {
          const memories = await vault.listMemories({
            projectRoot: args.projectRoot,
            includeGlobal: true,
            includeProjects: Boolean(args.includeProjects),
            statuses: ACTIVE_MEMORY_STATUSES
          });
          const result = schemaAwareSummary(memories);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "rebuild_memory_projection",
        description: "Rebuild optional local graph and deterministic hash-vector projections from active/pinned JSONL memory.",
        inputSchema: {
          type: "object",
          properties: {
            graph: { type: "boolean", default: true },
            vector: { type: "boolean", default: true },
            dimensions: { type: "number", default: 48 }
          }
        },
        handler: async (args) => {
          const result = await rebuildMemoryProjection(vault, args);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "inspect_memory_projection",
        description: "Inspect optional projection status, counts, source digest, and privacy policy.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          const result = await inspectMemoryProjection(vault);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "forget_projected_memory",
        description: "Forget a memory in the authoritative JSONL vault and propagate deletion to derived projections.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        handler: async (args) => {
          const result = await forgetProjectedMemory(vault, args.id);
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "run_retrieval_evaluation",
        description: "Run the bundled deterministic local retrieval evaluation fixtures.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          const result = await runRetrievalEvaluation();
          return textResult(JSON.stringify(result, null, 2), { result });
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
        name: "review_quarantined_memories",
        description: "List quarantined memory for human review. Quarantined records never enter normal retrieval.",
        inputSchema: {
          type: "object",
          properties: { projectRoot: { type: "string" } }
        },
        handler: async (args) => {
          const memories = await vault.listMemories({
            projectRoot: args.projectRoot,
            includeGlobal: true,
            includeProjects: !args.projectRoot,
            status: "quarantined"
          });
          return textResult(JSON.stringify({ memories }, null, 2), { memories });
        }
      },
      {
        name: "get_memory_trust_summary",
        description: "Return compact provenance, trust, quarantine, and freshness counts without raw memory text or source identifiers.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            includeProjects: { type: "boolean", default: false }
          }
        },
        handler: async (args) => {
          const result = await vault.trustSummary({ projectRoot: args.projectRoot, includeProjects: Boolean(args.includeProjects) });
          return textResult(JSON.stringify(result, null, 2), { result });
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
          const result = await approveGovernedMemory(vault, args.id);
          const entry = result.proposal_id ? { id: result.proposal_id, text: "distilled memory proposal" } : result;
          return textResult(`Approved ${entry.id}: ${entry.text}`, { result });
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
        name: "export_skills",
        description: "Export Across Context native skills as agentskills.io files without raw memory.",
        inputSchema: {
          type: "object",
          properties: {
            outputDir: { type: "string" },
            output_dir: { type: "string" }
          }
        },
        handler: async (args) => {
          const result = await renderSkillExport(vault, { outputDir: args.outputDir || args.output_dir });
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "import_skill_memory",
        description: "Import local Codex, Claude Code, or Qwen Code skill directories as redacted pending memory summaries.",
        inputSchema: {
          type: "object",
          properties: {
            root: { type: "string" },
            roots: { type: "array", items: { type: "string" } }
          }
        },
        handler: async (args) => {
          const result = await importSkillDirectories(vault, { roots: args.roots || args.root });
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "get_memory_backend",
        description: "Return the active memory backend contract. Mem0 and GraphRAG are optional projection backends; vault remains local default.",
        inputSchema: {
          type: "object",
          properties: {
            backend: { type: "string", enum: ["vault", "mem0", "graphrag"] }
          }
        },
        handler: async (args) => {
          const result = resolveMemoryBackend({ backend: args.backend, env: vault.env || process.env });
          return textResult(JSON.stringify(result, null, 2), { result });
        }
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
            status: {
              type: "string",
              enum: ["pending", "active", "pinned", "archived", "expired"],
              description: "Optional lifecycle filter for context-pack counts."
            },
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
            status: {
              type: "string",
              enum: ["pending", "active", "pinned", "archived", "expired"],
              description: "Omit for active and pinned memory only; pass pending explicitly for review."
            }
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
        name: "remember_worker_outcome",
        description: "Store a compact redacted Worker outcome as pending memory for human review.",
        inputSchema: {
          type: "object",
          properties: {
            outcome: { type: "object" },
            projectRoot: { type: "string" }
          },
          required: ["outcome"]
        },
        handler: async (args) => {
          const result = await rememberWorkerOutcome(vault, args.outcome, { projectRoot: args.projectRoot });
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "recall_worker_experience",
        description: "Recall only approved and unexpired Worker outcomes; pending results stay excluded.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            nodeId: { type: "string" },
            includeProjects: { type: "boolean", default: false }
          }
        },
        handler: async (args) => {
          const memories = await vault.listMemories({ projectRoot: args.projectRoot, includeGlobal: true, includeProjects: Boolean(args.includeProjects) });
          const result = {
            schema_version: "across-worker-memory-recall/1.0",
            results: recallableWorkerMemories(memories, { nodeId: args.nodeId || null }),
            merged: mergeWorkerExperiences(memories)
          };
          return textResult(JSON.stringify(result, null, 2), { result });
        }
      },
      {
        name: "revoke_worker_memories",
        description: "Archive all memories associated with a revoked Worker node.",
        inputSchema: {
          type: "object",
          properties: { nodeId: { type: "string" }, projectRoot: { type: "string" } },
          required: ["nodeId"]
        },
        handler: async (args) => {
          const result = await revokeWorkerMemories(vault, args.nodeId, { projectRoot: args.projectRoot });
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
            status: {
              type: "string",
              enum: ["pending", "active", "pinned", "archived", "expired"],
              description: "Omit for active and pinned memory only; pass pending explicitly for review."
            }
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
            status: {
              type: "string",
              enum: ["pending", "active", "pinned", "archived", "expired"],
              description: "Omit for active and pinned memory only; pass pending explicitly for review."
            }
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
            limit: { type: "number", default: 50 },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired"] }
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
            runIdB: { type: "string" },
            status: { type: "string", enum: ["pending", "active", "pinned", "archived", "expired"] }
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
      ...readStatusFilter(args),
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
  if (uri === "across-context://worker-experience") {
    const memories = await vault.listMemories({ projectRoot: args.projectRoot, includeGlobal: true, includeProjects: Boolean(args.includeProjects) });
    return resourceResult(uri, "application/json", JSON.stringify({
      schema_version: "across-worker-memory-recall/1.0",
      results: recallableWorkerMemories(memories, { nodeId: args.nodeId || null }),
      merged: mergeWorkerExperiences(memories)
    }, null, 2));
  }
  if (uri === "across-context://skill-export") {
    return resourceResult(uri, "application/json", JSON.stringify(await renderSkillExport(vault), null, 2));
  }
  if (uri === "across-context://memory-backend") {
    return resourceResult(uri, "application/json", JSON.stringify(resolveMemoryBackend({ env: vault.env || process.env }), null, 2));
  }
  if (uri === "across-context://memory-schemas") {
    const memories = await vault.listMemories({
      projectRoot: args.projectRoot,
      includeGlobal: true,
      includeProjects: Boolean(args.includeProjects),
      statuses: ACTIVE_MEMORY_STATUSES
    });
    return resourceResult(uri, "application/json", JSON.stringify({
      definitions: MEMORY_SCHEMA_DEFINITIONS,
      summary: schemaAwareSummary(memories)
    }, null, 2));
  }
  if (uri === "across-context://retrieval-routes") {
    return resourceResult(uri, "application/json", JSON.stringify({
      schema_version: "across-context-retrieval-routes/1.0",
      routes: RETRIEVAL_ROUTE_DEFINITIONS
    }, null, 2));
  }
  if (uri === "across-context://memory-projection") {
    return resourceResult(uri, "application/json", JSON.stringify(await inspectMemoryProjection(vault), null, 2));
  }
  if (uri === "across-context://memory-distillation-policy") {
    return resourceResult(uri, "application/json", JSON.stringify({
      schema_version: "across-context-memory-distillation-policy/1.0",
      source_types: ["session", "pending candidates"],
      output_schema: "across-context-distilled-memory-proposal/1.0",
      default_status: "pending",
      approval_required: true,
      rollback_supported: true,
      forgetting_propagates: true,
      provenance_required: true,
      secret_policy: "reject source",
      path_policy: "redact",
      transcript_policy: "redact",
      local_only: true,
      deterministic: true
    }, null, 2));
  }
  if (uri === "across-context://memory-trust-summary") {
    return resourceResult(uri, "application/json", JSON.stringify(await vault.trustSummary({
      projectRoot: args.projectRoot,
      includeProjects: Boolean(args.includeProjects)
    }), null, 2));
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

function readStatusFilter(args = {}) {
  return args.status !== undefined && String(args.status).trim() !== ""
    ? { status: args.status }
    : { statuses: ACTIVE_MEMORY_STATUSES };
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
