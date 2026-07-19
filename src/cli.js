#!/usr/bin/env node
import { resolve } from "node:path";
import { ContextVault } from "./vault.js";
import { learnProject } from "./project.js";
import { exportContext, renderContextDocument } from "./exporters.js";
import { installAgent, installHostPlugin, uninstallHostPlugin } from "./installers.js";
import { doctorAcrossContext, setupAcrossContext, statusAcrossContext } from "./setup.js";
import { renderAgentCard } from "./agent-card.js";
import { renderAgentLoopMemoryPolicy } from "./loop-memory-policy.js";
import { runHook } from "./hooks.js";
import { startDashboard } from "./dashboard.js";
import { renderHealth, renderPluginManifest, renderPluginStatus } from "./plugin-manifest.js";
import { contextPackSummary, loopHistory, loopMemoryDiff, recallLoopMemory, rememberLoopMemory } from "./autopilot-loop-memory.js";
import { recallEvidenceMemory, rememberEvidenceMemory } from "./evidence-memory.js";
import { recallAgentTeamReceipts, rememberAgentTeamReceipt } from "./agent-team-receipts.js";
import { resolveMemoryBackend } from "./memory-backend.js";
import { importSkillDirectories, renderSkillExport } from "./skill-export.js";
import { retrieveAndMergeMemory, retrieveMemory } from "./memory-retrieval.js";
import { MEMORY_SCHEMA_DEFINITIONS, schemaAwareSummary } from "./memory-schema.js";
import { forgetProjectedMemory, inspectMemoryProjection, rebuildMemoryProjection } from "./memory-projection.js";
import { runRetrievalEvaluation } from "./retrieval-eval.js";
import { approveGovernedMemory, improveMemory, rollbackDistilledMemory } from "./memory-distillation.js";
import { mergeWorkerExperiences, recallableWorkerMemories, rememberWorkerOutcome, revokeWorkerMemories } from "./worker-memory.js";

