import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const cli = join(process.cwd(), "src", "cli.js");

test("plugin-manifest exposes the Across host runtime contract", async () => {
  const acrossHome = await mkdtemp(join(tmpdir(), "across-context-plugin-home-"));
  const { stdout } = await exec("node", [cli, "plugin-manifest", "--json", "--across-home", acrossHome]);
  const manifest = JSON.parse(stdout);

  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.pluginApiVersion, "2026-06-10");
  assert.equal(manifest.id, "across-context");
  assert.equal(manifest.kind, "memory-provider");
  assert.equal(manifest.capabilities.agentLoopMemoryHooksV2, true);
  assert.equal(manifest.capabilities.pendingLoopSummaries, true);
  assert.equal(manifest.capabilities.allProjectPendingReview, true);
  assert.equal(manifest.entrypoints.mcp.transport, "stdio");
  assert.equal(manifest.entrypoints.mcp.args[0], "mcp");
  assert.equal(manifest.entrypoints.status.args[0], "plugin-status");
  assert.equal(manifest.lifecycle.uninstall.args[0], "uninstall");
  assert.equal(manifest.lifecycle.uninstall.preservesData, true);
  assert.equal(manifest.permissions.filesystem[0].access, "read-write");
  assert.equal(manifest.compatibility.requiredHostVersion, ">=0.6.0");
  assert.equal(manifest.paths.plugin, join(acrossHome, "plugins", "across-context"));
  assert.equal(manifest.paths.data, join(acrossHome, "data", "across-context"));
});

test("plugin-status reports managed install availability", async () => {
  const acrossHome = await mkdtemp(join(tmpdir(), "across-context-status-home-"));
  const env = { ...process.env, ACROSS_HOME: acrossHome };

  const before = JSON.parse((await exec("node", [cli, "plugin-status", "--json"], { env })).stdout);
  assert.equal(before.installed, false);
  assert.equal(before.available, false);
  assert.equal(before.install.installDir, join(acrossHome, "plugins", "across-context"));

  await exec("node", [cli, "install", "host-plugin", "--across-home", acrossHome], { env });
  const after = JSON.parse((await exec(join(acrossHome, "bin", "across-context"), ["plugin-status", "--json"], { env })).stdout);
  const manifest = JSON.parse(await readFile(join(acrossHome, "plugins", "across-context", "manifest.json"), "utf8"));

  assert.equal(after.installed, true);
  assert.equal(after.available, true);
  assert.equal(after.manifestExists, true);
  assert.equal(manifest.entrypoints.health.args[0], "health");
  assert.deepEqual(after.lifecycle.actions, ["install", "upgrade", "repair", "uninstall"]);
  assert.equal(manifest.paths.data, join(acrossHome, "data", "across-context"));

  await exec(join(acrossHome, "bin", "across-context"), ["uninstall", "host-plugin", "--across-home", acrossHome], { env });
  const uninstalled = JSON.parse((await exec("node", [cli, "plugin-status", "--json"], { env })).stdout);
  assert.equal(uninstalled.installed, false);
  assert.equal(uninstalled.available, false);
});

test("product plugin-status ignores protected explicit runtime roots", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-product-home-"));
  const protectedRoot = join(home, "Documents", "projects", "across-context-runtime");
  const env = {
    ...process.env,
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1"
  };

  const status = JSON.parse((await exec("node", [
    cli,
    "plugin-status",
    "--json",
    "--across-home",
    join(protectedRoot, "home"),
    "--plugin-root",
    join(protectedRoot, "plugins"),
    "--bin-dir",
    join(protectedRoot, "bin")
  ], { env })).stdout);

  assert.equal(status.command, join(home, ".across", "bin", "across-context"));
  assert.equal(status.dataPath, join(home, ".across", "data", "across-context"));
  assert.equal(status.install.installDir, join(home, ".across", "plugins", "across-context"));
  assert.ok(!JSON.stringify(status).includes("Documents"));
});

test("health initializes the local vault without requiring agent setup", async () => {
  const acrossHome = await mkdtemp(join(tmpdir(), "across-context-health-home-"));
  const env = { ...process.env, ACROSS_HOME: acrossHome };

  const health = JSON.parse((await exec("node", [cli, "health", "--json"], { env })).stdout);

  assert.equal(health.status, "ok");
  assert.equal(health.pluginId, "across-context");
  assert.equal(health.home, join(acrossHome, "data", "across-context"));
  assert.equal(health.memories, 0);
});
