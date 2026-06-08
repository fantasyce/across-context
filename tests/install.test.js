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
});
