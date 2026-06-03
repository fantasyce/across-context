import { createServer } from "node:http";

export async function renderDashboardHtml(vault, options = {}) {
  const stats = await vault.stats({ projectRoot: options.projectRoot });
  const memories = await vault.listMemories({ projectRoot: options.projectRoot, includeGlobal: true });
  const pending = memories.filter((entry) => (entry.status || "active") === "pending");
  const rows = memories.map((entry) => `
    <tr>
      <td><code>${escapeHtml(entry.id)}</code></td>
      <td>${escapeHtml(entry.scope)}</td>
      <td>${escapeHtml(entry.type)}</td>
      <td><span class="status status-${escapeHtml(entry.status || "active")}">${escapeHtml(entry.status || "active")}</span></td>
      <td>${escapeHtml(entry.visibility || "private")}</td>
      <td>${escapeHtml(entry.text)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Across Context Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1020; color: #e5edf8; }
    body { margin: 0; background: radial-gradient(circle at top left, #123b4a 0, transparent 34rem), #0b1020; }
    main { max-width: 1120px; margin: 0 auto; padding: 40px 24px; }
    h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: 0; }
    p { color: #9fb0c7; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 28px 0; }
    .metric, .panel { background: rgba(15, 23, 42, .86); border: 1px solid #263449; border-radius: 8px; padding: 18px; }
    .metric strong { display: block; font-size: 28px; margin-top: 8px; color: #67e8f9; }
    .panel { margin-top: 16px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #233047; vertical-align: top; }
    th { color: #b8c7da; font-size: 13px; }
    td { color: #e5edf8; font-size: 14px; }
    code { color: #93c5fd; }
    .status { border: 1px solid #334155; border-radius: 999px; padding: 3px 8px; font-size: 12px; }
    .status-pending { color: #fde68a; border-color: #a16207; }
    .status-active, .status-pinned { color: #86efac; border-color: #15803d; }
    .status-archived, .status-expired { color: #cbd5e1; }
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
      <table>
        <thead><tr><th>ID</th><th>Scope</th><th>Type</th><th>Status</th><th>Visibility</th><th>Text</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=\"6\">No memories yet.</td></tr>"}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

export function createDashboardApp(vault, options = {}) {
  return {
    async handle(request) {
      const url = new URL(request.url, "http://127.0.0.1");
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
      const response = await app.handle({ method: req.method, url: req.url });
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