const vault = new ContextVault();

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const result = await vault.init();
    console.log(`Across Context vault ready: ${result.home}`);
    return;
  }

  if (command === "remember") {
    const parsed = parseArgs(rest);
    const text = parsed.positionals.join(" ").trim();
    const entry = await vault.remember({
      text,
      scope: parsed.scope || "global",
      type: parsed.type || "note",
      tags: mergeTags(parsed.tag || parsed.tags || [], parsed["agent-plugin"] ? [`agent-plugin:${parsed["agent-plugin"]}`] : []),
      projectRoot: parsed.project,
      source: "cli",
      auto: Boolean(parsed.auto),
      status: parsed.status,
      visibility: parsed.visibility,
      source_type: parsed["source-type"],
      source_id: parsed["source-id"],
      trust_level: parsed["trust-level"],
      evidence_hash: parsed["evidence-hash"],
      observed_at: parsed["observed-at"],
      expires_at: parsed["expires-at"]
    });
    if (parsed.json) {
      console.log(JSON.stringify({ memory: entry }, null, 2));
      return;
    }
    console.log(`Remembered ${entry.scope} ${entry.type}: ${entry.text}`);
    return;
  }

  if (command === "search") {
    const parsed = parseArgs(rest);
    if (parsed.status === "pending" && !parsed["review-pending"]) {
      throw new Error("Pending search requires --review-pending; use `pending` for the review queue.");
    }
    if (parsed.status === "quarantined" && !parsed["review-quarantined"]) {
      throw new Error("Quarantined search requires --review-quarantined; use `quarantine` for the review queue.");
    }
    const query = parsed.positionals.join(" ").trim();
    const results = await vault.search({
      query,
      projectRoot: parsed.project,
      limit: Number(parsed.limit || 20),
      includeGlobal: true,
      mode: parsed.mode || "keyword",
      status: parsed.status,
      reviewQuarantined: Boolean(parsed["review-quarantined"])
    });
    if (parsed.json) {
      console.log(JSON.stringify({
        results: results.map((result) => parsed.explain ? result : omitExplanation(result))
      }, null, 2));
      return;
    }
    if (!results.length) {
      console.log("No matching context found.");
      return;
    }
    for (const result of results) {
      console.log(`[${result.entry.scope}/${result.entry.type}] ${result.entry.text}`);
    }
    return;
  }

  if (command === "retrieve") {
    const parsed = parseArgs(rest);
    const retrievalInput = {
      query: parsed.positionals.join(" ").trim(),
      projectRoot: parsed.project,
      includeGlobal: true,
      includeProjects: Boolean(parsed["all-projects"]),
      limit: parsed.limit,
      status: parsed.status,
      reviewPending: Boolean(parsed["review-pending"]),
      reviewQuarantined: Boolean(parsed["review-quarantined"]),
      allowEmptyQuery: Boolean(parsed["allow-empty-query"]),
      includeRouteResults: Boolean(parsed["include-route-results"])
    };
    const result = parsed.routes
      ? await retrieveAndMergeMemory(vault, { ...retrievalInput, routes: String(parsed.routes).split(",") })
      : await retrieveMemory(vault, { ...retrievalInput, route: parsed.route || "keyword" });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : parsed.routes ? formatMergedRetrieval(result) : formatRetrieval(result));
    return;
  }

  if (command === "improve") {
    const [subcommand, ...improveRest] = rest;
    const parsed = parseArgs(improveRest);
    if (subcommand === "run") {
      const sourceIds = parsed["source-id"] ? (Array.isArray(parsed["source-id"]) ? parsed["source-id"] : [parsed["source-id"]]) : undefined;
      const result = await improveMemory(vault, {
        projectRoot: parsed.project,
        includeProjects: Boolean(parsed["all-projects"]),
        sourceIds,
        similarityThreshold: parsed["similarity-threshold"],
        maxProposalLength: parsed["max-proposal-length"]
      });
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `distilled proposals: ${result.proposal_count}; rejected sources: ${result.rejected_source_count}`);
      return;
    }
    if (subcommand === "rollback") {
      const result = await rollbackDistilledMemory(vault, parsed.positionals[0] || parsed.id);
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.proposal_id}: ${result.status}`);
      return;
    }
    throw new Error("Usage: across-context improve run|rollback [options]");
  }

  if (command === "memory-schemas") {
    const parsed = parseArgs(rest);
    const memories = await vault.listMemories({
      projectRoot: parsed.project,
      includeGlobal: true,
      includeProjects: Boolean(parsed["all-projects"]),
      statuses: ["active", "pinned"]
    });
    const summary = schemaAwareSummary(memories);
    console.log(parsed.json ? JSON.stringify(summary, null, 2) : MEMORY_SCHEMA_DEFINITIONS.map((item) => `${item.id}: ${summary.by_schema[item.id]}`).join("\n"));
    return;
  }

  if (command === "projection") {
    const [subcommand, ...projectionRest] = rest;
    const parsed = parseArgs(projectionRest);
    if (subcommand === "rebuild") {
      const result = await rebuildMemoryProjection(vault, {
        graph: parseBooleanOption(parsed.graph, true),
        vector: parseBooleanOption(parsed.vector, true),
        dimensions: parsed.dimensions
      });
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `projection ${result.projection_id}: ${result.included_record_count} records`);
      return;
    }
    if (subcommand === "inspect") {
      const result = await inspectMemoryProjection(vault);
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.status}: ${result.projection_id || "not built"}`);
      return;
    }
    if (subcommand === "forget") {
      const id = parsed.positionals[0] || parsed.id;
      const result = await forgetProjectedMemory(vault, id);
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `forgotten: ${result.authoritative_forgotten}`);
      return;
    }
    throw new Error("Usage: across-context projection rebuild|inspect|forget [memory-id]");
  }

  if (command === "retrieval-eval") {
    const parsed = parseArgs(rest);
    const result = await runRetrievalEvaluation({ fixturePath: parsed.fixture });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `retrieval eval: ${result.passed ? "passed" : "failed"} (${result.recall_at_k} recall@k, ${result.mean_reciprocal_rank} MRR)`);
    if (!result.passed) process.exitCode = 1;
    return;
  }

  if (command === "pending") {
    const parsed = parseArgs(rest);
    const memories = await vault.listMemories({
      projectRoot: parsed.project,
      includeGlobal: true,
      includeProjects: Boolean(parsed["all-projects"]),
      status: "pending"
    });
    if (parsed.json) {
      console.log(JSON.stringify(memories, null, 2));
      return;
    }
    if (!memories.length) {
      console.log("No pending memories.");
      return;
    }
    for (const entry of memories) {
      console.log(`${entry.id} [${entry.scope}/${entry.type}] ${entry.text}`);
    }
    return;
  }

  if (command === "quarantine") {
    const parsed = parseArgs(rest);
    const memories = await vault.listMemories({
      projectRoot: parsed.project,
      includeGlobal: true,
      includeProjects: Boolean(parsed["all-projects"]),
      status: "quarantined"
    });
    console.log(parsed.json ? JSON.stringify(memories, null, 2) : memories.map((entry) => `${entry.id} [${entry.policy?.quarantineReasons?.join(",") || "quarantined"}] ${entry.text}`).join("\n") || "No quarantined memories.");
    return;
  }

  if (command === "trust-summary") {
    const parsed = parseArgs(rest);
    const summary = await vault.trustSummary({
      projectRoot: parsed.project,
      includeProjects: Boolean(parsed["all-projects"])
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === "worker-memory") {
    const [subcommand, ...workerRest] = rest;
    const parsed = parseArgs(workerRest);
    if (subcommand === "remember") {
      const outcome = JSON.parse(String(parsed["outcome-json"] || parsed.positionals.join(" ") || "{}"));
      const result = await rememberWorkerOutcome(vault, outcome, { projectRoot: parsed.project });
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.id}: ${result.status}`);
      return;
    }
    if (subcommand === "recall") {
      const memories = await vault.listMemories({ projectRoot: parsed.project, includeGlobal: true, includeProjects: Boolean(parsed["all-projects"]) });
      const results = recallableWorkerMemories(memories, { nodeId: parsed["node-id"] || null });
      const merged = mergeWorkerExperiences(memories);
      const result = { schema_version: "across-worker-memory-recall/1.0", results, merged };
      console.log(parsed.json ? JSON.stringify(result, null, 2) : results.map((item) => `${item.memory_id} ${item.node_id} ${item.terminal_state}: ${item.conclusion}`).join("\n") || "No approved Worker memory found.");
      return;
    }
    if (subcommand === "revoke") {
      const nodeId = parsed["node-id"] || parsed.positionals[0];
      const result = await revokeWorkerMemories(vault, nodeId, { projectRoot: parsed.project });
      console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.node_id}: ${result.revoked} memories archived`);
      return;
    }
    throw new Error("Usage: across-context worker-memory remember|recall|revoke [options]");
  }

  if (command === "approve" || command === "archive" || command === "expire") {
    const parsed = parseArgs(rest);
    const status = command === "approve" ? "active" : command === "archive" ? "archived" : "expired";
    const entry = command === "approve"
      ? await approveGovernedMemory(vault, parsed.positionals[0])
      : await vault.updateStatus(parsed.positionals[0], status);
    if (parsed.json) {
      console.log(JSON.stringify(command === "approve" && entry.proposal_id ? entry : { memory: entry }, null, 2));
      return;
    }
    console.log(`${entry.proposal_id || entry.id}: ${entry.status}`);
    return;
  }

  if (command === "update-status") {
    const parsed = parseArgs(rest);
    const [status, ...ids] = parsed.positionals;
    const result = await vault.updateStatuses(ids, status);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`updated: ${result.updated.length}`);
    if (result.missing.length) {
      console.log(`missing: ${result.missing.join(", ")}`);
    }
    return;
  }

  if (command === "list") {
    const parsed = parseArgs(rest);
    const memories = await vault.listMemories({
      projectRoot: parsed.project,
      includeGlobal: true,
      includeProjects: Boolean(parsed["all-projects"]),
      ...(parsed.status ? { status: parsed.status } : { statuses: ["active", "pinned"] })
    });
    if (parsed.json) {
      console.log(JSON.stringify(memories, null, 2));
      return;
    }
    if (!memories.length) {
      console.log("No memories found.");
      return;
    }
    for (const entry of memories) {
      console.log(`${entry.id} [${entry.scope}/${entry.type}] ${entry.text}`);
    }
    return;
  }

  if (command === "forget") {
    const parsed = parseArgs(rest);
    const id = parsed.positionals[0];
    const result = await vault.forget(id);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`forgotten: ${result.forgotten}`);
    return;
  }

  if (command === "stats") {
    const parsed = parseArgs(rest);
    const stats = await vault.stats({ projectRoot: parsed.project });
    console.log(formatStats(stats));
    return;
  }

  if (command === "compact") {
    const parsed = parseArgs(rest);
    const result = await vault.compact({ projectRoot: parsed.project });
    console.log(`removed: ${result.removed}`);
    return;
  }

  if (command === "agent-card") {
    const parsed = parseArgs(rest);
    const card = await renderAgentCard(vault);
    console.log(parsed.json ? JSON.stringify(card, null, 2) : formatAgentCard(card));
    return;
  }

  if (command === "skill-export") {
    const parsed = parseArgs(rest);
    const result = await renderSkillExport(vault, { outputDir: parsed.output || parsed["output-dir"] });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `exported skills: ${result.skills.length}`);
    return;
  }

  if (command === "skills-import") {
    const parsed = parseArgs(rest);
    const result = await importSkillDirectories(vault, { roots: parsed.root });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `pending skill memories: ${result.summary.memory_count}`);
    return;
  }

  if (command === "memory-backend") {
    const parsed = parseArgs(rest);
    const result = resolveMemoryBackend({ backend: parsed.backend, env: process.env });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.backend}: ${result.status}`);
    return;
  }

  if (command === "loop-memory-policy") {
    const parsed = parseArgs(rest);
    const policy = renderAgentLoopMemoryPolicy();
    console.log(parsed.json ? JSON.stringify(policy, null, 2) : formatLoopMemoryPolicy(policy));
    return;
  }

  if (command === "loop-memory-metrics") {
    const parsed = parseArgs(rest);
    const metrics = await vault.agentLoopMemoryMetrics({
      projectRoot: parsed.project,
      includeProjects: Boolean(parsed["all-projects"])
    });
    console.log(parsed.json ? JSON.stringify(metrics, null, 2) : formatLoopMemoryMetrics(metrics));
    return;
  }

  if (command === "context-packs") {
    const parsed = parseArgs(rest);
    const summary = await contextPackSummary(vault, {
      projectRoot: parsed.project,
      includeProjects: Boolean(parsed["all-projects"]),
      status: parsed.status,
      agentPluginId: parsed["agent-plugin"]
    });
    console.log(parsed.json ? JSON.stringify(summary, null, 2) : formatContextPackSummary(summary));
    return;
  }

  if (command === "remember-loop") {
    const parsed = parseArgs(rest);
    const summary = parsed["summary-json"] ? JSON.parse(parsed["summary-json"]) : {};
    const result = await rememberLoopMemory(vault, {
      specId: parsed["spec-id"],
      runId: parsed["run-id"],
      text: parsed.text || parsed.positionals.join(" "),
      summary,
      agentPluginId: parsed["agent-plugin"]
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.status}: ${result.memory?.id || result.reason}`);
    return;
  }

  if (command === "recall-loop") {
    const parsed = parseArgs(rest);
    const result = await recallLoopMemory(vault, {
      specId: parsed["spec-id"],
      runId: parsed["run-id"],
      limit: parsed.limit,
      status: parsed.status
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : formatRecallLoop(result));
    return;
  }

  if (command === "remember-evidence") {
    const parsed = parseArgs(rest);
    const graph = parsed["graph-json"] ? JSON.parse(parsed["graph-json"]) : {};
    const result = await rememberEvidenceMemory(vault, {
      graph,
      specId: parsed["spec-id"],
      runId: parsed["run-id"],
      summary: parsed.summary || parsed.text || parsed.positionals.join(" ")
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.status}: ${result.memory?.id || result.reason}`);
    return;
  }

  if (command === "recall-evidence") {
    const parsed = parseArgs(rest);
    const result = await recallEvidenceMemory(vault, {
      specId: parsed["spec-id"],
      runId: parsed["run-id"],
      limit: parsed.limit,
      status: parsed.status
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : formatRecallEvidence(result));
    return;
  }

  if (command === "remember-agent-team-receipt") {
    const parsed = parseArgs(rest);
    const result = await rememberAgentTeamReceipt(vault, {
      packId: parsed["pack-id"],
      receipt: parsed["receipt-json"] ? JSON.parse(parsed["receipt-json"]) : {},
      product_card: parsed["product-card-json"] ? JSON.parse(parsed["product-card-json"]) : {},
      protocol_readiness: parsed["protocol-readiness-json"] ? JSON.parse(parsed["protocol-readiness-json"]) : {}
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `${result.status}: ${result.memory?.id || result.pack_id}`);
    return;
  }

  if (command === "recall-agent-team-receipts") {
    const parsed = parseArgs(rest);
    const result = await recallAgentTeamReceipts(vault, {
      packId: parsed["pack-id"],
      limit: parsed.limit,
      status: parsed.status
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : result.results.map((item) => `${item.pack_id}: ${item.headline}`).join("\n"));
    return;
  }

  if (command === "loop-history") {
    const parsed = parseArgs(rest);
    const result = await loopHistory(vault, { specId: parsed["spec-id"], limit: parsed.limit, status: parsed.status });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : result.specs.map((item) => `${item.spec_id}: ${item.run_count}`).join("\n"));
    return;
  }

  if (command === "loop-memory-diff") {
    const parsed = parseArgs(rest);
    const ids = parsed["run-id"] || [];
    const result = await loopMemoryDiff(vault, {
      runIdA: Array.isArray(ids) ? ids[0] : parsed["run-id-a"],
      runIdB: Array.isArray(ids) ? ids[1] : parsed["run-id-b"],
      status: parsed.status
    });
    console.log(parsed.json ? JSON.stringify(result, null, 2) : `added: ${result.added.length}\nremoved: ${result.removed.length}`);
    return;
  }

  if (command === "plugin-manifest") {
    const parsed = parseArgs(rest);
    const manifest = await renderPluginManifest({
      acrossHome: parsed["across-home"],
      pluginRoot: parsed["plugin-root"],
      binDir: parsed["bin-dir"]
    });
    console.log(parsed.json ? JSON.stringify(manifest, null, 2) : formatPluginManifest(manifest));
    return;
  }

  if (command === "plugin-status") {
    const parsed = parseArgs(rest);
    const status = await renderPluginStatus({
      acrossHome: parsed["across-home"],
      pluginRoot: parsed["plugin-root"],
      binDir: parsed["bin-dir"]
    });
    console.log(parsed.json ? JSON.stringify(status, null, 2) : formatPluginStatus(status));
    return;
  }

  if (command === "health") {
    const parsed = parseArgs(rest);
    const health = await renderHealth(vault, { projectRoot: parsed.project });
    console.log(parsed.json ? JSON.stringify(health, null, 2) : formatHealth(health));
    return;
  }

  if (command === "team") {
    const [subcommand, ...teamRest] = rest;
    if (subcommand !== "export") {
      throw new Error("Usage: across-context team export [--project path]");
    }
    const parsed = parseArgs(teamRest);
    const result = await vault.exportTeamMemory({ projectRoot: parsed.project || process.cwd() });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "hook") {
    const [name, ...hookRest] = rest;
    const parsed = parseArgs(hookRest);
    const result = await runHook(vault, {
      name,
      query: parsed.query || parsed.positionals.join(" "),
      summary: parsed.summary || parsed.positionals.join(" "),
      projectRoot: parsed.project,
      mode: parsed.mode
    });
    console.log(result.text);
    return;
  }

  if (command === "project") {
    const [subcommand, ...subRest] = rest;
    if (subcommand !== "learn") {
      throw new Error("Usage: across-context project learn [path]");
    }
    const projectRoot = resolve(subRest[0] || process.cwd());
    const profile = await learnProject(projectRoot);
    await vault.saveProjectProfile(profile);
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  if (command === "export") {
    const [target = "agents", ...targetRest] = rest;
    const parsed = parseArgs(targetRest);
    const projectRoot = resolve(parsed.project || process.cwd());
    await ensureProfile(projectRoot);
    if (parsed.stdout) {
      console.log(await renderContextDocument(vault, { projectRoot, target }));
      return;
    }
    const result = await exportContext(vault, { projectRoot, target });
    console.log(`Exported ${result.target} context to ${result.path}`);
    return;
  }

  if (command === "install") {
    const [target, ...installRest] = rest;
    if (!target) {
      throw new Error("Usage: across-context install <codex|codex-mcp|cursor|claude-code|claude-desktop|host-plugin> [--project path] [--stdout] [--config-file path] [--across-home path]");
    }
    const parsed = parseArgs(installRest);
    if (target === "host-plugin") {
      if (parsed.prefix) {
        throw new Error("--prefix is no longer supported for host-plugin installs; use --across-home or --plugin-root.");
      }
      const result = await installHostPlugin({
        acrossHome: parsed["across-home"],
        pluginRoot: parsed["plugin-root"],
        binDir: parsed["bin-dir"]
      });
      if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Installed host plugin command at ${result.commandPath}`);
      console.log(`runtime: ${result.installDir}`);
      return;
    }
    const projectRoot = parsed.project ? resolve(parsed.project) : process.cwd();
    if (target === "codex" || target === "cursor") {
      await ensureProfile(projectRoot);
    }
    const result = await installAgent(vault, target, {
      projectRoot,
      configFile: parsed["config-file"],
      acrossHome: parsed["across-home"],
      pluginRoot: parsed["plugin-root"],
      binDir: parsed["bin-dir"],
      env: process.env
    });
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (parsed.stdout || result.command) {
      console.log(result.command || JSON.stringify(result, null, 2));
    } else {
      console.log(`Installed ${result.target} integration at ${result.path}`);
    }
    return;
  }

  if (command === "uninstall") {
    const [target, ...uninstallRest] = rest;
    if (target !== "host-plugin") {
      throw new Error("Usage: across-context uninstall host-plugin [--across-home path]");
    }
    const parsed = parseArgs(uninstallRest);
    if (parsed.prefix) {
      throw new Error("--prefix is no longer supported for host-plugin uninstalls; use --across-home or --plugin-root.");
    }
    const result = await uninstallHostPlugin({
      acrossHome: parsed["across-home"],
      pluginRoot: parsed["plugin-root"],
      binDir: parsed["bin-dir"]
    });
    console.log(`Removed host plugin command at ${result.commandPath}`);
    console.log(`runtime: ${result.installDir}`);
    return;
  }

  if (command === "setup") {
    const parsed = parseArgs(rest);
    const projectRoot = resolve(parsed.project || process.cwd());
    const targets = parsed.all ? ["all"] : parsed.positionals;
    const result = await setupAcrossContext({
      vault,
      projectRoot,
      targets,
      yes: Boolean(parsed.yes),
      noExternal: Boolean(parsed["no-external"])
    });
    console.log(formatSetupResult(result));
    return;
  }

  if (command === "doctor") {
    const parsed = parseArgs(rest);
    const projectRoot = resolve(parsed.project || process.cwd());
    const result = await doctorAcrossContext({ vault, projectRoot });
    console.log(formatDoctor(result));
    return;
  }

  if (command === "status") {
    const parsed = parseArgs(rest);
    const projectRoot = resolve(parsed.project || process.cwd());
    const result = await statusAcrossContext({ vault, projectRoot });
    console.log(formatStatus(result));
    return;
  }

  if (command === "dashboard") {
    const parsed = parseArgs(rest);
    const result = await startDashboard(vault, {
      projectRoot: parsed.project,
      host: parsed.host,
      port: parsed.port
    });
    console.log(`Across Context Dashboard: ${result.url}`);
    return;
  }

  if (command === "mcp") {
    await import("./mcp-server.js");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(args) {
  const parsed = { positionals: [] };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--stdout") {
      parsed.stdout = true;
    } else if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        parsed[key] = true;
      } else {
        index += 1;
        if (parsed[key]) {
          parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], next] : [parsed[key], next];
        } else {
          parsed[key] = next;
        }
      }
    } else {
      parsed.positionals.push(item);
    }
  }
  return parsed;
}

