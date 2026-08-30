import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { detectAgents, doctorAcrossContext, setupAcrossContext, statusAcrossContext } from "../src/setup.js";

async function tempProject() {
  const home = await mkdtemp(join(tmpdir(), "across-context-setup-home-"));
  const acrossHome = await mkdtemp(join(tmpdir(), "across-context-setup-across-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "across-context-setup-project-"));
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "setup-demo" }));
  return {
    home,
    acrossHome,
    projectRoot,
    env: { ...process.env, HOME: home, ACROSS_HOME: acrossHome },
    vault: new ContextVault({ home })
  };
}

test("detectAgents reports available and missing supported agents", async () => {
  const agents = await detectAgents({
    availableCommands: new Set(["codex", "claude", "cursor"])
  });

  assert.equal(agents.find((agent) => agent.id === "codex").available, true);
  assert.equal(agents.find((agent) => agent.id === "claude").available, true);
  assert.equal(agents.find((agent) => agent.id === "hermes").available, false);
});

test("setupAcrossContext installs project rules and registers available agents", async () => {
  const { acrossHome, env, projectRoot, vault } = await tempProject();
  const commands = [];

  const result = await setupAcrossContext({
    vault,
    projectRoot,
    env,
    targets: ["codex", "claude", "cursor"],
    yes: true,
    availableCommands: new Set(["codex", "claude", "cursor"]),
    runCommand: async (command, args) => {
      if (args.includes("get") || args.includes("test") || args.includes("show")) {
        throw new Error("not configured");
      }
      commands.push([command, ...args].join(" "));
      return { stdout: "", stderr: "", code: 0 };
    }
  });

  assert.equal(result.project.installed.length, 3);
  assert.match(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), /Task start memory lookup/);
  assert.match(await readFile(join(projectRoot, "CLAUDE.md"), "utf8"), /Before final response memory write/);
  assert.match(await readFile(join(projectRoot, ".cursor", "rules", "across-context.mdc"), "utf8"), /Never write secrets/);
  assert.equal((await stat(join(acrossHome, "plugins", "across-context", "package.json"))).isFile(), true);
  assert.ok(commands.some((command) => command.startsWith("codex mcp add across-context")));
  assert.ok(commands.some((command) => command.startsWith("claude mcp add -s user across-context")));
});

test("doctorAcrossContext and statusAcrossContext summarize vault, project, and agent health", async () => {
  const { env, projectRoot, vault } = await tempProject();
  await setupAcrossContext({
    vault,
    projectRoot,
    env,
    targets: ["codex", "cursor"],
    yes: true,
    noExternal: true,
    availableCommands: new Set(["codex", "cursor"])
  });

  const doctor = await doctorAcrossContext({
    vault,
    projectRoot,
    availableCommands: new Set(["codex", "cursor"])
  });
  const status = await statusAcrossContext({
    vault,
    projectRoot,
    availableCommands: new Set(["codex", "cursor"])
  });

  assert.equal(doctor.vault.status, "ok");
  assert.equal(doctor.project.files.AGENTS, "ok");
  assert.equal(status.memories.total, 0);
  assert.equal(status.agents.find((agent) => agent.id === "codex").available, true);
});
