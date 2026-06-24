import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  COMPONENT_ID,
  componentDataHome,
  ecosystemBinDir,
  ecosystemHome,
  pluginRoot
} from "./paths.js";

const PACKAGE_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export async function renderPluginManifest(options = {}) {
  const env = options.env || process.env;
  const homeEnv = options.acrossHome ? { ...env, ACROSS_HOME: options.acrossHome } : env;
  const acrossHome = resolve(ecosystemHome(homeEnv));
  const envWithHome = { ...homeEnv, ACROSS_HOME: acrossHome };
  const pluginEnv = options.pluginRoot ? { ...envWithHome, ACROSS_PLUGIN_HOME: options.pluginRoot } : envWithHome;
  const binEnv = options.binDir ? { ...envWithHome, ACROSS_BIN_HOME: options.binDir } : envWithHome;
  const pluginRootPath = resolve(pluginRoot(pluginEnv));
  const binDir = resolve(ecosystemBinDir(binEnv));
  const installDir = resolve(options.installDir || join(pluginRootPath, COMPONENT_ID));
  const commandPath = resolve(options.commandPath || join(binDir, "across-context"));
  const publicPaths = options.publicPaths === true;
  const manifestCommandPath = publicPaths ? userRelativeAcrossPath(commandPath, envWithHome) : commandPath;
  const packageJson = await readPackageJson(options.sourceRoot || PACKAGE_ROOT);

  return {
    schemaVersion: "1.0",
    pluginApiVersion: "2026-06-10",
    id: COMPONENT_ID,
    displayName: "Across Context",
    kind: "memory-provider",
    version: packageJson.version || "0.0.0",
    description: "Local-first shared memory provider for coding agents.",
    capabilities: {
      memory: true,
      semanticSearch: true,
      pendingApproval: true,
      agentLoopMemoryHooks: true,
      agentLoopMemoryHooksV2: true,
      pendingLoopSummaries: true,
      contextPacks: true,
      agentPluginContextPacks: true,
      allProjectPendingReview: true,
      lifecycle: true,
      dashboard: true,
      localFirst: true
    },
    compatibility: {
      requiredHostVersion: ">=0.6.0",
      pluginApiVersion: "2026-06-10",
      compatiblePluginApiVersions: ["2026-06-10"]
    },
    permissions: {
      filesystem: [
        { path: "~/.across/data/across-context", access: "read-write", reason: "Shared memory vault" },
        { path: "~/.across/plugins/across-context", access: "read", reason: "Managed plugin runtime" }
      ],
      network: [],
      secrets: []
    },
    diagnostics: {
      startupSafe: true,
      startsProcess: false,
      statusCommandSafeAtStartup: true,
      healthMayInitializeVault: true
    },
    lifecycle: {
      install: {
        hostManaged: true,
        command: manifestCommandPath,
        args: ["install", "host-plugin"],
        idempotent: true
      },
      upgrade: {
        hostManaged: true,
        strategy: "reinstall"
      },
      repair: {
        hostManaged: true,
        strategy: "reinstall"
      },
      uninstall: {
        hostManaged: true,
        command: manifestCommandPath,
        args: ["uninstall", "host-plugin"],
        removesRuntime: true,
        preservesData: true
      }
    },
    entrypoints: {
      cli: {
        command: manifestCommandPath
      },
      mcp: {
        command: manifestCommandPath,
        args: ["mcp"],
        transport: "stdio"
      },
      dashboard: {
        command: manifestCommandPath,
        args: ["dashboard"]
      },
      agentCard: {
        command: manifestCommandPath,
        args: ["agent-card", "--json"]
      },
      status: {
        command: manifestCommandPath,
        args: ["plugin-status", "--json"]
      },
      health: {
        command: manifestCommandPath,
        args: ["health", "--json"]
      },
      contextPacks: {
        command: manifestCommandPath,
        args: ["context-packs", "--all-projects", "--json"]
      }
    },
    protocols: {
      mcp: {
        transport: "stdio",
        tools: {
          searchContext: "search_context",
          rememberContext: "remember_context",
          getAgentLoopMemoryPolicy: "get_agent_loop_memory_policy"
        },
        resources: true,
        prompts: {
          taskStartContext: "task-start-context",
          taskEndSummary: "task-end-summary",
          memoryReview: "memory-review",
          agentLoopMemoryPolicy: "agent-loop-memory-policy"
        }
      },
      cli: {
        command: manifestCommandPath
      },
      a2a: {
        role: "memory-context-provider",
        discoveryReady: true
      }
    },
    paths: {
      plugin: publicPaths ? userRelativeAcrossPath(installDir, envWithHome) : installDir,
      bin: publicPaths ? userRelativeAcrossPath(binDir, envWithHome) : binDir,
      data: publicPaths ? userRelativeAcrossPath(componentDataHome(COMPONENT_ID, envWithHome), envWithHome) : componentDataHome(COMPONENT_ID, envWithHome),
      config: publicPaths ? userRelativeAcrossPath(join(acrossHome, "config", COMPONENT_ID), envWithHome) : join(acrossHome, "config", COMPONENT_ID),
      run: publicPaths ? userRelativeAcrossPath(join(acrossHome, "run", COMPONENT_ID), envWithHome) : join(acrossHome, "run", COMPONENT_ID),
      logs: publicPaths ? userRelativeAcrossPath(join(acrossHome, "logs", COMPONENT_ID), envWithHome) : join(acrossHome, "logs", COMPONENT_ID),
      cache: publicPaths ? userRelativeAcrossPath(join(acrossHome, "cache", COMPONENT_ID), envWithHome) : join(acrossHome, "cache", COMPONENT_ID)
    },
    environment: {
      ecosystemHome: "ACROSS_HOME",
      dataOverride: "ACROSS_CONTEXT_HOME",
      pluginRoot: "ACROSS_PLUGIN_HOME",
      binHome: "ACROSS_BIN_HOME"
    }
  };
}

