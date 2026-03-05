/**
 * OpenAI embedding service implementation
 */

import type {
  EmbeddingService,
  EmbeddingServiceOptions,
  EmbeddingProgressCallback,
} from './types.ts';
import { OPENAI_PROVIDER } from './types.ts';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 100; // Conservative default
const DEFAULT_BATCH_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage: { prompt_tokens: number; total_tokens: number };
}

/** Normalize a vector to unit length (L2 norm = 1) */
function normalizeVector(vector: number[]): Float32Array {
  const arr = new Float32Array(vector.length);
  let sumSquares = 0;

  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i]! * vector[i]!;
  }

  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return arr; // Return zero vector if input is zero
  }

  for (let i = 0; i < vector.length; i++) {
    arr[i] = vector[i]! / norm;
  }

  return arr;
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Error that should not be retried (4xx client errors except 429) */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/** Create an OpenAI embedding service */
export function createOpenAIEmbeddingService(
  options: EmbeddingServiceOptions
): EmbeddingService & { embedWithProgress: (texts: string[], onProgress?: EmbeddingProgressCallback) => Promise<Float32Array[]> } {
  const model = options.model ?? DEFAULT_MODEL;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  // Look up model dimensions
  const modelInfo = OPENAI_PROVIDER.models.find((m) => m.id === model);
  if (!modelInfo) {
    throw new Error(
      `Unknown OpenAI model: ${model}. Available: ${OPENAI_PROVIDER.models.map((m) => m.id).join(', ')}`
    );
  }

  const dimensions = modelInfo.dimensions;

  /** Make a single API call with retry logic */
  async function callAPI(texts: string[]): Promise<Float32Array[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: texts,
          }),
        });

        if (response.status === 429) {
          // Rate limited - exponential backoff
          const delay = retryBaseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        if (response.status >= 500) {
          // Server error - retry
          const delay = retryBaseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          // 4xx errors (except 429) are not retryable
          throw new NonRetryableError(`OpenAI API error ${response.status}: ${errorText}`);
        }

        const data = (await response.json()) as OpenAIEmbeddingResponse;

        // Sort by index to ensure correct order
        const sorted = [...data.data].sort((a, b) => a.index - b.index);

        // Normalize vectors
        return sorted.map((item) => normalizeVector(item.embedding));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry non-retryable errors
        if (error instanceof NonRetryableError) {
          throw error;
        }

        if (attempt < maxRetries - 1) {
          const delay = retryBaseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Failed after max retries');
  }

  /** Embed with progress callback */
  async function embedWithProgress(
    texts: string[],
    onProgress?: EmbeddingProgressCallback
  ): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const results: Float32Array[] = [];
    let completed = 0;

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await callAPI(batch);
      results.push(...batchResults);

      completed += batch.length;
      onProgress?.(completed, texts.length);

      // Delay between batches (skip after last batch)
      if (i + batchSize < texts.length) {
        await sleep(batchDelayMs);
      }
    }

    return results;
  }

  return {
    get dimensions() {
      return dimensions;
    },
    get modelName() {
      return model;
    },
    embed(texts: string[]): Promise<Float32Array[]> {
      return embedWithProgress(texts);
    },
    embedWithProgress,
  };
}
