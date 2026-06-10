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
  const explained = await exec("node", [cli, "search", "bootstrap", "--mode", "hybrid", "--project", project, "--json", "--explain"], { env });
  const card = await exec("node", [cli, "agent-card", "--json"], { env });
  const loopPolicy = await exec("node", [cli, "loop-memory-policy", "--json"], { env });
  const team = await exec("node", [cli, "team", "export", "--project", project], { env });
  const hook = await exec("node", [cli, "hook", "task-start", "--query", "bootstrap", "--project", project], { env });
  await exec("node", [cli, "remember", "Maybe remember a second review item.", "--auto"], { env });
  const allPending = JSON.parse((await exec("node", [cli, "pending", "--json"], { env })).stdout);
  const batch = await exec("node", [cli, "update-status", "archived", allPending[0].id], { env });

  assert.match(approved.stdout, /active/);
  assert.match(semantic.stdout, /deterministic task-start/);
  assert.ok(JSON.parse(explained.stdout).results[0].explanation.matchedTerms.length > 0);
  assert.equal(JSON.parse(card.stdout).capabilities.memory, true);
  assert.equal(JSON.parse(card.stdout).capabilities.agentLoopMemoryHooks, true);
  assert.equal(JSON.parse(loopPolicy.stdout).defaultWriteStatus, "pending");
  assert.equal(JSON.parse(loopPolicy.stdout).hooks[0].id, "pre_loop_search");
  assert.match(team.stdout, /deterministic task-start/);
  assert.match(hook.stdout, /deterministic task-start/);
  assert.equal(allPending.length, 1);
  assert.match(batch.stdout, /updated: 1/);
});

test("CLI exposes JSON memory lifecycle operations for host apps", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-cli-json-home-"));
  const env = { ...process.env, ACROSS_CONTEXT_HOME: home };

  const created = await exec(
    "node",
    [cli, "remember", "Host apps can review plugin memory.", "--status", "pending", "--json"],
    { env }
  );
  const memory = JSON.parse(created.stdout).memory;
  assert.equal(memory.status, "pending");

  const pending = JSON.parse((await exec("node", [cli, "list", "--status", "pending", "--json"], { env })).stdout);
  assert.deepEqual(pending.map((entry) => entry.id), [memory.id]);

  const approved = JSON.parse((await exec("node", [cli, "approve", memory.id, "--json"], { env })).stdout);
  assert.equal(approved.memory.status, "active");

  const archived = JSON.parse((await exec("node", [cli, "archive", memory.id, "--json"], { env })).stdout);
  assert.equal(archived.memory.status, "archived");

  const forgotten = JSON.parse((await exec("node", [cli, "forget", memory.id, "--json"], { env })).stdout);
  assert.equal(forgotten.forgotten, 1);
});
