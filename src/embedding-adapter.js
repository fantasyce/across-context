export const LOCAL_EMBEDDING_ALGORITHM = "sha256-token-hash-v1";

export function createEmbeddingAdapter(options = {}) {
  if (typeof options.embed !== "function") {
    throw new Error("Embedding adapter requires an embed(texts) function.");
  }
  const provider = String(options.provider || "custom").trim();
  const model = String(options.model || "unspecified").trim();
  const dimensions = Number(options.dimensions || 0);
  if (!provider || !model) throw new Error("Embedding adapter provider and model are required.");
  if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 4096) {
    throw new Error("Embedding adapter dimensions must be an integer between 8 and 4096.");
  }
  return Object.freeze({
    provider,
    model,
    dimensions,
    localOnly: options.localOnly !== false,
    embed: options.embed
  });
}

export async function embedWithFallback(texts, options = {}) {
  const values = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text || ""));
  const adapter = options.adapter;
  const fallback = options.fallback;
  if (!adapter) {
    return {
      vectors: values.map((text) => fallback(text)),
      provider: "local",
      model: LOCAL_EMBEDDING_ALGORITHM,
      algorithm: LOCAL_EMBEDDING_ALGORITHM,
      fallback_used: false,
      network_performed: false
    };
  }
  try {
    const vectors = await adapter.embed(values);
    validateVectors(vectors, values.length, adapter.dimensions);
    return {
      vectors: vectors.map(normalizeVector),
      provider: adapter.provider,
      model: adapter.model,
      algorithm: "provider-embedding-adapter/1.0",
      fallback_used: false,
      network_performed: adapter.localOnly === false
    };
  } catch (error) {
    if (options.strict) throw error;
    return {
      vectors: values.map((text) => fallback(text)),
      provider: "local",
      model: LOCAL_EMBEDDING_ALGORITHM,
      algorithm: LOCAL_EMBEDDING_ALGORITHM,
      fallback_used: true,
      fallback_reason: String(error?.message || error),
      network_performed: false
    };
  }
}

function validateVectors(vectors, expectedCount, dimensions) {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(`Embedding adapter returned ${Array.isArray(vectors) ? vectors.length : "invalid"} vectors; expected ${expectedCount}.`);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error(`Embedding adapter must return finite ${dimensions}-dimension vectors.`);
    }
  }
}

function normalizeVector(vector) {
  const values = vector.map(Number);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => magnitude ? round(value / magnitude) : 0);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
