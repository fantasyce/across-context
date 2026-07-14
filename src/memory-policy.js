import { isMemoryExpired, normalizeMemoryProvenance, quarantineAssessment } from "./memory-provenance.js";

const DEFAULT_MAX_TEXT_LENGTH = 1200;
export const LOCAL_PATH_REDACTION = "[REDACTED_LOCAL_PATH]";
export const RAW_TRANSCRIPT_REDACTION = "[REDACTED_RAW_TRANSCRIPT]";
export const HIDDEN_REASONING_REDACTION = "[REDACTED_HIDDEN_REASONING]";
const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{12,}\b/,
  /\bgh[pousr]_[a-zA-Z0-9_]{20,}\b/,
  /\b(api[_-]?key|token|secret|password|passwd|cookie)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];
const LOCAL_PATH_PATTERNS = [
  /(?<![A-Za-z0-9+:])\/Users\/[^\s"'<>),\]}]+/g,
  /(?<![A-Za-z0-9+:])\/(?:home|workspace|Volumes|Applications|opt|var)\/[^\s"'<>),\]}]+/g,
  /(?<![A-Za-z0-9+:])\/(?:private\/)?tmp\/[^\s"'<>),\]}]+/g,
  /(?<![A-Za-z0-9+:])\/private\/var\/folders\/[^\s"'<>),\]}]+/g,
  /\b[A-Za-z]:\\(?:[^\\\s"'<>]+\\)*[^\\\s"'<>]+/g
];
const SENSITIVE_POLICY_CATEGORY = "sensitive";
const SENSITIVE_POLICY_REASON_PATTERN = /\b(secret|credential|token|password|passwd|cookie|private key)\b/i;
const RESTRICTED_JSON_KEYS = new Map([
  ["transcript", RAW_TRANSCRIPT_REDACTION],
  ["raw_transcript", RAW_TRANSCRIPT_REDACTION],
  ["full_transcript", RAW_TRANSCRIPT_REDACTION],
  ["messages", RAW_TRANSCRIPT_REDACTION],
  ["hidden_reasoning", HIDDEN_REASONING_REDACTION],
  ["chain_of_thought", HIDDEN_REASONING_REDACTION],
  ["internal_reasoning", HIDDEN_REASONING_REDACTION],
  ["analysis", HIDDEN_REASONING_REDACTION]
]);

export class MemoryPolicyEngine {
  constructor(options = {}) {
    this.maxTextLength = Number(options.maxTextLength || DEFAULT_MAX_TEXT_LENGTH);
    this.allowDuplicates = Boolean(options.allowDuplicates);
  }

  evaluate(input, existingMemories = []) {
    const text = String(input.text || "").trim();
    if (!text) {
      return { status: "deny", reason: "Memory text is required." };
    }

    const sanitized = sanitizeMemoryText(text);
    if (!sanitized.accepted) {
      return {
        status: "deny",
        category: SENSITIVE_POLICY_CATEGORY,
        sensitive: true,
        reason: sanitized.reason
      };
    }

    const tags = sanitizeTags(input.tags);
    if (!tags.accepted) {
      return {
        status: "deny",
        category: SENSITIVE_POLICY_CATEGORY,
        sensitive: true,
        reason: "Memory tags look like a secret or credential."
      };
    }

    const policyText = normalizeWhitespace(sanitized.text);
    if (!this.allowDuplicates) {
      const duplicate = findDuplicate(policyText, input, existingMemories);
      if (duplicate) {
        return {
          status: "duplicate",
          reason: "A matching memory already exists.",
          matchedId: duplicate.id,
          entry: duplicate
        };
      }
    }

    const maxTextLength = input.source === "memory-distillation"
      ? Math.max(this.maxTextLength, 8192)
      : this.maxTextLength;
    const trimmed = trimToLimit(policyText, maxTextLength);
    const provenance = normalizeMemoryProvenance(input, trimmed.text, input.observedAt || new Date().toISOString());
    const quarantineReasons = quarantineAssessment(input, text, provenance);
    const status = quarantineReasons.length
      ? "quarantined"
      : isMemoryExpired({ provenance })
        ? "expired"
        : provenance.trust_level === "trusted"
          ? defaultStatus(input)
          : "pending";
    return {
      status: quarantineReasons.length ? "quarantine" : "allow",
      reason: quarantineReasons.length
        ? `Memory quarantined: ${quarantineReasons.join(", ")}.`
        : sanitized.redactionCount + tags.redactionCount
          ? "Restricted durable-memory content was redacted."
          : trimmed.didTrim
            ? "Memory was trimmed to the configured length limit."
            : "Memory passed policy.",
      text: trimmed.text,
      trimmed: trimmed.didTrim,
      redactions: sanitized.redactionCount + tags.redactionCount,
      localPathRedacted: sanitized.localPathRedactions > 0,
      rawTranscriptRedacted: sanitized.rawTranscriptRedactions > 0,
      hiddenReasoningRedacted: sanitized.hiddenReasoningRedactions > 0,
      tags: tags.values,
      tagRedactions: tags.redactionCount,
      memoryStatus: status,
      provenance: stripInternalProvenance(provenance),
      quarantineReasons
    };
  }
}

function stripInternalProvenance(provenance) {
  const { hash_matches, ...record } = provenance;
  return record;
}

export function normalizeMemoryText(text) {
  return normalizeWhitespace(text).toLowerCase();
}

export function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactLocalPaths(text, options = {}) {
  const replacement = options.replacement || LOCAL_PATH_REDACTION;
  let count = 0;
  const redacted = LOCAL_PATH_PATTERNS.reduce((value, pattern) => value.replace(pattern, () => {
    count += 1;
    return replacement;
  }), String(text || ""));
  return { text: redacted, count };
}

export function redactRestrictedContent(text) {
  const original = String(text || "");
  const structured = redactStructuredContent(original);
  if (structured) return structured;
  return redactPlainRestrictedContent(original);
}

function redactPlainRestrictedContent(original) {
  let rawTranscriptRedactions = 0;
  let hiddenReasoningRedactions = 0;
  let redacted = original
    .replace(/<(?:analysis|thinking|reasoning|chain_of_thought)>[\s\S]*?<\/(?:analysis|thinking|reasoning|chain_of_thought)>/gi, () => {
      hiddenReasoningRedactions += 1;
      return HIDDEN_REASONING_REDACTION;
    })
    .replace(/BEGIN (?:RAW|FULL|CHAT) TRANSCRIPT[\s\S]*?END (?:RAW|FULL|CHAT) TRANSCRIPT/gi, () => {
      rawTranscriptRedactions += 1;
      return RAW_TRANSCRIPT_REDACTION;
    })
    .replace(/^\s*(?:raw|full|chat) transcript\s*:\s*.*$/gim, () => {
      rawTranscriptRedactions += 1;
      return RAW_TRANSCRIPT_REDACTION;
    })
    .replace(/^\s*(?:hidden reasoning|internal reasoning|chain of thought)\s*:\s*.*$/gim, () => {
      hiddenReasoningRedactions += 1;
      return HIDDEN_REASONING_REDACTION;
    });

  return { text: redacted, rawTranscriptRedactions, hiddenReasoningRedactions };
}

export function sanitizeMemoryText(text) {
  const value = String(text || "");
  if (containsSecret(value)) {
    return {
      accepted: false,
      reason: "Memory looks like a secret or credential.",
      text: "",
      redactionCount: 0,
      localPathRedactions: 0,
      rawTranscriptRedactions: 0,
      hiddenReasoningRedactions: 0
    };
  }
  const paths = redactLocalPaths(value);
  const restricted = redactRestrictedContent(paths.text);
  return {
    accepted: true,
    reason: "Memory passed generic privacy policy.",
    text: restricted.text,
    redactionCount: paths.count + restricted.rawTranscriptRedactions + restricted.hiddenReasoningRedactions,
    localPathRedactions: paths.count,
    rawTranscriptRedactions: restricted.rawTranscriptRedactions,
    hiddenReasoningRedactions: restricted.hiddenReasoningRedactions
  };
}

export function isSensitivePolicyDecision(decision = {}) {
  return decision.sensitive === true
    || String(decision.category || "").toLowerCase() === SENSITIVE_POLICY_CATEGORY
    || SENSITIVE_POLICY_REASON_PATTERN.test(String(decision.reason || ""));
}

function findDuplicate(text, input, existingMemories) {
  const normalized = normalizeMemoryText(text);
  return existingMemories.find((entry) => {
    if (entry.scope !== input.scope) return false;
    if (entry.type !== input.type) return false;
    return normalizeMemoryText(entry.text) === normalized;
  });
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function trimToLimit(text, maxLength) {
  if (!maxLength || text.length <= maxLength) {
    return { text, didTrim: false };
  }
  const suffix = "...";
  const sliced = text.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd();
  return { text: `${sliced}${suffix}`, didTrim: true };
}

function defaultStatus(input) {
  if (input.status) return input.status;
  if (!input.auto) return "active";
  if (input.type === "preference" || input.type === "decision" || input.type === "command") {
    return "active";
  }
  return "pending";
}

function sanitizeTags(tags) {
  const values = Array.isArray(tags) ? tags : tags ? String(tags).split(",") : [];
  const sanitized = [];
  let redactionCount = 0;
  for (const value of values) {
    const normalizedTag = String(value).trim().replace(/^([^:]+):(?=\/(?!\/)|[A-Za-z]:\\)/, "$1: ");
    const result = sanitizeMemoryText(normalizedTag);
    if (!result.accepted) return { accepted: false, values: [], redactionCount: 0 };
    if (result.text) sanitized.push(result.text);
    redactionCount += result.redactionCount;
  }
  return { accepted: true, values: [...new Set(sanitized)], redactionCount };
}

function redactStructuredContent(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const counts = { rawTranscriptRedactions: 0, hiddenReasoningRedactions: 0 };
    const redacted = redactStructuredValue(value, counts);
    return { text: JSON.stringify(redacted), ...counts };
  } catch {
    return null;
  }
}

function redactStructuredValue(value, counts) {
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, counts));
  if (typeof value === "string") {
    const redacted = redactPlainRestrictedContent(value);
    counts.rawTranscriptRedactions += redacted.rawTranscriptRedactions;
    counts.hiddenReasoningRedactions += redacted.hiddenReasoningRedactions;
    return redacted.text;
  }
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const replacement = RESTRICTED_JSON_KEYS.get(String(key).toLowerCase());
    if (replacement) {
      if (replacement === RAW_TRANSCRIPT_REDACTION) counts.rawTranscriptRedactions += 1;
      else counts.hiddenReasoningRedactions += 1;
      result[key] = replacement;
    } else {
      result[key] = redactStructuredValue(item, counts);
    }
  }
  return result;
}
