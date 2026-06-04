import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { exportContext, renderContextDocument } from "../src/exporters.js";
import { ContextVault } from "../src/vault.js";

async function seededVault() {
  const home = await mkdtemp(join(tmpdir(), "across-context-export-"));
  const projectRoot = join(home, "workspace", "demo-app");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "demo-app" }));
  const vault = new ContextVault({ home });
  await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer small commits with tests."
  });
  await vault.remember({
    scope: "project",
    type: "decision",
    text: "Do not rewrite the native shell without approval.",
    projectRoot
  });
  return { vault, projectRoot };
}

test("renderContextDocument renders an AGENTS.md compatible context document", async () => {
  const { vault, projectRoot } = await seededVault();

  const document = await renderContextDocument(vault, {
    projectRoot,
    target: "agents"
  });

  assert.match(document, /# Agent Context/);
  assert.match(document, /Prefer small commits with tests/);
  assert.match(document, /Do not rewrite the native shell/);
  assert.match(document, /MCP resources and prompts/i);
  assert.match(document, /Search explanations/i);
  assert.match(document, /pending review/i);
  assert.doesNotMatch(document, new RegExp(projectRoot.replaceAll("/", "\\/")));
});

test("exportContext writes target-specific files", async () => {
  const { vault, projectRoot } = await seededVault();

  const agents = await exportContext(vault, { projectRoot, target: "agents" });
  const claude = await exportContext(vault, { projectRoot, target: "claude" });
  const cursor = await exportContext(vault, { projectRoot, target: "cursor" });

  assert.ok(agents.path.endsWith("AGENTS.md"));
  assert.ok(claude.path.endsWith("CLAUDE.md"));
  assert.ok(cursor.path.endsWith(".cursor/rules/across-context.mdc"));
  assert.match(await readFile(agents.path, "utf8"), /Agent Context/);
  assert.match(await readFile(cursor.path, "utf8"), /alwaysApply: true/);
});
