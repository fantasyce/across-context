export const MEMORY_SCHEMA_VERSION = "across-context-memory-schema/1.0";

export const MEMORY_SCHEMAS = Object.freeze({
  PROJECT_CONVENTION: "project_convention",
  DECISION: "decision",
  COMMAND: "command",
  FAILURE_PATTERN: "failure_pattern",
  LOOP_EVIDENCE: "loop_evidence",
  RELEASE_EVIDENCE: "release_evidence",
  TRUST_RECEIPT: "trust_receipt"
});

export const MEMORY_SCHEMA_DEFINITIONS = Object.freeze([
  schemaDefinition(MEMORY_SCHEMAS.PROJECT_CONVENTION, "Project conventions, preferences, and stable operating rules."),
  schemaDefinition(MEMORY_SCHEMAS.DECISION, "Durable architecture, product, dependency, or workflow decisions."),
  schemaDefinition(MEMORY_SCHEMAS.COMMAND, "Reusable local commands and verified command sequences."),
  schemaDefinition(MEMORY_SCHEMAS.FAILURE_PATTERN, "Recurring failures, root causes, and reusable fixes."),
  schemaDefinition(MEMORY_SCHEMAS.LOOP_EVIDENCE, "Supervised loop outcomes and bounded run evidence."),
  schemaDefinition(MEMORY_SCHEMAS.RELEASE_EVIDENCE, "Repository quality, gate, release-readiness, and promotion evidence."),
  schemaDefinition(MEMORY_SCHEMAS.TRUST_RECEIPT, "Trust receipts used for adoption and human promotion review.")
]);

const FAILURE_PATTERN = /\b(fail(?:ed|ure|ing)?|error|regression|root cause|recurr(?:ing|ed)|bug|fix(?:ed)?|timeout|crash|broken|incident)\b/i;
const CONVENTION_PATTERN = /\b(prefer|convention|always|never|must|should|standard|rule|workflow)\b/i;
const RELEASE_PATTERN = /\b(release|readiness|quality gate|promotion|publish|ship|pr ready|push receipt|validation gate)\b/i;

export function classifyMemory(entry = {}) {
  const payload = parsePayload(entry.text);
  const version = String(payload?.schema_version || payload?.schemaVersion || "");
  const tags = (entry.tags || []).map((tag) => String(tag).toLowerCase());
  const text = String(entry.text || "");
  const schemas = [];
  const reasons = [];

  if (version === "across-context-distilled-memory-proposal/1.0" && Object.values(MEMORY_SCHEMAS).includes(payload?.memory_schema)) {
    addSchema(schemas, reasons, payload.memory_schema, "governed distilled memory proposal");
  }

  if (version === "across-agent-team-receipt-memory/1.0" || hasTag(tags, "trust-receipt", "agent-team-receipt")) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.TRUST_RECEIPT, "structured trust receipt");
  }
  if (
    version === "across-evidence-memory/1.0"
    || version.startsWith("across-push-receipt/")
    || version.startsWith("across-autopilot-push-receipt/")
    || hasTag(tags, "release-evidence", "release-readiness", "quality-gate")
  ) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.RELEASE_EVIDENCE, "structured release or quality evidence");
  }
  if (version === "across-loop-memory/1.0" || version === "agent-loop-memory-candidate/1.0" || hasTag(tags, "autopilot-loop", "loop-evidence")) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.LOOP_EVIDENCE, "structured loop evidence");
  }
  if (entry.type === "command" || hasTag(tags, "command", "verified-command")) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.COMMAND, "command memory type or tag");
  }
  if (entry.type === "decision" || hasTag(tags, "decision", "architecture-decision")) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.DECISION, "decision memory type or tag");
  }
  if (FAILURE_PATTERN.test(text) || hasTag(tags, "failure", "failure-pattern", "bug-fix", "regression")) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.FAILURE_PATTERN, "failure or recurring-fix signal");
  }
  if (entry.type === "preference" || hasTag(tags, "convention", "project-convention") || CONVENTION_PATTERN.test(text)) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.PROJECT_CONVENTION, "preference or convention signal");
  }
  if (RELEASE_PATTERN.test(text) && schemas.includes(MEMORY_SCHEMAS.LOOP_EVIDENCE)) {
    addSchema(schemas, reasons, MEMORY_SCHEMAS.RELEASE_EVIDENCE, "release-readiness loop evidence");
  }

  if (!schemas.length) {
    const fallback = fallbackSchema(entry);
    addSchema(schemas, reasons, fallback, `fallback from ${entry.type || "note"} memory`);
  }

  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    primary_schema: schemas[0],
    schemas,
    reasons,
    source_schema_version: version || null,
    classified_without_migration: true
  };
}

export function schemaAwareSummary(entries = []) {
  const bySchema = Object.fromEntries(MEMORY_SCHEMA_DEFINITIONS.map((definition) => [definition.id, 0]));
  const memories = entries.map((entry) => {
    const classification = classifyMemory(entry);
    for (const schema of classification.schemas) bySchema[schema] += 1;
    return {
      id: entry.id,
      status: entry.status || "active",
      scope: entry.scope,
      type: entry.type,
      project_id: entry.projectId || null,
      classification
    };
  });
  return {
    schema_version: "across-context-schema-summary/1.0",
    definitions: MEMORY_SCHEMA_DEFINITIONS,
    memory_count: memories.length,
    by_schema: bySchema,
    memories
  };
}

function schemaDefinition(id, description) {
  return { id, description, derived: true, authoritative_record_changed: false };
}

function addSchema(schemas, reasons, schema, reason) {
  if (schemas.includes(schema)) return;
  schemas.push(schema);
  reasons.push({ schema, reason });
}

function hasTag(tags, ...needles) {
  return tags.some((tag) => needles.some((needle) => tag === needle || tag.startsWith(`${needle}:`)));
}

function fallbackSchema(entry) {
  if (entry.type === "session") return MEMORY_SCHEMAS.LOOP_EVIDENCE;
  if (entry.type === "command") return MEMORY_SCHEMAS.COMMAND;
  if (entry.type === "decision") return MEMORY_SCHEMAS.DECISION;
  return MEMORY_SCHEMAS.PROJECT_CONVENTION;
}

function parsePayload(text) {
  try {
    const payload = JSON.parse(String(text || ""));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}
