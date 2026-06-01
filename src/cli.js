#!/usr/bin/env node
import { resolve } from "node:path";
import { ContextVault } from "./vault.js";
import { learnProject } from "./project.js";
import { exportContext, renderContextDocument } from "./exporters.js";
import { installAgent } from "./installers.js";

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
  project learn [path]                  Learn project commands and metadata
  export <agents|claude|cursor|markdown> [--project path] [--stdout]
  install <codex|cursor|claude-code> [--project path] [--stdout]
  mcp                                   Start MCP stdio server
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
