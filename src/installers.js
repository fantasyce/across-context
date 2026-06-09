import { fileURLToPath } from "node:url";
import { access, chmod, cp, mkdir, realpath, rm, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exportContext } from "./exporters.js";
import { COMPONENT_ID, ecosystemBinDir, ecosystemHome, pluginRoot } from "./paths.js";
import { renderPluginManifest } from "./plugin-manifest.js";

const HOST_PLUGIN_PACKAGE_ENTRIES = [
  "src",
  "examples",
  "assets/readme",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "package.json"
];
const PACKAGE_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export async function installAgent(vault, target, options = {}) {
  if (target === "codex") {
    return exportContext(vault, {
      projectRoot: resolve(options.projectRoot || process.cwd()),
      target: "agents"
    });
  }
  if (target === "cursor") {
    const projectRoot = resolve(options.projectRoot || process.cwd());
    const mcpPath = join(projectRoot, ".cursor", "mcp.json");
    const payload = {
      mcpServers: {
        "across-context": {
          command: "across-context",
          args: ["mcp"]
        }
      }
    };
    await mkdir(dirname(mcpPath), { recursive: true });
    await writeFile(mcpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await exportContext(vault, { projectRoot, target: "cursor" });
    return { path: mcpPath, target: "cursor" };
  }
  if (target === "claude-code" || target === "claude") {
    return {
      target: "claude-code",
      command: "claude mcp add -s user across-context -- across-context mcp"
    };
  }
  throw new Error(`Unknown install target: ${target}`);
}

export async function installHostPlugin(options = {}) {
  const sourceRoot = resolve(options.sourceRoot || PACKAGE_ROOT);
  const env = options.env || process.env;
  const acrossHome = resolve(options.acrossHome || ecosystemHome(env));
  const legacyPrefix = options.prefix && !options.pluginRoot && !options.acrossHome;
  const root = resolve(
    options.pluginRoot
    || options.prefix
    || env.ACROSS_PLUGIN_HOME
    || env.ACROSS_AGENTS_PLUGIN_HOME
    || pluginRoot({ ...env, ACROSS_HOME: acrossHome })
  );
  const binDir = resolve(
    options.binDir
    || (legacyPrefix ? join(root, "bin") : ecosystemBinDir({ ...env, ACROSS_HOME: acrossHome }))
  );
  const installDir = join(root, COMPONENT_ID);
  const commandPath = join(binDir, "across-context");
  const sourceReal = await realpathOrResolve(sourceRoot);
  const installReal = await realpathOrResolve(installDir);

  if (sourceReal !== installReal) {
    const tmpDir = `${installDir}.tmp-${process.pid}-${Date.now()}`;
    try {
      await rm(tmpDir, { recursive: true, force: true });
      await mkdir(tmpDir, { recursive: true });
      for (const entry of HOST_PLUGIN_PACKAGE_ENTRIES) {
        await copyPackageEntry(sourceRoot, tmpDir, entry);
      }
      await rm(installDir, { recursive: true, force: true });
      await rename(tmpDir, installDir);
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true });
      throw error;
    }
  }

  await mkdir(binDir, { recursive: true });
  await writeFile(commandPath, `#!/bin/sh\nexec /usr/bin/env node ${shellQuote(join(installDir, "src", "cli.js"))} "$@"\n`, "utf8");
  await chmod(commandPath, 0o755);
  await writeFile(
    join(installDir, "manifest.json"),
    `${JSON.stringify(await renderPluginManifest({ acrossHome, commandPath, installDir, sourceRoot }), null, 2)}\n`,
    "utf8"
  );

  return {
    target: "host-plugin",
    prefix: root,
    acrossHome,
    installDir,
    binDir,
    commandPath
  };
}

async function copyPackageEntry(sourceRoot, targetRoot, entry) {
  const source = join(sourceRoot, entry);
  if (!(await pathExists(source))) return;
  const target = join(targetRoot, entry);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function realpathOrResolve(path) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
