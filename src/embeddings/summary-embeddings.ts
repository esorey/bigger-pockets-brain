/**
 * Summary embeddings - embed episode summaries for conceptual discovery
 *
 * Example queries: "episodes about house hacking", "BRRRR strategy"
 */

import type { Database } from 'bun:sqlite';
import type { EmbeddingService, EmbeddingProgressCallback } from './types.ts';
import { EpisodeRepository } from '../db/index.ts';
import { storeEmbeddingsBatch, initVectorTables, hasVectorTables } from '../search/index.ts';

/** Options for embedding summaries */
export interface EmbedSummariesOptions {
  /** Batch size for embedding API calls (default: 20) */
  batchSize?: number;

  /** Progress callback */
  onProgress?: EmbeddingProgressCallback;
}

/** Result of embedding summaries */
export interface EmbedSummariesResult {
  embedded: number;
  skipped: number;
  total: number;
}

/**
 * Embed all episode summaries that haven't been embedded yet.
 *
 * Process:
 * 1. Get episodes with status='summarized'
 * 2. Filter out episodes that already have summary embeddings
 * 3. Embed summaries in batches
 * 4. Store embeddings with type='summary' and reference_id=episode_number
 *
 * @param db Database instance
 * @param embeddingService Embedding service to use
 * @param options Embedding options
 * @returns Result with counts
 */
export async function embedSummaries(
  db: Database,
  embeddingService: EmbeddingService,
  options: EmbedSummariesOptions = {}
): Promise<EmbedSummariesResult> {
  const batchSize = options.batchSize ?? 20;
  const repo = new EpisodeRepository(db);

  // Ensure vector tables exist
  if (!hasVectorTables(db)) {
    initVectorTables(db, embeddingService.dimensions);
  }

  // Get summarized episodes
  const summarizedEpisodes = repo.getEpisodesByStatus('summarized');

  if (summarizedEpisodes.length === 0) {
    return { embedded: 0, skipped: 0, total: 0 };
  }

  // Check which episodes already have summary embeddings
  const existingStmt = db.prepare(`
    SELECT DISTINCT episode_number FROM embedding_meta WHERE type = 'summary'
  `);
  const existingRows = existingStmt.all() as { episode_number: number }[];
  const existingSet = new Set(existingRows.map((r) => r.episode_number));

  // Filter to episodes that need embedding
  const toEmbed = summarizedEpisodes.filter(
    (e) => e.summary && !existingSet.has(e.episodeNumber)
  );

  if (toEmbed.length === 0) {
    return {
      embedded: 0,
      skipped: summarizedEpisodes.length,
      total: summarizedEpisodes.length,
    };
  }

  let embedded = 0;

  // Process in batches
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const summaries = batch.map((e) => e.summary!);

    // Embed batch
    const vectors = await embeddingService.embed(summaries);

    // Store embeddings
    const embeddings = vectors.map((vector, idx) => ({
      vector,
      type: 'summary' as const,
      referenceId: batch[idx]!.episodeNumber,
      episodeNumber: batch[idx]!.episodeNumber,
    }));

    storeEmbeddingsBatch(db, embeddings);

    embedded += batch.length;
    options.onProgress?.(embedded, toEmbed.length);
  }

  return {
    embedded,
    skipped: existingSet.size,
    total: summarizedEpisodes.length,
  };
}

/**
 * Get statistics about summary embeddings
 */
export function getSummaryEmbeddingStats(db: Database): {
  summarizedEpisodes: number;
  embeddedEpisodes: number;
  pendingEmbedding: number;
} {
  const repo = new EpisodeRepository(db);
  const summarizedEpisodes = repo.getEpisodesByStatus('summarized');

  let embeddedCount = 0;
  try {
    const row = db
      .prepare("SELECT COUNT(DISTINCT episode_number) as count FROM embedding_meta WHERE type = 'summary'")
      .get() as { count: number };
    embeddedCount = row.count;
  } catch {
    // Table may not exist yet
  }

  return {
    summarizedEpisodes: summarizedEpisodes.length,
    embeddedEpisodes: embeddedCount,
    pendingEmbedding: summarizedEpisodes.length - embeddedCount,
  };
}
