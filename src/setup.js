import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  detectSupportedAgents,
  getSupportedAgent,
  normalizeTargets,
  runAgentRegistration
} from "./agent-registry.js";
import { exportContext } from "./exporters.js";
import { installAgent } from "./installers.js";

export async function detectAgents(options = {}) {
  return detectSupportedAgents(options);
}

export async function setupAcrossContext(options = {}) {
  const vault = options.vault;
  if (!vault) throw new Error("vault is required");
  const projectRoot = resolve(options.projectRoot || process.cwd());
  const targets = normalizeTargets(options.targets);
  const agents = await detectAgents(options);
  await vault.init();

  const project = { root: projectRoot, installed: [] };
  for (const target of targets) {
    const agent = getSupportedAgent(target);
    if (!agent) continue;
    for (const projectTarget of agent.projectTargets) {
      if (projectTarget === "agents") {
        const result = await installAgent(vault, "codex", { projectRoot });
        project.installed.push({ agent: target, target: projectTarget, path: result.path });
      } else if (projectTarget === "cursor") {
        const result = await installAgent(vault, "cursor", { projectRoot });
        project.installed.push({ agent: target, target: projectTarget, path: result.path });
      } else {
        const result = await exportContext(vault, { projectRoot, target: projectTarget });
        project.installed.push({ agent: target, target: projectTarget, path: result.path });
      }
    }
  }

  const registrations = [];
  for (const target of targets) {
    const agent = getSupportedAgent(target);
    if (!agent) continue;
    const detected = agents.find((item) => item.id === target);
    if (!detected?.available) {
      registrations.push({ agent: target, status: "missing", command: detected?.registration || null });
      continue;
    }
    if (options.noExternal) {
      registrations.push({ agent: target, status: "skipped", reason: "External registration disabled." });
      continue;
    }
    if (!options.yes) {
      registrations.push({ agent: target, status: "planned", command: detected.registration });
      continue;
    }
    try {
      const result = await runAgentRegistration(agent, options.runCommand);
      registrations.push({ agent: target, status: result.skipped ? "skipped" : "registered", result });
    } catch (error) {
      registrations.push({ agent: target, status: "failed", error: error.message });
    }
  }

  return {
    home: vault.home,
    project,
    agents,
    registrations
  };
}

export async function doctorAcrossContext(options = {}) {
  const vault = options.vault;
  if (!vault) throw new Error("vault is required");
  const projectRoot = resolve(options.projectRoot || process.cwd());
  await vault.init();
  const agents = await detectAgents(options);
  return {
    vault: { status: "ok", home: vault.home },
    project: {
      root: projectRoot,
      files: {
        AGENTS: await fileStatus(join(projectRoot, "AGENTS.md")),
        CLAUDE: await fileStatus(join(projectRoot, "CLAUDE.md")),
        CURSOR: await fileStatus(join(projectRoot, ".cursor", "rules", "across-context.mdc")),
        CURSOR_MCP: await fileStatus(join(projectRoot, ".cursor", "mcp.json"))
      }
    },
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      available: agent.available,
      status: agent.available ? "available" : "missing",
      registration: agent.registration
    }))
  };
}

export async function statusAcrossContext(options = {}) {
  const vault = options.vault;
  if (!vault) throw new Error("vault is required");
  const agents = await detectAgents(options);
  const memories = await vault.stats({ projectRoot: options.projectRoot });
  return {
    home: vault.home,
    memories,
    agents
  };
}

async function fileStatus(path) {
  try {
    await access(path);
    return "ok";
  } catch {
    return "missing";
  }
}

