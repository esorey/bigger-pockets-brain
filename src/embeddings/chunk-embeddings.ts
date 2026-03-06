/**
 * Chunk embeddings - embed transcript chunks for detail retrieval
 *
 * Example queries: "quit nursing job", "$47k cash flow"
 * Preserves specific details that summaries might compress out.
 */

import type { Database } from 'bun:sqlite';
import type { EmbeddingService, EmbeddingProgressCallback } from './types.ts';
import { ChunkRepository } from '../db/index.ts';
import { storeEmbeddingsBatch, initVectorTables, hasVectorTables } from '../search/index.ts';

/** Options for embedding chunks */
export interface EmbedChunksOptions {
  /** Batch size for embedding API calls (default: 50) */
  batchSize?: number;

  /** Progress callback */
  onProgress?: EmbeddingProgressCallback;

  /** Specific episode numbers to process (default: all) */
  episodeNumbers?: number[];
}

/** Result of embedding chunks */
export interface EmbedChunksResult {
  embedded: number;
  skipped: number;
  totalChunks: number;
  episodesProcessed: number;
}

/**
 * Embed all chunks that haven't been embedded yet.
 *
 * Process:
 * 1. Get all chunks from DB (or specific episodes if specified)
 * 2. Filter out chunks that already have embeddings
 * 3. Embed chunks in batches
 * 4. Store embeddings with type='chunk' and reference_id=chunk.id
 *
 * @param db Database instance
 * @param embeddingService Embedding service to use
 * @param options Embedding options
 * @returns Result with counts
 */
export async function embedChunks(
  db: Database,
  embeddingService: EmbeddingService,
  options: EmbedChunksOptions = {}
): Promise<EmbedChunksResult> {
  const batchSize = options.batchSize ?? 50;
  const chunkRepo = new ChunkRepository(db);

  // Ensure vector tables exist
  if (!hasVectorTables(db)) {
    initVectorTables(db, embeddingService.dimensions);
  }

  // Get episode numbers to process
  let episodeNumbers: number[];
  if (options.episodeNumbers) {
    episodeNumbers = options.episodeNumbers;
  } else {
    // Get all episodes that have chunks
    const rows = db
      .prepare('SELECT DISTINCT episode_number FROM chunks ORDER BY episode_number')
      .all() as { episode_number: number }[];
    episodeNumbers = rows.map((r) => r.episode_number);
  }

  if (episodeNumbers.length === 0) {
    return { embedded: 0, skipped: 0, totalChunks: 0, episodesProcessed: 0 };
  }

  // Get chunks that already have embeddings
  const existingStmt = db.prepare(`
    SELECT DISTINCT reference_id FROM embedding_meta WHERE type = 'chunk'
  `);
  const existingRows = existingStmt.all() as { reference_id: number }[];
  const existingSet = new Set(existingRows.map((r) => r.reference_id));

  // Gather all chunks to embed
  interface ChunkToEmbed {
    id: number;
    episodeNumber: number;
    chunkText: string;
  }
  const chunksToEmbed: ChunkToEmbed[] = [];
  let totalChunks = 0;

  for (const episodeNumber of episodeNumbers) {
    const chunks = chunkRepo.getChunksForEpisode(episodeNumber);
    totalChunks += chunks.length;

    for (const chunk of chunks) {
      if (!existingSet.has(chunk.id)) {
        chunksToEmbed.push({
          id: chunk.id,
          episodeNumber: chunk.episodeNumber,
          chunkText: chunk.chunkText,
        });
      }
    }
  }

  if (chunksToEmbed.length === 0) {
    return {
      embedded: 0,
      skipped: totalChunks,
      totalChunks,
      episodesProcessed: episodeNumbers.length,
    };
  }

  let embedded = 0;

  // Process in batches
  for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
    const batch = chunksToEmbed.slice(i, i + batchSize);
    const texts = batch.map((c) => c.chunkText);

    // Embed batch
    const vectors = await embeddingService.embed(texts);

    // Store embeddings
    const embeddings = vectors.map((vector, idx) => ({
      vector,
      type: 'chunk' as const,
      referenceId: batch[idx]!.id,
      episodeNumber: batch[idx]!.episodeNumber,
    }));

    storeEmbeddingsBatch(db, embeddings);

    embedded += batch.length;
    options.onProgress?.(embedded, chunksToEmbed.length);
  }

  return {
    embedded,
    skipped: existingSet.size,
    totalChunks,
    episodesProcessed: episodeNumbers.length,
  };
}

/**
 * Get statistics about chunk embeddings
 */
export function getChunkEmbeddingStats(db: Database): {
  totalChunks: number;
  embeddedChunks: number;
  pendingEmbedding: number;
  episodesWithChunks: number;
} {
  let totalChunks = 0;
  let episodesWithChunks = 0;
  try {
    const chunkRow = db
      .prepare('SELECT COUNT(*) as count FROM chunks')
      .get() as { count: number };
    totalChunks = chunkRow.count;

    const episodeRow = db
      .prepare('SELECT COUNT(DISTINCT episode_number) as count FROM chunks')
      .get() as { count: number };
    episodesWithChunks = episodeRow.count;
  } catch {
    // Table may not exist yet
  }

  let embeddedCount = 0;
  try {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM embedding_meta WHERE type = 'chunk'")
      .get() as { count: number };
    embeddedCount = row.count;
  } catch {
    // Table may not exist yet
  }

  return {
    totalChunks,
    embeddedChunks: embeddedCount,
    pendingEmbedding: totalChunks - embeddedCount,
    episodesWithChunks,
  };
}
