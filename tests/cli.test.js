import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const cli = join(process.cwd(), "src", "cli.js");

test("CLI remembers, searches, learns, and exports context", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-cli-home-"));
  const project = await mkdtemp(join(tmpdir(), "across-context-cli-project-"));
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "cli-demo" }));

  const env = { ...process.env, ACROSS_CONTEXT_HOME: home };
  await exec("node", [cli, "init"], { env });
  await exec("node", [cli, "remember", "Always run tests before final answers.", "--type", "preference"], { env });
  await exec("node", [cli, "remember", "Use npm test for this repo.", "--scope", "project", "--project", project, "--type", "command"], { env });
  const { stdout } = await exec("node", [cli, "search", "tests", "--project", project], { env });
  await exec("node", [cli, "project", "learn", project], { env });
  await exec("node", [cli, "export", "agents", "--project", project], { env });

  assert.match(stdout, /Always run tests/);
  assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /Use npm test/);
});
