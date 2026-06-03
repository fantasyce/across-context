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

test("CLI reviews pending memories, exports agent card, and runs hooks", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-cli-v2-home-"));
  const project = await mkdtemp(join(tmpdir(), "across-context-cli-v2-project-"));
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "v2-demo" }));
  const env = { ...process.env, ACROSS_CONTEXT_HOME: home };

  await exec("node", [cli, "remember", "Maybe remember a temporary UI experiment.", "--auto"], { env });
  const pending = await exec("node", [cli, "pending", "--json"], { env });
  const pendingMemories = JSON.parse(pending.stdout);
  const approved = await exec("node", [cli, "approve", pendingMemories[0].id], { env });
  await exec("node", [cli, "remember", "Use deterministic task-start hooks.", "--scope", "project", "--project", project, "--type", "command", "--visibility", "team"], { env });
  const semantic = await exec("node", [cli, "search", "agent bootstrap context", "--mode", "semantic", "--project", project], { env });
  const card = await exec("node", [cli, "agent-card", "--json"], { env });
  const team = await exec("node", [cli, "team", "export", "--project", project], { env });
  const hook = await exec("node", [cli, "hook", "task-start", "--query", "bootstrap", "--project", project], { env });

  assert.match(approved.stdout, /active/);
  assert.match(semantic.stdout, /deterministic task-start/);
  assert.equal(JSON.parse(card.stdout).capabilities.memory, true);
  assert.match(team.stdout, /deterministic task-start/);
  assert.match(hook.stdout, /deterministic task-start/);
});
