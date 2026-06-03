const RELATED_TERMS = {
  agent: ["assistant", "coding", "tool", "tools", "model", "models"],
  agents: ["assistant", "assistants", "coding", "tools", "models"],
  assistant: ["agent", "agents", "coding"],
  context: ["memory", "memories", "preference", "preferences", "knowledge"],
  memory: ["context", "memories", "preference", "preferences", "knowledge", "vault"],
  memories: ["memory", "context", "knowledge", "vault"],
  shared: ["share", "portable", "cross", "between", "common"],
  switch: ["handoff", "portable", "between", "move"],
  switching: ["handoff", "portable", "between", "move"],
  bootstrap: ["start", "startup", "task-start", "context"],
  review: ["approve", "approval", "pending"],
  release: ["ship", "publish", "version"],
  test: ["tests", "testing", "verify", "verification"]
};

export function searchEntries(entries, input = {}) {
  const mode = input.mode || "keyword";
  const queryTerms = tokenize(input.query);
  const expandedTerms = expandTerms(queryTerms);
  const scored = entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTerms, expandedTerms, mode),
      matchMode: mode
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)));
  return scored.slice(0, input.limit || 20);
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .flatMap((term) => [term, stem(term)])
    .filter(Boolean);
}

function expandTerms(terms) {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const related of RELATED_TERMS[term] || []) {
      expanded.add(related);
      expanded.add(stem(related));
    }
  }
  return [...expanded].filter(Boolean);
}

function scoreEntry(entry, queryTerms, expandedTerms, mode) {
  const haystack = entryHaystack(entry);
  const exactScore = queryTerms.reduce((score, term) => score + scoreTerm(haystack, term, 3), 0);
  if (mode === "keyword") return exactScore;
  const semanticScore = expandedTerms.reduce((score, term) => score + scoreTerm(haystack, term, 1), 0);
  const typeBoost = queryTerms.includes(entry.type) ? 2 : 0;
  if (mode === "semantic") return semanticScore + typeBoost;
  return exactScore * 2 + semanticScore + typeBoost;
}

function entryHaystack(entry) {
  return tokenize(`${entry.text} ${entry.type} ${(entry.tags || []).join(" ")} ${entry.projectName || ""}`).join(" ");
}

function scoreTerm(haystack, term, weight) {
  if (!term) return 0;
  if (haystack.includes(term)) return weight;
  if (term.length > 4 && haystack.includes(stem(term))) return Math.max(1, weight - 1);
  return 0;
}

function stem(term) {
  return String(term || "").replace(/(ing|ers|ies|ied|ed|es|s)$/i, "");
}

