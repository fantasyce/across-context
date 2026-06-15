import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const COMPONENT_ID = "across-context";

export function ecosystemHome(env = process.env) {
  const configured = runtimeOverrideAllowed(env.ACROSS_HOME, env) ? env.ACROSS_HOME : "";
  return resolve(expandHome(configured || join(userHome(env), ".across"), env));
}

export function componentDataHome(componentId = COMPONENT_ID, env = process.env) {
  return resolve(ecosystemHome(env), "data", componentId);
}

export function pluginRoot(env = process.env) {
  const configured = runtimeOverrideAllowed(env.ACROSS_PLUGIN_HOME, env) ? env.ACROSS_PLUGIN_HOME : "";
  return resolve(expandHome(configured || join(ecosystemHome(env), "plugins"), env));
}

export function ecosystemBinDir(env = process.env) {
  const configured = runtimeOverrideAllowed(env.ACROSS_BIN_HOME, env) ? env.ACROSS_BIN_HOME : "";
  return resolve(expandHome(configured || join(ecosystemHome(env), "bin"), env));
}

export function defaultHome(env = process.env) {
  const configured = runtimeOverrideAllowed(env.ACROSS_CONTEXT_HOME, env) ? env.ACROSS_CONTEXT_HOME : "";
  return resolve(expandHome(configured || componentDataHome(COMPONENT_ID, env), env));
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

function runtimeOverrideAllowed(value, env) {
  if (!value || !String(value).trim()) return false;
  if (!isProductMode(env) || isDeveloperMode(env)) return true;
  return !containsProtectedUserReference(value, env);
}

function isProductMode(env) {
  return truthy(env.ACROSS_CONTEXT_PRODUCT_MODE) || truthy(env.ACROSS_AGENTS_PRODUCT_MODE);
}

function isDeveloperMode(env) {
  return truthy(env.ACROSS_CONTEXT_DEVELOPER_MODE) || truthy(env.ACROSS_AGENTS_DEVELOPER_MODE);
}

function truthy(value) {
  return ["1", "true", "yes", "on", "y"].includes(String(value || "").trim().toLowerCase());
}

function containsProtectedUserReference(value, env) {
  const expanded = resolve(expandHome(String(value || ""), env));
  const protectedRoots = ["Documents", "Desktop", "Downloads"].map((name) => join(userHome(env), name));
  if (protectedRoots.some((root) => pathIsAtOrBelow(expanded, root))) return true;
  return /(?:~|\/Users\/[^/]+)\/(Documents|Desktop|Downloads)(?:\/|$)/.test(String(value || ""));
}

function pathIsAtOrBelow(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function expandHome(value, env) {
  const text = String(value || "");
  if (text === "~") return userHome(env);
  if (text.startsWith("~/")) return join(userHome(env), text.slice(2));
  return text;
}

function userHome(env) {
  return resolve(env.HOME || homedir());
}
