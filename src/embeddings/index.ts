/**
 * Embedding service module
 *
 * Provides abstraction for different embedding providers:
 * - OpenAI (text-embedding-3-small, text-embedding-3-large)
 * - Voyage AI (voyage-2, voyage-large-2) - coming soon
 * - Local models - coming soon
 */

export type {
  EmbeddingService,
  EmbeddingServiceOptions,
  EmbeddingProgressCallback,
  EmbeddingProviderInfo,
} from './types.ts';

export { OPENAI_PROVIDER, VOYAGE_PROVIDER } from './types.ts';
export { createOpenAIEmbeddingService } from './openai.ts';

import type { EmbeddingService, EmbeddingServiceOptions } from './types.ts';
import type { EmbeddingProvider } from '../types/index.ts';
import { createOpenAIEmbeddingService } from './openai.ts';

/** Create an embedding service for the specified provider */
export function createEmbeddingService(
  provider: EmbeddingProvider,
  options: EmbeddingServiceOptions
): EmbeddingService {
  switch (provider) {
    case 'openai':
      return createOpenAIEmbeddingService(options);

    case 'voyage':
      // TODO: Implement Voyage provider
      throw new Error('Voyage provider not yet implemented');

    case 'local':
      // TODO: Implement local provider
      throw new Error('Local provider not yet implemented');

    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
