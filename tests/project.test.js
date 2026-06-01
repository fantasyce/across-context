import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { learnProject } from "../src/project.js";

test("learnProject detects JavaScript project commands and package manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "across-context-project-"));
  await writeFile(join(root, "pnpm-lock.yaml"), "");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "demo-app",
      scripts: {
        test: "vitest run",
        build: "tsc -p tsconfig.json"
      }
    })
  );
  await writeFile(join(root, "README.md"), "# Demo App\n\nA tiny app.");

  const profile = await learnProject(root);

  assert.equal(profile.name, "demo-app");
  assert.equal(profile.packageManager, "pnpm");
  assert.equal(profile.commands.test, "pnpm test");
  assert.equal(profile.commands.build, "pnpm build");
  assert.equal(profile.summary, "Demo App");
  assert.ok(profile.languages.includes("TypeScript/JavaScript"));
});

test("learnProject detects Swift and Python project commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "across-context-polyglot-"));
  await mkdir(join(root, "Sources"), { recursive: true });
  await writeFile(join(root, "Package.swift"), "// swift-tools-version: 5.9\n");
  await writeFile(join(root, "pyproject.toml"), "[project]\nname='demo'\n");

  const profile = await learnProject(root);

  assert.ok(profile.languages.includes("Swift"));
  assert.ok(profile.languages.includes("Python"));
  assert.equal(profile.commands["swift build"], "swift build");
  assert.equal(profile.commands.pytest, "python -m pytest");
});
