import { getConfig } from "./config.js";

/**
 * Generate embeddings via Ollama's /api/embed endpoint.
 * Batches up to 32 texts per call.
 */
// nomic-embed-text supports ~8192 tokens; truncate to ~6000 chars to be safe
const MAX_EMBED_CHARS = 6000;

export async function embed(texts: string[]): Promise<number[][]> {
  const config = getConfig();

  if (texts.length === 0) return [];

  const results: number[][] = [];
  const batchSize = 32;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts
      .slice(i, i + batchSize)
      .map((t) => (t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t));

    const res = await fetch(`${config.OLLAMA_HOST}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.EMBED_MODEL,
        input: batch,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama embed error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    results.push(...data.embeddings);
  }

  return results;
}

/**
 * Embed a single query string. Returns the embedding vector.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embed([text]);
  return embedding;
}

/**
 * Check if Ollama is available and the model is loaded.
 */
export async function checkOllama(): Promise<boolean> {
  const config = getConfig();
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as {
      models: Array<{ name: string }>;
    };
    return data.models.some((m) => m.name.startsWith(config.EMBED_MODEL));
  } catch {
    return false;
  }
}
