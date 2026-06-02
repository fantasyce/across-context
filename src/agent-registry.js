import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const SUPPORTED_AGENTS = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    projectTargets: ["agents"],
    check: ["codex", ["mcp", "get", "across-context"]],
    register: ["codex", ["mcp", "add", "across-context", "--", "across-context", "mcp"]]
  },
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    projectTargets: ["claude"],
    check: ["claude", ["mcp", "get", "across-context"]],
    register: ["claude", ["mcp", "add", "-s", "user", "across-context", "--", "across-context", "mcp"]]
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    projectTargets: ["cursor"],
    check: null,
    register: null
  },
  {
    id: "hermes",
    name: "Hermes",
    command: "hermes",
    projectTargets: [],
    check: ["hermes", ["mcp", "test", "across-context"]],
    register: ["hermes", ["mcp", "add", "across-context", "--command", "across-context", "--args", "mcp"]]
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    command: "openclaw",
    projectTargets: [],
    check: ["openclaw", ["mcp", "show", "across-context"]],
    register: ["openclaw", ["mcp", "set", "across-context", "{\"command\":\"across-context\",\"args\":[\"mcp\"]}"]]
  }
];

export async function detectSupportedAgents(options = {}) {
  const availableCommands = options.availableCommands || commandsFromEnv(options.env || process.env);
  const agents = [];
  for (const agent of SUPPORTED_AGENTS) {
    const available = availableCommands
      ? availableCommands.has(agent.command)
      : await commandExists(agent.command);
    agents.push({
      id: agent.id,
      name: agent.name,
      command: agent.command,
      available,
      projectTargets: agent.projectTargets,
      registration: agent.register ? formatCommand(agent.register[0], agent.register[1]) : null
    });
  }
  return agents;
}

export function getSupportedAgent(id) {
  return SUPPORTED_AGENTS.find((agent) => agent.id === id);
}

export function normalizeTargets(input) {
  if (!input || !input.length || input.includes("all")) {
    return SUPPORTED_AGENTS.map((agent) => agent.id);
  }
  return input;
}

export async function runAgentRegistration(agent, runCommand = runExternalCommand) {
  if (!agent.register) {
    return { skipped: true, reason: "No external registration command is required." };
  }
  if (agent.check) {
    try {
      const [checkCommand, checkArgs] = agent.check;
      await runCommand(checkCommand, checkArgs);
      return { skipped: true, alreadyConfigured: true, reason: "MCP server is already configured." };
    } catch {
      // Not configured yet; continue with registration.
    }
  }
  const [command, args] = agent.register;
  return runCommand(command, args);
}

export async function runExternalCommand(command, args) {
  const result = await exec(command, args);
  return { stdout: result.stdout, stderr: result.stderr, code: 0 };
}

function commandsFromEnv(env) {
  if (!env.ACROSS_CONTEXT_TEST_COMMANDS) return null;
  return new Set(env.ACROSS_CONTEXT_TEST_COMMANDS.split(",").map((item) => item.trim()).filter(Boolean));
}

async function commandExists(command) {
  try {
    await exec("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}
