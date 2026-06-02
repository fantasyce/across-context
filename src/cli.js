#!/usr/bin/env node
import { resolve } from "node:path";
import { ContextVault } from "./vault.js";
import { learnProject } from "./project.js";
import { exportContext, renderContextDocument } from "./exporters.js";
import { installAgent } from "./installers.js";
import { doctorAcrossContext, setupAcrossContext, statusAcrossContext } from "./setup.js";

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
      source: "cli"
    });
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
      includeGlobal: true
    });
    if (!results.length) {
      console.log("No matching context found.");
      return;
    }
    for (const result of results) {
      console.log(`[${result.entry.scope}/${result.entry.type}] ${result.entry.text}`);
    }
    return;
  }

  if (command === "list") {
    const parsed = parseArgs(rest);
    const memories = await vault.listMemories({
      projectRoot: parsed.project,
      includeGlobal: true
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
      throw new Error("Usage: across-context install <codex|cursor|claude-code> [--project path] [--stdout]");
    }
    const parsed = parseArgs(installRest);
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
  remember <text> [--scope global|project] [--type preference|decision|note|command|session] [--project path]
  search <query> [--project path]       Search global and project context
  list [--project path] [--json]        List stored memories
  forget <memory-id>                    Remove a memory by id
  stats [--project path]                Show memory counts
  compact [--project path]              Remove duplicate records from the vault
  project learn [path]                  Learn project commands and metadata
  export <agents|claude|cursor|markdown> [--project path] [--stdout]
  install <codex|cursor|claude-code> [--project path] [--stdout]
  setup [--all] [--yes] [--no-external] [--project path]
  doctor [--project path]               Verify vault, project files, and local agent availability
  status [--project path]               Show vault and agent summary
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

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
