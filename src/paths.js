import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export function defaultHome() {
  return process.env.ACROSS_CONTEXT_HOME || resolve(homedir(), ".across-context");
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
