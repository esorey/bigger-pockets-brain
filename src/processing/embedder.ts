/**
 * Text embedder using OpenAI text-embedding-3-small
 *
 * Generates 1536-dimensional embeddings for semantic search.
 */

import OpenAI from "openai";

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100; // OpenAI limit is 2048, but smaller batches are safer

export interface EmbedResult {
  embedding: Float32Array;
  tokenCount: number;
}

export interface BatchEmbedResult {
  embeddings: Float32Array[];
  totalTokens: number;
}

export class TextEmbedder {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<EmbedResult> {
    const response = await this.client.embeddings.create({
      model: MODEL,
      input: text,
      dimensions: DIMENSIONS,
    });

    const data = response.data[0];
    if (!data) {
      throw new Error("No embedding returned");
    }

    return {
      embedding: new Float32Array(data.embedding),
      tokenCount: response.usage.total_tokens,
    };
  }

  /**
   * Embed multiple texts in batches
   */
  async embedBatch(texts: string[]): Promise<BatchEmbedResult> {
    const embeddings: Float32Array[] = [];
    let totalTokens = 0;

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);

      const response = await this.client.embeddings.create({
        model: MODEL,
        input: batch,
        dimensions: DIMENSIONS,
      });

      for (const item of response.data) {
        embeddings.push(new Float32Array(item.embedding));
      }

      totalTokens += response.usage.total_tokens;
    }

    return { embeddings, totalTokens };
  }
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vector length mismatch");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Find top-k most similar vectors
 */
export function findTopK(
  query: Float32Array,
  vectors: { id: number; vector: Float32Array }[],
  k: number
): { id: number; similarity: number }[] {
  const scored = vectors.map(({ id, vector }) => ({
    id,
    similarity: cosineSimilarity(query, vector),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, k);
}
