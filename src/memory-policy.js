const DEFAULT_MAX_TEXT_LENGTH = 1200;
const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{12,}\b/,
  /\bgh[pousr]_[a-zA-Z0-9_]{20,}\b/,
  /\b(api[_-]?key|token|secret|password|passwd|cookie)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];
const SENSITIVE_POLICY_CATEGORY = "sensitive";
const SENSITIVE_POLICY_REASON_PATTERN = /\b(secret|credential|token|password|passwd|cookie|private key)\b/i;

export class MemoryPolicyEngine {
  constructor(options = {}) {
    this.maxTextLength = Number(options.maxTextLength || DEFAULT_MAX_TEXT_LENGTH);
    this.allowDuplicates = Boolean(options.allowDuplicates);
  }

  evaluate(input, existingMemories = []) {
    const text = normalizeWhitespace(input.text);
    if (!text) {
      return { status: "deny", reason: "Memory text is required." };
    }

    if (containsSecret(text)) {
      return {
        status: "deny",
        category: SENSITIVE_POLICY_CATEGORY,
        sensitive: true,
        reason: "Memory looks like a secret or credential."
      };
    }

    if (!this.allowDuplicates) {
      const duplicate = findDuplicate(text, input, existingMemories);
      if (duplicate) {
        return {
          status: "duplicate",
          reason: "A matching memory already exists.",
          matchedId: duplicate.id,
          entry: duplicate
        };
      }
    }

    const trimmed = trimToLimit(text, this.maxTextLength);
    const status = defaultStatus(input);
    return {
      status: "allow",
      reason: trimmed.didTrim ? "Memory was trimmed to the configured length limit." : "Memory passed policy.",
      text: trimmed.text,
      trimmed: trimmed.didTrim,
      memoryStatus: status
    };
  }
}

export function normalizeMemoryText(text) {
  return normalizeWhitespace(text).toLowerCase();
}

export function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
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
