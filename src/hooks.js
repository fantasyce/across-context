export async function runHook(vault, input = {}) {
  const name = input.name;
  if (name === "task-start") {
    const results = await vault.search({
      query: input.query || "project context",
      projectRoot: input.projectRoot,
      mode: input.mode || "hybrid",
      limit: input.limit || 8,
      includeGlobal: true,
      status: "active"
    });
    const memories = results.map((result) => result.entry);
    return {
      name,
      memories,
      text: memories.map((entry) => `- (${entry.scope}/${entry.type}) ${entry.text}`).join("\n") || "No matching context found."
    };
  }

  if (name === "task-end") {
    const entry = await vault.remember({
      text: input.summary,
      scope: input.projectRoot ? "project" : "global",
      projectRoot: input.projectRoot,
      type: "session",
      source: "hook",
      auto: true,
      tags: ["session-summary"]
    });
    return { name, entry, text: `Stored ${entry.status} session summary: ${entry.text}` };
  }

  throw new Error(`Unknown hook: ${name}`);
}