async function ensureProfile(projectRoot) {
  const existing = await vault.getProjectProfile(projectRoot);
  if (existing) return existing;
  const profile = await learnProject(projectRoot);
  return vault.saveProjectProfile(profile);
}

function printHelp() {
  console.log(`Usage: across-context <command>

Commands:
  init                                  Create the local context vault
  remember <text> [--scope global|project] [--type preference|decision|note|command|session] [--status pending|active|pinned] [--source-type type] [--source-id id] [--trust-level trusted|review|untrusted] [--observed-at ISO] [--expires-at ISO] [--project path] [--json]
  search <query> [--project path] [--mode keyword|semantic|hybrid] [--review-pending --status pending]
                                        Search active and pinned global/project context by default
  search <query> --json [--explain]     Print structured search results
  retrieve <query> --route keyword|embedding|evidence_graph|project_profile|loop_recall [--project path] [--json]
                                        Use an explicit deterministic retrieval route
  retrieve <query> --routes keyword,embedding,evidence_graph,project_profile,loop_recall [--json]
                                        Merge independent routes with explainable weighted reciprocal-rank fusion
  improve run [--project path|--all-projects] [--source-id id] [--json]
                                        Distill session/pending candidates into governed pending proposals
  improve rollback <proposal-id> [--json]
                                        Archive a proposal and restore source lifecycle states
  memory-schemas [--project path|--all-projects] [--json]
                                        Classify active/pinned records without migrating JSONL
  projection rebuild [--graph false] [--vector false] [--dimensions 48] [--json]
                                        Rebuild optional local graph and hash-vector projections
  projection inspect [--json]           Inspect projection status and privacy policy
  projection forget <memory-id> [--json]
                                        Forget authoritative memory and propagate deletion to projections
  retrieval-eval [--fixture path] [--json]
                                        Run deterministic local retrieval quality fixtures
  list [--project path|--all-projects] [--status pending|active|pinned|archived|expired|quarantined] [--json]
                                        List active/pinned memory; other states require --status
  pending [--project path|--all-projects] [--json]
                                        List pending automatic memories
  quarantine [--project path|--all-projects] [--json]
                                        Review quarantined memory excluded from normal retrieval
  trust-summary [--project path|--all-projects]
                                        Print compact provenance and freshness counts without memory text
  worker-memory remember --outcome-json '{}' [--project path] [--json]
                                        Store a compact Worker evidence outcome as pending review
  worker-memory recall [--node-id id] [--project path|--all-projects] [--json]
                                        Recall only approved, unexpired Worker experience
  worker-memory revoke --node-id id [--project path] [--json]
                                        Archive Worker memories after device revocation
  approve <memory-id> [--json]          Approve a pending memory
  archive <memory-id> [--json]          Archive a memory
  expire <memory-id> [--json]           Mark a memory expired
  update-status <status> <memory-id...> Batch update memory lifecycle status
  forget <memory-id> [--json]           Remove a memory by id
  stats [--project path]                Show memory counts
  compact [--project path]              Remove duplicate records from the vault
  agent-card [--json]                   Print the Across Context agent card
  skill-export [--output dir] [--json]  Export Across Context skills as agentskills.io directories
  skills-import [--root path] [--json]  Import Codex/Claude/Qwen skill directories as redacted pending memory
  memory-backend [--backend vault|mem0|graphrag] [--json]
                                        Show the active memory backend contract
  loop-memory-policy [--json]           Print agent-loop memory hook policy
  loop-memory-metrics [--project path|--all-projects] [--json]
                                        Print aggregate agent-loop memory candidate metrics
  context-packs [--project path|--all-projects] [--status pending|active] [--agent-plugin id] [--json]
                                        Summarize memories into Context Pack / Memory OS groups
  remember-loop --spec-id id --run-id id --text text --summary-json '{}' [--json]
                                        Store a pending loop memory summary with policy enforcement
  recall-loop --spec-id id --limit 10 [--status pending] [--json]
                                        Recall active/pinned loop memory for a spec; pending requires --status pending
  recall-loop --run-id id [--status pending] [--json]
                                        Recall active/pinned loop memory for a run
  remember-evidence --graph-json '{}' --spec-id id --run-id id [--summary text] [--json]
                                        Store compact evidence graph memory as pending review
  recall-evidence --spec-id id|--run-id id [--status pending] [--json]
                                        Recall compact evidence graph memory
  remember-agent-team-receipt --pack-id id --receipt-json '{}' [--product-card-json '{}'] [--protocol-readiness-json '{}'] [--json]
                                        Store an agent-team trust receipt as pending memory
  recall-agent-team-receipts [--pack-id id] [--status pending] [--json]
                                        Recall agent-team trust receipts
  loop-history [--spec-id id] [--status pending] [--json]
                                        Summarize active/pinned loop memory by spec
  loop-memory-diff --run-id a --run-id b [--status pending] [--json]
                                        Compare loop memory between two runs
  plugin-manifest [--json]              Print the Across plugin manifest
  plugin-status [--json]                Print host-install and protocol status
  health [--json]                       Probe vault health without external agent setup
  team export [--project path]          Export team-safe project memory as JSON
  hook task-start --query <text> [--project path]
  hook task-end --summary <text> [--project path]
  project learn [path]                  Learn project commands and metadata
  export <agents|claude|cursor|markdown> [--project path] [--stdout]
  install <codex|codex-mcp|cursor|claude-code|claude-desktop> [--project path] [--stdout] [--config-file path]
  install host-plugin [--across-home path] [--plugin-root path] [--bin-dir path]
                                        Install runtime for host apps under ~/.across
                                        --plugin-root/--bin-dir are development-only overrides
  uninstall host-plugin [--across-home path] [--plugin-root path] [--bin-dir path]
                                        Remove managed host runtime while preserving data
  setup [--all] [--yes] [--no-external] [--project path]
  doctor [--project path]               Verify vault, project files, and local agent availability
  status [--project path]               Show vault and agent summary
  dashboard [--host 127.0.0.1] [--port 3767]
  mcp                                   Start MCP stdio server
`);
}

