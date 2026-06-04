import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContextVault } from "../src/vault.js";
import { createDashboardApp, renderDashboardHtml } from "../src/dashboard.js";

async function tempVault() {
  const home = await mkdtemp(join(tmpdir(), "across-context-dashboard-"));
  return new ContextVault({ home });
}

test("renderDashboardHtml includes memory metrics and pending review UI", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Maybe remember temporary experiment findings.",
    auto: true
  });

  const html = await renderDashboardHtml(vault);

  assert.match(html, /Across Context Dashboard/);
  assert.match(html, /Pending Review/);
  assert.match(html, /Maybe remember temporary experiment/);
});

test("dashboard app exposes JSON memories API", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "preference",
    text: "Prefer dashboard review before approving automatic memories."
  });
  const app = createDashboardApp(vault);
  const response = await app.handle({
    method: "GET",
    url: "/api/memories"
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.memories.length, 1);
  assert.match(payload.memories[0].text, /dashboard review/);
});

test("dashboard app searches memories with explanations", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "command",
    text: "Run release verification.",
    tags: ["release"]
  });
  const app = createDashboardApp(vault);

  const response = await app.handle({
    method: "GET",
    url: "/api/search?q=release&mode=hybrid&explain=1"
  });
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.ok(payload.results[0].explanation.matchedTerms.includes("release"));
});

test("dashboard app updates memory status through POST", async () => {
  const vault = await tempVault();
  const entry = await vault.remember({
    scope: "global",
    type: "note",
    text: "Needs review.",
    auto: true
  });
  const app = createDashboardApp(vault);

  const response = await app.handle({
    method: "POST",
    url: `/api/memories/${entry.id}/status`,
    body: JSON.stringify({ status: "active" })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).entry.status, "active");
});

test("dashboard app forgets memories through POST", async () => {
  const vault = await tempVault();
  const entry = await vault.remember({
    scope: "global",
    type: "note",
    text: "Forget from dashboard."
  });
  const app = createDashboardApp(vault);

  const response = await app.handle({
    method: "POST",
    url: `/api/memories/${entry.id}/forget`
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).forgotten, 1);
});

test("renderDashboardHtml includes search filters and lifecycle actions", async () => {
  const vault = await tempVault();
  await vault.remember({
    scope: "global",
    type: "note",
    text: "Review through dashboard.",
    auto: true
  });

  const html = await renderDashboardHtml(vault);

  assert.match(html, /id="memory-search"/);
  assert.match(html, /data-action="active"/);
  assert.match(html, /data-action="archived"/);
  assert.match(html, /data-action="forget"/);
});
