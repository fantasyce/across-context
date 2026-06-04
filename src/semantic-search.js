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

const FIELD_WEIGHTS = {
  text: 4,
  type: 3,
  tags: 5,
  projectName: 2,
  status: 1,
  visibility: 0.5
};

const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

export function searchEntries(entries, input = {}) {
  const mode = input.mode || "keyword";
  const queryTerms = unique(tokenize(input.query));
  const expandedTerms = expandTerms(queryTerms);
  if (!queryTerms.length && input.allowEmptyQuery) {
    return entries
      .map((entry) => recentResult(entry, mode))
      .sort(sortResults)
      .slice(0, input.limit || 20);
  }
  const scored = entries
    .map((entry) => ({
      entry,
      ...scoreEntry(entry, queryTerms, expandedTerms, mode),
      matchMode: mode
    }))
    .filter((result) => result.score > 0)
    .sort(sortResults);
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
  const fields = entryFields(entry);
  const exact = scoreTerms(fields, queryTerms, 3);
  const relatedTerms = expandedTerms.filter((term) => !queryTerms.includes(term));
  const related = mode === "keyword" ? zeroFieldScore() : scoreTerms(fields, relatedTerms, 1);
  const type = queryTerms.includes(entry.type) ? 3 : 0;
  const status = (entry.status || "active") === "active" || entry.status === "pinned" ? 1 : 0;
  const recency = recencyScore(entry);
  const exactScore = exact.score;
  const relatedScore = related.score;
  const total = mode === "keyword"
    ? exactScore
    : mode === "semantic"
      ? relatedScore + exactScore + type + status + recency
      : exactScore * 2 + relatedScore + type + status + recency;

  return {
    score: roundScore(total),
    explanation: {
      reason: "matched",
      matchedTerms: unique([...exact.matchedTerms, ...related.matchedTerms]),
      matchedFields: unique([...exact.matchedFields, ...related.matchedFields]),
      scoreComponents: {
        exact: roundScore(exactScore),
        related: roundScore(relatedScore),
        type: roundScore(type),
        status: roundScore(status),
        recency: roundScore(recency)
      }
    }
  };
}

function entryFields(entry) {
  return {
    text: tokenize(entry.text),
    type: tokenize(entry.type),
    tags: tokenize((entry.tags || []).join(" ")),
    projectName: tokenize(entry.projectName || ""),
    status: tokenize(entry.status || "active"),
    visibility: tokenize(entry.visibility || "private")
  };
}

function scoreTerms(fields, terms, weight) {
  const matchedTerms = new Set();
  const matchedFields = new Set();
  let score = 0;
  for (const [field, fieldTerms] of Object.entries(fields)) {
    const haystack = fieldTerms.join(" ");
    for (const term of terms) {
      const termScore = scoreTerm(haystack, term, weight * (FIELD_WEIGHTS[field] || 1));
      if (termScore > 0) {
        score += termScore;
        matchedTerms.add(term);
        matchedFields.add(field);
      }
    }
  }
  return {
    score,
    matchedTerms: [...matchedTerms],
    matchedFields: [...matchedFields]
  };
}

function scoreTerm(haystack, term, weight) {
  if (!term) return 0;
  if (haystack.includes(term)) return weight;
  if (term.length > 4 && haystack.includes(stem(term))) return Math.max(1, weight - 1);
  return 0;
}

function recentResult(entry, mode) {
  const status = (entry.status || "active") === "active" || entry.status === "pinned" ? 1 : 0;
  const recency = recencyScore(entry);
  return {
    entry,
    score: roundScore(status + recency),
    matchMode: mode,
    explanation: {
      reason: "recent",
      matchedTerms: [],
      matchedFields: [],
      scoreComponents: {
        exact: 0,
        related: 0,
        type: 0,
        status: roundScore(status),
        recency: roundScore(recency)
      }
    }
  };
}

function recencyScore(entry) {
  const created = Date.parse(entry.createdAt || "");
  if (Number.isNaN(created)) return 0;
  const age = Math.max(0, Date.now() - created);
  return Math.max(0, 1 - age / RECENCY_WINDOW_MS);
}

function sortResults(a, b) {
  return b.score - a.score || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt));
}

function roundScore(value) {
  return Math.round(value * 1000) / 1000;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function zeroFieldScore() {
  return {
    score: 0,
    matchedTerms: [],
    matchedFields: []
  };
}

function stem(term) {
  return String(term || "").replace(/(ing|ers|ies|ied|ed|es|s)$/i, "");
}