function formatStats(stats) {
  const lines = [`home: ${stats.home}`, `total: ${stats.total}`];
  lines.push(`by scope: ${formatCounts(stats.byScope)}`);
  lines.push(`by type: ${formatCounts(stats.byType)}`);
  return lines.join("\n");
}

function formatLoopMemoryMetrics(metrics) {
  const totals = metrics.totals || {};
  return [
    `schema: ${metrics.schema_version}`,
    `candidate schema: ${metrics.candidate_schema}`,
    `candidate count: ${totals.candidate_count || 0}`,
    `pending: ${totals.pending_count || 0}`,
    `approved: ${totals.approved_count || 0}`,
    `archived: ${totals.archived_count || 0}`,
    `expired: ${totals.expired_count || 0}`,
    `forgotten: ${totals.forgotten_count || 0}`,
    `duplicates reused: ${totals.duplicate_reused_count || 0}`,
    `denied: ${totals.denied_count || 0}`
  ].join("\n");
}

function formatContextPackSummary(summary) {
  const lines = [
    `context packs: ${summary.summary.context_pack_count}`,
    `memories: ${summary.summary.memory_count}`,
    `pending: ${summary.summary.pending_count}`,
    `agent plugins: ${summary.summary.agent_plugin_count || 0}`
  ];
  for (const pack of summary.packs || []) {
    lines.push(`${pack.id}: ${pack.count}`);
  }
  return lines.join("\n");
}