function userRelativeAcrossPath(path, env) {
  const home = resolve(env.HOME || process.env.HOME || "");
  const defaultAcrossHome = resolve(home, ".across");
  const resolved = resolve(path);
  if (resolved === defaultAcrossHome) return "~/.across";
  if (resolved.startsWith(`${defaultAcrossHome}/`)) {
    return `~/.across/${resolved.slice(defaultAcrossHome.length + 1)}`;
  }
  return resolved;
}

export async function renderPluginStatus(options = {}) {
  const manifest = await renderPluginManifest(options);
  const manifestPath = join(manifest.paths.plugin, "manifest.json");
  const commandExists = await pathExists(manifest.entrypoints.cli.command);
  const manifestExists = await pathExists(manifestPath);
  const dataExists = await pathExists(manifest.paths.data);
  const installed = commandExists || manifestExists;

  return {
    pluginId: COMPONENT_ID,
    status: installed ? "installed" : "not_installed",
    installed,
    available: commandExists,
    manifestPath,
    manifestExists,
    command: manifest.entrypoints.cli.command,
    commandExists,
    dataPath: manifest.paths.data,
    dataExists,
    protocols: Object.keys(manifest.protocols),
    capabilities: manifest.capabilities,
    install: {
      installable: true,
      command: "across-context install host-plugin",
      installDir: manifest.paths.plugin
    },
    lifecycle: {
      actions: ["install", "upgrade", "repair", "uninstall"],
      preservesDataOnUninstall: true
    }
  };
}

export async function renderHealth(vault, options = {}) {
  await vault.init();
  const stats = await vault.stats({ projectRoot: options.projectRoot });
  return {
    status: "ok",
    pluginId: COMPONENT_ID,
    home: vault.home,
    memories: stats.total,
    timestamp: new Date().toISOString()
  };
}

async function readPackageJson(sourceRoot) {
  try {
    return JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
