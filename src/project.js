import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nowIso, stableProjectId } from "./paths.js";

const exec = promisify(execFile);

export async function learnProject(projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const timestamp = nowIso();
  const packageJson = await readPackageJson(root);
  const languages = await detectLanguages(root);
  const packageManager = await detectPackageManager(root);
  const commands = await detectCommands(root, packageJson, packageManager);
  const summary = await readReadmeTitle(root);
  const git = await readGitInfo(root);

  return {
    id: stableProjectId(root),
    name: packageJson?.name || basename(root) || "project",
    root,
    relativeRootLabel: packageJson?.name || basename(root) || "project",
    gitRemote: git.remote,
    gitBranch: git.branch,
    languages,
    packageManager,
    commands,
    summary,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function readPackageJson(root) {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

async function detectPackageManager(root) {
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  if (await exists(join(root, "package-lock.json"))) return "npm";
  if (await exists(join(root, "package.json"))) return "npm";
  return undefined;
}

async function detectLanguages(root) {
  const languages = [];
  if (await exists(join(root, "package.json"))) languages.push("TypeScript/JavaScript");
  if (await exists(join(root, "Package.swift"))) languages.push("Swift");
  if (await exists(join(root, "pyproject.toml")) || await exists(join(root, "requirements.txt"))) languages.push("Python");
  if (await exists(join(root, "go.mod"))) languages.push("Go");
  if (await exists(join(root, "Cargo.toml"))) languages.push("Rust");
  return languages;
}

async function detectCommands(root, packageJson, packageManager) {
  const commands = {};
  if (packageJson?.scripts && packageManager) {
    for (const script of ["test", "build", "lint", "check", "dev"]) {
      if (packageJson.scripts[script]) {
        commands[script] = `${packageManager} ${script}`;
      }
    }
  }
  if (await exists(join(root, "Package.swift"))) {
    commands["swift build"] = "swift build";
    commands["swift test"] = "swift test";
  }
  if (await exists(join(root, "pyproject.toml")) || await exists(join(root, "requirements.txt"))) {
    commands.pytest = "python -m pytest";
  }
  return commands;
}

async function readReadmeTitle(root) {
  for (const file of ["README.md", "readme.md"]) {
    try {
      const raw = await readFile(join(root, file), "utf8");
      const heading = raw.split("\n").find((line) => line.startsWith("# "));
      if (heading) return heading.replace(/^#\s+/, "").trim();
    } catch {
      // Continue to next README candidate.
    }
  }
  return undefined;
}

async function readGitInfo(root) {
  try {
    const [remote, branch] = await Promise.all([
      exec("git", ["-C", root, "remote", "get-url", "origin"]).then((r) => r.stdout.trim()).catch(() => undefined),
      exec("git", ["-C", root, "branch", "--show-current"]).then((r) => r.stdout.trim()).catch(() => undefined)
    ]);
    return { remote, branch };
  } catch {
    return {};
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