function formatMergedRetrieval(result) {
  if (!result.results.length) return "No matching context found.";
  return result.results.map((item) => `[${item.merged_rank}] ${item.entry.text}`).join("\n");
}

function mergeTags(base, extra) {
  const values = Array.isArray(base) ? base : base ? [base] : [];
  return [...new Set([...values, ...extra].map(String).filter(Boolean))];
}

function formatRecallLoop(result) {
  if (!result.results.length) return "No loop memory found.";
  return result.results.map((item) => `${item.memory_id} [${item.spec_id}/${item.run_id}] ${item.text}`).join("\n");
}

function formatRecallEvidence(result) {
  if (!result.results.length) return "No evidence memory found.";
  return result.results
    .map((item) => `${item.memory_id} [${item.status}] ${item.spec_id}/${item.run_id}: ${item.summary}`)
    .join("\n");
}

function formatSetupResult(result) {
  const lines = [
    "Setup complete",
    `vault: ${result.home}`,
    `project files: ${result.project.installed.length}`
  ];
  for (const registration of result.registrations) {
    lines.push(`agent ${registration.agent}: ${registration.status}`);
  }
  return lines.join("\n");
}

function formatDoctor(result) {
  const lines = [
    `vault: ${result.vault.status}`,
    `AGENTS.md: ${result.project.files.AGENTS}`,
    `CLAUDE.md: ${result.project.files.CLAUDE}`,
    `Cursor rules: ${result.project.files.CURSOR}`,
    `Cursor MCP: ${result.project.files.CURSOR_MCP}`,
    "agents:"
  ];
  for (const agent of result.agents) {
    lines.push(`- ${agent.id}: ${agent.status}`);
  }
  return lines.join("\n");
}

