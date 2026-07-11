import test from "node:test";
import assert from "node:assert/strict";
import { classifyMemory, MEMORY_SCHEMAS, schemaAwareSummary } from "../src/memory-schema.js";

test("classifyMemory derives all vNext schemas without changing vault records", () => {
  const records = [
    { id: "convention", type: "preference", scope: "project", text: "Always run checks before review.", tags: [] },
    { id: "decision", type: "decision", scope: "project", text: "Use JSONL as the authority.", tags: [] },
    { id: "command", type: "command", scope: "project", text: "Run npm check.", tags: [] },
    { id: "failure", type: "note", scope: "project", text: "Recurring timeout failure is fixed by waiting for the socket.", tags: ["failure-pattern"] },
    { id: "loop", type: "session", scope: "global", text: JSON.stringify({ schema_version: "across-loop-memory/1.0", text: "loop evidence" }), tags: [] },
    { id: "release", type: "session", scope: "global", text: JSON.stringify({ schema_version: "across-evidence-memory/1.0", summary: "release evidence" }), tags: [] },
    { id: "push-receipt", type: "note", scope: "project", text: JSON.stringify({ schema_version: "across-autopilot-push-receipt/1.0", gate_verdict: "pass" }), tags: [] },
    { id: "receipt", type: "session", scope: "global", text: JSON.stringify({ schema_version: "across-agent-team-receipt-memory/1.0" }), tags: [] }
  ];

  const classifications = new Map(records.map((record) => [record.id, classifyMemory(record)]));

  assert.equal(classifications.get("convention").primary_schema, MEMORY_SCHEMAS.PROJECT_CONVENTION);
  assert.equal(classifications.get("decision").primary_schema, MEMORY_SCHEMAS.DECISION);
  assert.equal(classifications.get("command").primary_schema, MEMORY_SCHEMAS.COMMAND);
  assert.ok(classifications.get("failure").schemas.includes(MEMORY_SCHEMAS.FAILURE_PATTERN));
  assert.equal(classifications.get("loop").primary_schema, MEMORY_SCHEMAS.LOOP_EVIDENCE);
  assert.equal(classifications.get("release").primary_schema, MEMORY_SCHEMAS.RELEASE_EVIDENCE);
  assert.equal(classifications.get("push-receipt").primary_schema, MEMORY_SCHEMAS.RELEASE_EVIDENCE);
  assert.equal(classifications.get("receipt").primary_schema, MEMORY_SCHEMAS.TRUST_RECEIPT);
  assert.ok([...classifications.values()].every((classification) => classification.classified_without_migration));

  const summary = schemaAwareSummary(records);
  assert.equal(summary.memory_count, 8);
  assert.equal(summary.by_schema.trust_receipt, 1);
  assert.equal(summary.by_schema.release_evidence, 2);
});
