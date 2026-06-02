import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exportContext } from "./exporters.js";

export async function installAgent(vault, target, options = {}) {
  if (target === "codex") {
    return exportContext(vault, {
      projectRoot: resolve(options.projectRoot || process.cwd()),
      target: "agents"
    });
  }
  if (target === "cursor") {
    const projectRoot = resolve(options.projectRoot || process.cwd());
    const mcpPath = join(projectRoot, ".cursor", "mcp.json");
    const payload = {
      mcpServers: {
        "across-context": {
          command: "across-context",
          args: ["mcp"]
        }
      }
    };
    await mkdir(dirname(mcpPath), { recursive: true });
    await writeFile(mcpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await exportContext(vault, { projectRoot, target: "cursor" });
    return { path: mcpPath, target: "cursor" };
  }
  if (target === "claude-code" || target === "claude") {
    return {
      target: "claude-code",
      command: "claude mcp add -s user across-context -- across-context mcp"
    };
  }
  throw new Error(`Unknown install target: ${target}`);
}
