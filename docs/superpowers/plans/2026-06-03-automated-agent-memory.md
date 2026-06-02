# Automated Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Across Context from a raw MCP server into a one-command local memory onboarding system for coding agents.

**Architecture:** Add an automation layer that detects local agents, registers the MCP server where possible, generates agent behavior rules, and verifies connectivity. Add a memory policy layer that filters, deduplicates, trims, and classifies writes before they reach the vault.

**Tech Stack:** Node.js ESM, zero runtime dependencies, built-in `node:test`, shell-based local agent CLIs.

---

## File Structure

- `src/agent-registry.js`: detect supported agents and describe install/status commands.
- `src/setup.js`: orchestrate `setup`, `doctor`, and `status` flows.
- `src/memory-policy.js`: evaluate memory writes, sensitive content, limits, and dedupe.
- `src/vault.js`: apply policy, list/forget/stats/compact vault records.
- `src/exporters.js`: render stronger agent behavior rules for automatic read/write.
- `src/installers.js`: support user-level and project-level integration outputs.
- `src/cli.js`: expose `setup`, `doctor`, `status`, `list`, `forget`, `stats`, and `compact`.
- `tests/setup.test.js`: verify setup/doctor/status without touching real user configs.
- `tests/memory-policy.test.js`: verify allow/deny/duplicate/trim decisions.
- `tests/vault-management.test.js`: verify list/forget/stats/compact.
- `README.md` and `examples/*`: document one-command onboarding and memory policy.

## Tasks

### Task 1: Policy and Vault Management Tests

- [x] Add failing tests for sensitive memory denial, duplicate prevention, trimming, list/forget/stats/compact.
- [x] Run the focused tests and confirm they fail because the new APIs do not exist yet.
- [x] Implement `MemoryPolicyEngine` and extend `ContextVault`.
- [x] Re-run focused tests until they pass.

### Task 2: Agent Setup and Doctor Tests

- [x] Add failing tests for simulated agent detection, generated install plan, setup dry-run, doctor status, and project exports.
- [x] Run the focused tests and confirm they fail because setup APIs do not exist yet.
- [x] Implement agent registry and setup orchestration.
- [x] Re-run focused tests until they pass.

### Task 3: CLI Integration

- [x] Add failing CLI tests for `setup --all --yes`, `doctor`, `status`, `list`, `forget`, `stats`, and `compact`.
- [x] Implement CLI commands.
- [x] Re-run CLI tests until they pass.

### Task 4: Agent Behavior Rules

- [x] Update generated AGENTS.md, CLAUDE.md, and Cursor rules to include task-start read, before-final write, and never-write policy.
- [x] Add tests asserting generated rules include automatic read/write guidance and privacy constraints.
- [x] Re-run exporter/install tests.

### Task 5: Documentation

- [x] Update README quick start to lead with `across-context setup --all --yes`.
- [x] Document supported agents, automation limits, memory policy, and E2E validation.
- [x] Update examples to explain automatic behavior rules.

### Task 6: Verification

- [x] Run `npm test`.
- [x] Run `bash scripts/check.sh`.
- [x] Run `npm pack --dry-run`.
- [x] Run local command-level E2E with a temporary vault and project.
- [x] Run real Mac agent E2E: Claude writes through MCP, Codex reads through MCP, and doctor verifies configured agents.
