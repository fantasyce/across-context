import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_MS = 60_000;
const DEFAULT_RETRY_MS = 10;

export async function withFileLock(lockPath, task, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const staleMs = Number(options.staleMs || DEFAULT_STALE_MS);
  const retryMs = Number(options.retryMs || DEFAULT_RETRY_MS);
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });

  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await isStaleLock(lockPath, staleMs)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const owner = await readFile(lockPath, "utf8").catch(() => "unknown owner");
        throw new Error(`Timed out waiting for lock ${lockPath}: ${owner}`);
      }
      await delay(retryMs);
    }
  }

  try {
    return await task();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
  }
}

export async function atomicWriteFile(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function isStaleLock(lockPath, staleMs) {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > staleMs;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
