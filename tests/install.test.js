import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const cli = join(process.cwd(), "src", "cli.js");

test("install command prepares agent-specific integration files or commands", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-install-home-"));
  const project = await mkdtemp(join(tmpdir(), "across-context-install-project-"));
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "install-demo" }));
  const env = { ...process.env, ACROSS_CONTEXT_HOME: home };

  await exec("node", [cli, "remember", "Prefer small tests.", "--type", "preference"], { env });
  await exec("node", [cli, "install", "codex", "--project", project], { env });
  await exec("node", [cli, "install", "cursor", "--project", project], { env });
  const { stdout } = await exec("node", [cli, "install", "claude-code", "--stdout"], { env });

  assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /Prefer small tests/);
  assert.match(await readFile(join(project, ".cursor", "mcp.json"), "utf8"), /across-context/);
  assert.match(stdout, /claude mcp add -s user across-context -- across-context mcp/);
});

test("install host-plugin copies the runtime into a hidden plugin directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-host-home-"));
  const acrossHome = await mkdtemp(join(tmpdir(), "across-home-"));
  const env = { ...process.env, ACROSS_CONTEXT_HOME: home };

  const { stdout } = await exec("node", [cli, "install", "host-plugin", "--across-home", acrossHome], { env });

  const installDir = join(acrossHome, "plugins", "across-context");
  const commandPath = join(acrossHome, "bin", "across-context");
  const wrapper = await readFile(commandPath, "utf8");
  const manifest = JSON.parse(await readFile(join(installDir, "manifest.json"), "utf8"));
  const mode = (await stat(commandPath)).mode & 0o777;

  assert.match(stdout, /Installed host plugin/);
  assert.match(await readFile(join(installDir, "src", "cli.js"), "utf8"), /across-context <command>/);
  assert.equal(manifest.id, "across-context");
  assert.equal(manifest.kind, "memory-provider");
  assert.equal(manifest.entrypoints.mcp.command, commandPath);
  assert.equal(mode, 0o755);
  assert.match(wrapper, new RegExp(installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(wrapper, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(manifest), /Documents\/projects/);
});

test("install host-plugin ignores legacy ACROSS_AGENTS_PLUGIN_HOME", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-host-home-"));
  const acrossHome = await mkdtemp(join(tmpdir(), "across-home-"));
  const legacyPluginHome = await mkdtemp(join(tmpdir(), "across-agents-plugin-home-"));
  const env = {
    ...process.env,
    ACROSS_CONTEXT_HOME: home,
    ACROSS_HOME: acrossHome,
    ACROSS_PLUGIN_HOME: "",
    ACROSS_AGENTS_PLUGIN_HOME: legacyPluginHome
  };

  const { stdout } = await exec("node", [cli, "install", "host-plugin"], { env });

  assert.match(stdout, new RegExp(join(acrossHome, "plugins", "across-context").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await assert.rejects(
    stat(join(legacyPluginHome, "across-context")),
    /ENOENT/
  );
});

test("install host-plugin rejects legacy --prefix", async () => {
  const acrossHome = await mkdtemp(join(tmpdir(), "across-home-"));
  const legacyPrefix = await mkdtemp(join(tmpdir(), "across-context-prefix-"));
  const env = { ...process.env, ACROSS_HOME: acrossHome };

  await assert.rejects(
    exec("node", [cli, "install", "host-plugin", "--prefix", legacyPrefix], { env }),
    /--prefix is no longer supported/
  );
});

test("install host-plugin rejects protected roots in product mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-product-home-"));
  const acrossHome = join(home, ".across");
  const protectedRoot = join(home, "Documents", "projects", "across-context-plugin-root");
  const protectedBin = join(home, "Documents", "projects", "across-context-bin");
  const env = {
    ...process.env,
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_HOME: acrossHome
  };

  await assert.rejects(
    exec("node", [
      cli,
      "install",
      "host-plugin",
      "--across-home",
      acrossHome,
      "--plugin-root",
      protectedRoot,
      "--bin-dir",
      protectedBin
    ], { env }),
    /protected user directory/
  );
});

test("install host-plugin ignores protected env roots in product mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-product-env-home-"));
  const protectedRoot = join(home, "Documents", "projects", "across-context-plugin-root");
  const protectedBin = join(home, "Documents", "projects", "across-context-bin");
  const env = {
    ...process.env,
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_PLUGIN_HOME: protectedRoot,
    ACROSS_BIN_HOME: protectedBin
  };

  const { stdout } = await exec("node", [cli, "install", "host-plugin"], { env });

  assert.match(stdout, new RegExp(join(home, ".across", "plugins", "across-context").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(await readFile(join(home, ".across", "bin", "across-context"), "utf8"), new RegExp(join(home, ".across", "plugins", "across-context").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await assert.rejects(
    stat(join(protectedRoot, "across-context")),
    /ENOENT/
  );
  await assert.rejects(
    stat(join(protectedBin, "across-context")),
    /ENOENT/
  );
});

test("install host-plugin accepts similarly named user directories in product mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-adjacent-product-home-"));
  const acrossHome = join(home, ".across");
  const pluginRoot = join(home, "DocumentsArchive", "across-context-plugin-root");
  const binDir = join(home, "DownloadsCache", "across-context-bin");
  const env = {
    ...process.env,
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_HOME: acrossHome
  };

  await exec("node", [
    cli,
    "install",
    "host-plugin",
    "--across-home",
    acrossHome,
    "--plugin-root",
    pluginRoot,
    "--bin-dir",
    binDir
  ], { env });

  assert.equal(JSON.parse(await readFile(join(pluginRoot, "across-context", "manifest.json"), "utf8")).id, "across-context");
  assert.match(await readFile(join(binDir, "across-context"), "utf8"), new RegExp(pluginRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("install host-plugin allows protected roots only in developer mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-dev-home-"));
  const acrossHome = join(home, ".across");
  const protectedRoot = join(home, "Documents", "projects", "across-context-plugin-root");
  const protectedBin = join(home, "Documents", "projects", "across-context-bin");
  const env = {
    ...process.env,
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_CONTEXT_DEVELOPER_MODE: "1",
    ACROSS_HOME: acrossHome
  };

  await exec("node", [
    cli,
    "install",
    "host-plugin",
    "--across-home",
    acrossHome,
    "--plugin-root",
    protectedRoot,
    "--bin-dir",
    protectedBin
  ], { env });

  assert.match(await readFile(join(protectedBin, "across-context"), "utf8"), new RegExp(protectedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(JSON.parse(await readFile(join(protectedRoot, "across-context", "manifest.json"), "utf8")).id, "across-context");
});
