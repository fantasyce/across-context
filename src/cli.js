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
      tags: parsed.tag || parsed.tags || [],
      projectRoot: parsed.project,
      source: "cli",
      auto: Boolean(parsed.auto),
      status: parsed.status,
      visibility: parsed.visibility
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
    const query = parsed.positionals.join(" ").trim();
    const results = await vault.search({
      query,
      projectRoot: parsed.project,
      limit: Number(parsed.limit || 20),
      includeGlobal: true,
      mode: parsed.mode || "keyword",
      status: parsed.status
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

  if (command === "approve" || command === "archive" || command === "expire") {
    const parsed = parseArgs(rest);
    const status = command === "approve" ? "active" : command === "archive" ? "archived" : "expired";
    const entry = await vault.updateStatus(parsed.positionals[0], status);
    if (parsed.json) {
      console.log(JSON.stringify({ memory: entry }, null, 2));
      return;
    }
    console.log(`${entry.id}: ${entry.status}`);
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
      status: parsed.status
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

  if (command === "loop-memory-policy") {
    const parsed = parseArgs(rest);
    const policy = renderAgentLoopMemoryPolicy();
    console.log(parsed.json ? JSON.stringify(policy, null, 2) : formatLoopMemoryPolicy(policy));
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
      throw new Error("Usage: across-context install <codex|cursor|claude-code|host-plugin> [--project path] [--stdout] [--across-home path]");
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
      console.log(`Installed host plugin command at ${result.commandPath}`);
      console.log(`runtime: ${result.installDir}`);
      return;
    }
    const projectRoot = parsed.project ? resolve(parsed.project) : process.cwd();
    if (target === "codex" || target === "cursor") {
      await ensureProfile(projectRoot);
    }
    const result = await installAgent(vault, target, { projectRoot });
    if (parsed.stdout || result.command) {
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
  remember <text> [--scope global|project] [--type preference|decision|note|command|session] [--status pending|active] [--project path] [--json]
  search <query> [--project path] [--mode keyword|semantic|hybrid]
                                        Search global and project context
  search <query> --json [--explain]     Print structured search results
  list [--project path|--all-projects] [--status pending|active|archived|expired] [--json]
                                        List stored memories
  pending [--project path|--all-projects] [--json]
                                        List pending automatic memories
  approve <memory-id> [--json]          Approve a pending memory
  archive <memory-id> [--json]          Archive a memory
  expire <memory-id> [--json]           Mark a memory expired
  update-status <status> <memory-id...> Batch update memory lifecycle status
  forget <memory-id> [--json]           Remove a memory by id
  stats [--project path]                Show memory counts
  compact [--project path]              Remove duplicate records from the vault
  agent-card [--json]                   Print the Across Context agent card
  loop-memory-policy [--json]           Print agent-loop memory hook policy
  plugin-manifest [--json]              Print the Across plugin manifest
  plugin-status [--json]                Print host-install and protocol status
  health [--json]                       Probe vault health without external agent setup
  team export [--project path]          Export team-safe project memory as JSON
  hook task-start --query <text> [--project path]
  hook task-end --summary <text> [--project path]
  project learn [path]                  Learn project commands and metadata
  export <agents|claude|cursor|markdown> [--project path] [--stdout]
  install <codex|cursor|claude-code> [--project path] [--stdout]
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

function omitExplanation(result) {
  const { explanation, ...rest } = result;
  return rest;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
