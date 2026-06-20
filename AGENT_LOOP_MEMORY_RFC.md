# Agent Loop Memory RFC

This document records Across Context ownership for the Agent Loop work that
remains after the host-side closeout in Across Agents Assistant `v0.8.28`.

Across Context is a memory provider and review surface. It is not a task
scheduler, cost controller, event-stream owner, or multi-agent router.

## Memory Telemetry Boundary

Across Context may expose aggregate memory lifecycle metrics for Agent Loop
runs:

- memory candidates produced
- pending candidates awaiting review
- candidates approved, archived, expired, or forgotten
- duplicate candidates rejected by policy
- sensitive candidates denied by policy

It must not expose:

- raw prompts
- raw transcripts
- provider keys
- local absolute paths
- full memory text in telemetry payloads

## Proposed Metric Shape

```json
{
  "schema_version": "agent-loop-memory-metric/1.0",
  "metric": "memory_candidate.approved_count",
  "value": 1,
  "unit": "count",
  "dimensions": {
    "project_id": "project-...",
    "loop_id": "loop-...",
    "candidate_schema": "agent-loop-memory-candidate/1.0",
    "source": "post_loop_pending_summary"
  },
  "observed_at": "2026-06-20T00:00:00Z"
}
```

`project_id` and `loop_id` are optional when a report is aggregated across all
projects.

## Structured Candidate Contract

Across Context continues to accept compact Agent Loop summaries using
`agent-loop-memory-candidate/1.0`.

The allowed summary fields remain:

- loop id
- goal summary
- outcome
- step decisions
- artifact hints
- recovery and routing ids
- timestamps

The summary must not include full transcripts, provider responses, hidden chain
of thought, secrets, or private local paths.

## Multi-Agent Boundary

Across Context may store memory about a routing decision after it is converted
into a safe candidate summary.

Across Context must not:

- select agents
- decompose tasks
- approve handoffs
- enforce runtime budgets
- retry, cancel, or resume loops

Those actions remain Orchestrator and host responsibilities.

## Automation Integration

AAA's ecosystem review workflow may create issues that mention memory policy,
pending review, or candidate metrics. Context changes still require a PR and
`npm run check`.

Automation may propose documentation or policy clarification automatically, but
runtime memory writes and lifecycle changes remain behind existing policy and
review gates.

## Acceptance Criteria

Before implementing any memory metric or policy change:

- tests prove raw memory text is excluded from telemetry
- tests prove sensitive candidates are still denied before storage
- MCP resource and CLI output remain backward compatible
- pending review defaults remain `pending`
- all-project review keeps project-scoped context separated from global memory
