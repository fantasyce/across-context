# Agent Loop Memory Contract

This document records the implemented Across Context ownership boundary for
Agent Loop memory integration after the Across Agents Assistant `v0.8.28`
host-side closeout.

Across Context is a memory provider, policy engine, and review surface. It is
not a task scheduler, cost controller, event-stream owner, multi-agent router,
or release automation engine.

## Acceptance Decision

Accepted: 2026-06-20.

Decision owner: product owner request in the Agent Loop closeout cycle.

Decision: implement aggregate Agent Loop memory-candidate metrics and
candidate-policy diagnostics as the final Across Context engineering scope for
the current Agent Loop release-quality contract.

Acceptance criteria:

- CLI and MCP expose aggregate Agent Loop memory-candidate metrics.
- Metrics count produced, pending, approved, archived, expired, forgotten,
  duplicate, denied, and sensitive-denied candidates.
- Policy events are diagnostics inputs only and do not become a second memory
  store.
- Metrics and policy events exclude raw memory text, prompts, transcripts,
  provider keys, hidden reasoning, and local absolute paths.
- Context keeps pending-first review and does not select agents, resume loops,
  enforce runtime budgets, or approve handoffs.

## Structured Candidate Contract

Across Context accepts compact Agent Loop summaries using
`agent-loop-memory-candidate/1.0`.

Allowed summary fields:

- loop id
- goal summary
- outcome
- step decisions
- artifact hints
- recovery ids
- routing ids
- timestamps

The summary must not include full transcripts, provider responses, hidden chain
of thought, secrets, raw local paths, screenshots, large logs, or private tool
payloads.

Automatic loop summaries continue to enter pending review first. Context stores
them as ordinary governed memories after the existing policy checks pass.

## Memory Metrics Contract

Implemented surfaces:

- CLI: `across-context loop-memory-metrics --all-projects --json`
- MCP resource: `across-context://agent-loop-memory-metrics`
- MCP tool: `get_agent_loop_memory_metrics`

The aggregate metrics response uses schema
`agent-loop-memory-metrics/1.0`. Individual metric items use schema
`agent-loop-memory-metric/1.0`.

Metrics include:

- total Agent Loop candidate count
- pending, approved, archived, expired, and forgotten candidate counts
- duplicate candidate reuse count
- denied candidate count
- sensitive-denied candidate count
- status breakdown
- scope breakdown

Metrics must not include raw prompts, raw transcripts, provider keys, local
absolute paths, hidden reasoning, or full memory text.

## Policy Event Contract

Across Context records Agent Loop memory-candidate policy events for:

- allowed candidates
- duplicate candidates reused by policy
- denied candidates
- sensitive candidates denied by policy
- forgotten candidates

Policy events are aggregate diagnostics inputs. They must not become a second
memory store and must not include raw candidate text.

## Multi-Agent Boundary

Across Context may store memory about a routing decision after Orchestrator or a
host converts it into a safe candidate summary.

Across Context must not:

- select agents
- decompose tasks
- approve handoffs
- enforce runtime budgets
- retry, cancel, or resume loops

Those actions remain Orchestrator and host responsibilities.

## Completion Boundary

The current Agent Loop memory contract is complete for host integration:

- structured memory candidates
- pending-first review
- duplicate and sensitive-write policy enforcement
- all-project pending review
- aggregate memory-candidate metrics
- CLI and MCP metrics access
- raw-text exclusion tests

Future product scopes, such as dashboard analytics, cross-device sync,
cryptographic evidence trust, or autonomous workflow planning, require separate
product specs because they change review, trust, or operating policy.
