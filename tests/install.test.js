import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  assert.match(stdout, /claude mcp add across-context -- across-context mcp/);
});
