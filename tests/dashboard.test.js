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

