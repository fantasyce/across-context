export const MEMORY_BACKEND_SCHEMA = "across-memory-backend/1.0";

const SUPPORTED_BACKENDS = new Set(["vault", "mem0", "graphrag"]);

export function resolveMemoryBackend(options = {}) {
  const env = options.env || process.env;
  const requested = String(options.backend || options.memoryBackend || env.ACROSS_CONTEXT_MEMORY_BACKEND || "vault").toLowerCase();
  const backend = SUPPORTED_BACKENDS.has(requested) ? requested : "vault";
  return {
    schema_version: MEMORY_BACKEND_SCHEMA,
    backend,
    requested_backend: requested,
    status: SUPPORTED_BACKENDS.has(requested) ? "passed" : "fallback",
    default_backend: "vault",
    network_dependency_required: false,
    local_vault_source_of_truth: backend === "vault",
    candidate_ingest_policy: {
      raw_transcripts_included: false,
      secrets_included: false,
      outgoing_payload: "redacted_summary_only",
      pending_review_required: true
    },
    adapters: {
      vault: {
        status: "passed",
        storage: "local-jsonl",
        path_policy: "~/.across/data/across-context"
      },
      mem0: {
        status: backend === "mem0" ? "projection_only" : "available",
        dependency: "optional",
        network_dependency_required: false
      },
      graphrag: {
        status: backend === "graphrag" ? "projection_only" : "available",
        dependency: "optional",
        network_dependency_required: false
      }
    }
  };
}
