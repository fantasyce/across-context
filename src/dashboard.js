import { createServer } from "node:http";

export async function renderDashboardHtml(vault, options = {}) {
  const stats = await vault.stats({ projectRoot: options.projectRoot });
  const memories = await vault.listMemories({ projectRoot: options.projectRoot, includeGlobal: true });
  const pending = memories.filter((entry) => (entry.status || "active") === "pending");
  const rows = renderRows(memories);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Across Context Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1020; color: #e5edf8; }
    body { margin: 0; background: #0b1020; }
    main { max-width: 1120px; margin: 0 auto; padding: 40px 24px; }
    h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: 0; }
    p { color: #9fb0c7; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 28px 0; }
    .metric, .panel { background: rgba(15, 23, 42, .86); border: 1px solid #263449; border-radius: 8px; padding: 18px; }
    .metric strong { display: block; font-size: 28px; margin-top: 8px; color: #67e8f9; }
    .panel { margin-top: 16px; overflow: auto; }
    .toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(4, minmax(120px, 150px)) auto; gap: 10px; align-items: end; margin: 18px 0; }
    label { display: grid; gap: 5px; color: #b8c7da; font-size: 12px; }
    input, select, button { min-height: 34px; border-radius: 6px; border: 1px solid #334155; background: #111827; color: #e5edf8; font: inherit; }
    input, select { padding: 0 10px; }
    button { cursor: pointer; padding: 0 10px; }
    button:hover { border-color: #67e8f9; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #233047; vertical-align: top; }
    th { color: #b8c7da; font-size: 13px; }
    td { color: #e5edf8; font-size: 14px; }
    code { color: #93c5fd; }
    .status { border: 1px solid #334155; border-radius: 999px; padding: 3px 8px; font-size: 12px; }
    .status-pending { color: #fde68a; border-color: #a16207; }
    .status-active, .status-pinned { color: #86efac; border-color: #15803d; }
    .status-archived, .status-expired { color: #cbd5e1; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 220px; }
    .actions button { min-height: 28px; font-size: 12px; }
    .muted { color: #9fb0c7; font-size: 12px; }
    @media (max-width: 920px) { .toolbar { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 780px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main>
    <h1>Across Context Dashboard</h1>
    <p>Review local agent memory, approve pending writes, and monitor vault health.</p>
    <section class="grid" aria-label="Memory metrics">
      <div class="metric">Total<strong>${stats.total}</strong></div>
      <div class="metric">Pending Review<strong>${pending.length}</strong></div>
      <div class="metric">Global<strong>${stats.byScope.global || 0}</strong></div>
      <div class="metric">Project<strong>${stats.byScope.project || 0}</strong></div>
    </section>
    <section class="panel">
      <h2>Memory Review</h2>
      <form class="toolbar" id="memory-toolbar">
        <label>Search<input id="memory-search" name="q" autocomplete="off"></label>
        <label>Status<select name="status"><option value="">Any</option><option>pending</option><option>active</option><option>pinned</option><option>archived</option><option>expired</option></select></label>
        <label>Type<select name="type"><option value="">Any</option><option>preference</option><option>decision</option><option>note</option><option>command</option><option>session</option></select></label>
        <label>Scope<select name="scope"><option value="">Any</option><option>global</option><option>project</option></select></label>
        <label>Mode<select name="mode"><option>hybrid</option><option>keyword</option><option>semantic</option></select></label>
        <button type="submit">Search</button>
      </form>
      <p class="muted" id="memory-count">${memories.length} memories</p>
      <table>
        <thead><tr><th>ID</th><th>Scope</th><th>Type</th><th>Status</th><th>Visibility</th><th>Text</th><th>Match</th><th>Actions</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=\"6\">No memories yet.</td></tr>"}</tbody>
      </table>
    </section>
  </main>
  <script>
    const toolbar = document.querySelector("#memory-toolbar");
    const tbody = document.querySelector("tbody");
    const count = document.querySelector("#memory-count");

    toolbar.addEventListener("submit", async (event) => {
      event.preventDefault();
      const params = new URLSearchParams(new FormData(toolbar));
      params.set("explain", "1");
      const response = await fetch("/api/search?" + params.toString());
      const payload = await response.json();
      tbody.innerHTML = payload.html;
      count.textContent = payload.results.length + " memories";
    });

    document.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      const response = action === "forget"
        ? await fetch("/api/memories/" + id + "/forget", { method: "POST" })
        : await fetch("/api/memories/" + id + "/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: action })
          });
      if (response.ok) toolbar.requestSubmit();
    });
  </script>
</body>
</html>`;
}

export function createDashboardApp(vault, options = {}) {
  return {
    async handle(request) {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/api/search") {
        const results = await vault.search({
          query: url.searchParams.get("q") || "",
          projectRoot: options.projectRoot,
          includeGlobal: true,
          mode: url.searchParams.get("mode") || "hybrid",
          status: url.searchParams.get("status") || undefined,
          type: url.searchParams.get("type") || undefined,
          scope: url.searchParams.get("scope") || undefined,
          allowEmptyQuery: true
        });
        return jsonResponse({
          results,
          html: renderRows(results.map((result) => result.entry), results)
        });
      }
      if (url.pathname === "/api/memories") {
        const memories = await vault.listMemories({
          projectRoot: options.projectRoot,
          includeGlobal: true
        });
        return jsonResponse({ memories });
      }
      if (url.pathname === "/api/stats") {
        return jsonResponse(await vault.stats({ projectRoot: options.projectRoot }));
      }
      const statusMatch = url.pathname.match(/^\/api\/memories\/([^/]+)\/status$/);
      if (statusMatch) {
        if (request.method !== "POST") return methodNotAllowed();
        const body = parseJsonBody(request.body);
        const entry = await vault.updateStatus(decodeURIComponent(statusMatch[1]), body.status);
        return jsonResponse({ entry });
      }
      const forgetMatch = url.pathname.match(/^\/api\/memories\/([^/]+)\/forget$/);
      if (forgetMatch) {
        if (request.method !== "POST") return methodNotAllowed();
        return jsonResponse(await vault.forget(decodeURIComponent(forgetMatch[1])));
      }
      return htmlResponse(await renderDashboardHtml(vault, options));
    }
  };
}

export async function startDashboard(vault, options = {}) {
  const app = createDashboardApp(vault, options);
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 3767);
  const server = createServer(async (req, res) => {
    try {
      const response = await app.handle({
        method: req.method,
        url: req.url,
        body: await readRequestBody(req)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, url: `http://${host}:${port}` };
}

function jsonResponse(value) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(value, null, 2)
  };
}

function htmlResponse(body) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body
  };
}

function methodNotAllowed() {
  return {
    statusCode: 405,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: "Method not allowed" }, null, 2)
  };
}

function parseJsonBody(body) {
  if (!body) return {};
  return JSON.parse(body);
}

function renderRows(memories, results = []) {
  const resultById = new Map(results.map((result) => [result.entry.id, result]));
  return memories.map((entry) => {
    const result = resultById.get(entry.id);
    const match = result?.explanation?.matchedTerms?.length
      ? `${result.explanation.matchedTerms.join(", ")} (${result.score})`
      : "";
    return `
    <tr>
      <td><code>${escapeHtml(entry.id)}</code></td>
      <td>${escapeHtml(entry.scope)}</td>
      <td>${escapeHtml(entry.type)}</td>
      <td><span class="status status-${escapeHtml(entry.status || "active")}">${escapeHtml(entry.status || "active")}</span></td>
      <td>${escapeHtml(entry.visibility || "private")}</td>
      <td>${escapeHtml(entry.text)}</td>
      <td class="muted">${escapeHtml(match)}</td>
      <td>${renderActions(entry)}</td>
    </tr>`;
  }).join("");
}

function renderActions(entry) {
  const id = escapeHtml(entry.id);
  return `<span class="actions">
    <button type="button" data-id="${id}" data-action="active">Approve</button>
    <button type="button" data-id="${id}" data-action="archived">Archive</button>
    <button type="button" data-id="${id}" data-action="expired">Expire</button>
    <button type="button" data-id="${id}" data-action="forget">Forget</button>
  </span>`;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
