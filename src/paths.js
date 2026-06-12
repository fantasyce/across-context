import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const COMPONENT_ID = "across-context";

export function ecosystemHome(env = process.env) {
  return resolve(env.ACROSS_HOME || join(homedir(), ".across"));
}

export function componentDataHome(componentId = COMPONENT_ID, env = process.env) {
  return resolve(ecosystemHome(env), "data", componentId);
}

export function pluginRoot(env = process.env) {
  return resolve(env.ACROSS_PLUGIN_HOME || join(ecosystemHome(env), "plugins"));
}

export function ecosystemBinDir(env = process.env) {
  return resolve(env.ACROSS_BIN_HOME || join(ecosystemHome(env), "bin"));
}

export function defaultHome(env = process.env) {
  return resolve(env.ACROSS_CONTEXT_HOME || componentDataHome(COMPONENT_ID, env));
}

export function nowIso() {
  return new Date().toISOString();
}

export function newMemoryId() {
  return `mem_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export function stableProjectId(projectRoot) {
  const root = resolve(projectRoot);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const name = basename(root).replace(/[^a-zA-Z0-9._-]+/g, "-") || "project";
  return `${name}-${hash}`;
}

export function projectName(projectRoot) {
  return basename(resolve(projectRoot)) || "project";
}

export function splitTags(tags = []) {
  if (Array.isArray(tags)) {
    return tags.flatMap((tag) => String(tag).split(",")).map((tag) => tag.trim()).filter(Boolean);
  }
  return String(tags).split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function normalizeScope(scope = "global") {
  if (scope !== "global" && scope !== "project") {
    throw new Error(`Invalid scope: ${scope}`);
  }
  return scope;
}

export function normalizeMemoryType(type = "note") {
  const allowed = new Set(["preference", "decision", "note", "command", "session"]);
  if (!allowed.has(type)) {
    throw new Error(`Invalid memory type: ${type}`);
  }
  return type;
}