function formatStatus(result) {
  const lines = [
    `vault: ${result.home}`,
    `memories: ${result.memories.total}`,
    "agents:"
  ];
  for (const agent of result.agents) {
    lines.push(`- ${agent.id}: ${agent.available ? "available" : "missing"}`);
  }
  return lines.join("\n");
}

function formatAgentCard(card) {
  return [
    `${card.name} ${card.version}`,
    card.description,
    `MCP: ${card.endpoints.mcp.command} ${card.endpoints.mcp.args.join(" ")}`,
    `Skills: ${card.skills.map((skill) => skill.id).join(", ")}`
  ].join("\n");
}

function formatLoopMemoryPolicy(policy) {
  return [
    `provider: ${policy.provider}`,
    `default read: ${policy.defaultReadStatus}`,
    `default write: ${policy.defaultWriteStatus}`,
    `hooks: ${policy.hooks.map((hook) => hook.id).join(", ")}`
  ].join("\n");
}

function formatPluginManifest(manifest) {
  return [
    `${manifest.displayName} ${manifest.version}`,
    `id: ${manifest.id}`,
    `kind: ${manifest.kind}`,
    `mcp: ${manifest.entrypoints.mcp.command} ${manifest.entrypoints.mcp.args.join(" ")}`
  ].join("\n");
}

function formatPluginStatus(status) {
  return [
    `plugin: ${status.pluginId}`,
    `status: ${status.status}`,
    `command: ${status.commandExists ? "available" : "missing"}`,
    `manifest: ${status.manifestExists ? status.manifestPath : "missing"}`
  ].join("\n");
}

function formatHealth(health) {
  return [
    `status: ${health.status}`,
    `plugin: ${health.pluginId}`,
    `home: ${health.home}`,
    `memories: ${health.memories}`
  ].join("\n");
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function formatRetrieval(result) {
  if (!result.results.length) return "No matching context found.";
  return result.results.map((item) => `[${item.classification.primary_schema}] ${item.entry.text}`).join("\n");
}

function parseBooleanOption(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`Invalid boolean option: ${value}`);
}

function omitExplanation(result) {
  const { explanation, ...rest } = result;
  return rest;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
