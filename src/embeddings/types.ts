/**
 * Embedding service abstraction
 */

/** Core embedding service interface */
export interface EmbeddingService {
  /** Embed one or more texts, returning normalized vectors */
  embed(texts: string[]): Promise<Float32Array[]>;

  /** Vector dimension count */
  readonly dimensions: number;

  /** Model identifier (e.g., "text-embedding-3-small") */
  readonly modelName: string;
}

/** Progress callback for batch embedding */
export type EmbeddingProgressCallback = (completed: number, total: number) => void;

/** Options for embedding service creation */
export interface EmbeddingServiceOptions {
  /** API key for the provider */
  apiKey: string;

  /** Model name to use */
  model?: string;

  /** Batch size for API calls (default: provider-specific) */
  batchSize?: number;

  /** Delay between batches in ms (default: 100) */
  batchDelayMs?: number;

  /** Max retry attempts on failure (default: 3) */
  maxRetries?: number;

  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelayMs?: number;
}

/** Embedding provider metadata */
export interface EmbeddingProviderInfo {
  name: string;
  models: {
    id: string;
    dimensions: number;
    maxBatchSize: number;
  }[];
}

/** OpenAI provider info */
export const OPENAI_PROVIDER: EmbeddingProviderInfo = {
  name: 'openai',
  models: [
    { id: 'text-embedding-3-small', dimensions: 1536, maxBatchSize: 2048 },
    { id: 'text-embedding-3-large', dimensions: 3072, maxBatchSize: 2048 },
    { id: 'text-embedding-ada-002', dimensions: 1536, maxBatchSize: 2048 },
  ],
};

/** Voyage AI provider info */
export const VOYAGE_PROVIDER: EmbeddingProviderInfo = {
  name: 'voyage',
  models: [
    { id: 'voyage-2', dimensions: 1024, maxBatchSize: 128 },
    { id: 'voyage-large-2', dimensions: 1536, maxBatchSize: 128 },
  ],
};
