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

test("CLI sets up integrations and manages vault records", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-cli-automation-home-"));
  const project = await mkdtemp(join(tmpdir(), "across-context-cli-automation-project-"));
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "automation-demo" }));
  const env = {
    ...process.env,
    ACROSS_CONTEXT_HOME: home,
    ACROSS_CONTEXT_TEST_COMMANDS: "codex,claude,cursor"
  };

  const setup = await exec("node", [cli, "setup", "--all", "--yes", "--no-external", "--project", project], { env });
  await exec("node", [cli, "remember", "Prefer automated memory setup.", "--type", "preference"], { env });
  const list = await exec("node", [cli, "list", "--json"], { env });
  const memories = JSON.parse(list.stdout);
  const stats = await exec("node", [cli, "stats"], { env });
  const doctor = await exec("node", [cli, "doctor", "--project", project], { env });
  const status = await exec("node", [cli, "status", "--project", project], { env });
  const compact = await exec("node", [cli, "compact"], { env });
  const forgotten = await exec("node", [cli, "forget", memories[0].id], { env });

  assert.match(setup.stdout, /Setup complete/);
  assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /Task start memory lookup/);
  assert.match(stats.stdout, /total: 1/);
  assert.match(doctor.stdout, /vault: ok/);
  assert.match(status.stdout, /agents:/);
  assert.match(compact.stdout, /removed:/);
  assert.match(forgotten.stdout, /forgotten: 1/);
});
