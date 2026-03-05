/**
 * sqlite-vec vector search integration
 *
 * Multi-layer search: summary vectors for conceptual discovery,
 * chunk vectors for detail retrieval.
 */

import type { SqliteDatabase } from "../db/init";
import type { EmbeddingService } from "../embeddings/types";
import type { EmbeddingType, SearchResult } from "../types";

export interface VectorSearchOptions {
  limit?: number;
  types?: EmbeddingType[];
}

const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Initialize vector tables for the given embedding dimensions.
 * MUST be called after embedding service is configured.
 */
export function initVectorTables(db: SqliteDatabase, dimensions: number): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      embedding float[${dimensions}]
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_meta (
      rowid INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('summary', 'chunk')),
      reference_id INTEGER NOT NULL,
      episode_number INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_embedding_meta_episode
    ON embedding_meta(episode_number);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_embedding_meta_type
    ON embedding_meta(type);
  `);
}

/**
 * Store an embedding with its metadata.
 * Returns the rowid for the stored vector.
 */
export function storeEmbedding(
  db: SqliteDatabase,
  vector: Float32Array,
  type: EmbeddingType,
  referenceId: number,
  episodeNumber: number
): number {
  const insertVec = db.prepare(
    "INSERT INTO vec_embeddings(embedding) VALUES (?)"
  );
  const insertMeta = db.prepare(
    "INSERT INTO embedding_meta(rowid, type, reference_id, episode_number) VALUES (?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    const result = insertVec.run(vector);
    const rowid = Number(result.lastInsertRowid);
    insertMeta.run(rowid, type, referenceId, episodeNumber);
    return rowid;
  });

  return transaction();
}

/**
 * Store multiple embeddings in a batch.
 * More efficient than calling storeEmbedding repeatedly.
 */
export function storeEmbeddingsBatch(
  db: SqliteDatabase,
  embeddings: Array<{
    vector: Float32Array;
    type: EmbeddingType;
    referenceId: number;
    episodeNumber: number;
  }>
): number[] {
  const insertVec = db.prepare(
    "INSERT INTO vec_embeddings(embedding) VALUES (?)"
  );
  const insertMeta = db.prepare(
    "INSERT INTO embedding_meta(rowid, type, reference_id, episode_number) VALUES (?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    const rowids: number[] = [];
    for (const e of embeddings) {
      const result = insertVec.run(e.vector);
      const rowid = Number(result.lastInsertRowid);
      insertMeta.run(rowid, e.type, e.referenceId, e.episodeNumber);
      rowids.push(rowid);
    }
    return rowids;
  });

  return transaction();
}

interface RawSearchHit {
  rowid: number;
  distance: number;
  type: string;
  reference_id: number;
  episode_number: number;
}

/**
 * Search for similar vectors using L2 distance.
 * Returns raw hits with distance scores (lower = more similar).
 */
function searchVectorsRaw(
  db: SqliteDatabase,
  queryVector: Float32Array,
  options: VectorSearchOptions = {}
): RawSearchHit[] {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const types = options.types ?? ["summary", "chunk"];

  // First get vector matches
  const vecQuery = db.prepare(`
    SELECT rowid, distance
    FROM vec_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);

  const vecHits = vecQuery.all(queryVector, limit * 2) as Array<{
    rowid: number;
    distance: number;
  }>;

  if (vecHits.length === 0) {
    return [];
  }

  // Get metadata for matched rowids
  const rowids = vecHits.map((h) => h.rowid);
  const placeholders = rowids.map(() => "?").join(",");
  const typePlaceholders = types.map(() => "?").join(",");

  const metaQuery = db.prepare(`
    SELECT rowid, type, reference_id, episode_number
    FROM embedding_meta
    WHERE rowid IN (${placeholders})
    AND type IN (${typePlaceholders})
  `);

  const metaRows = metaQuery.all(...rowids, ...types) as Array<{
    rowid: number;
    type: string;
    reference_id: number;
    episode_number: number;
  }>;

  // Build lookup map
  const metaMap = new Map(metaRows.map((m) => [m.rowid, m]));

  // Combine results
  const results: RawSearchHit[] = [];
  for (const hit of vecHits) {
    const meta = metaMap.get(hit.rowid);
    if (meta) {
      results.push({
        rowid: hit.rowid,
        distance: hit.distance,
        type: meta.type,
        reference_id: meta.reference_id,
        episode_number: meta.episode_number,
      });
    }
  }

  return results.slice(0, limit);
}

/**
 * Convert L2 distance to cosine similarity (for normalized vectors).
 * cosine_sim = 1 - (distance^2 / 2)
 */
export function l2ToCosineSimilarity(l2Distance: number): number {
  return 1 - (l2Distance * l2Distance) / 2;
}

interface EpisodeMatch {
  episodeNumber: number;
  bestDistance: number;
  bestType: EmbeddingType;
  referenceId: number;
}

/**
 * Group search hits by episode, keeping best match per episode.
 */
function groupByEpisode(hits: RawSearchHit[]): EpisodeMatch[] {
  const episodeMap = new Map<number, EpisodeMatch>();

  for (const hit of hits) {
    const existing = episodeMap.get(hit.episode_number);
    if (!existing || hit.distance < existing.bestDistance) {
      episodeMap.set(hit.episode_number, {
        episodeNumber: hit.episode_number,
        bestDistance: hit.distance,
        bestType: hit.type as EmbeddingType,
        referenceId: hit.reference_id,
      });
    }
  }

  return Array.from(episodeMap.values()).sort(
    (a, b) => a.bestDistance - b.bestDistance
  );
}

/**
 * Get snippet text for a search hit.
 */
function getSnippetForHit(
  db: SqliteDatabase,
  type: EmbeddingType,
  referenceId: number
): string {
  if (type === "summary") {
    const row = db
      .prepare("SELECT summary FROM episodes WHERE episode_number = ?")
      .get(referenceId) as { summary: string | null } | undefined;
    const summary = row?.summary ?? "";
    // Return first 200 chars as snippet
    return summary.length > 200 ? summary.slice(0, 200) + "..." : summary;
  } else {
    const row = db
      .prepare("SELECT chunk_text FROM chunks WHERE id = ?")
      .get(referenceId) as { chunk_text: string } | undefined;
    const text = row?.chunk_text ?? "";
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
  }
}

/**
 * Search for episodes matching a query.
 * Uses the embedding service to embed the query, then searches vectors.
 */
export async function searchEpisodes(
  db: SqliteDatabase,
  embeddingService: EmbeddingService,
  query: string,
  options: VectorSearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  // Embed the query
  const [queryVector] = await embeddingService.embed([query]);
  if (!queryVector) {
    return [];
  }

  // Search vectors
  const hits = searchVectorsRaw(db, queryVector, {
    ...options,
    limit: limit * 3, // Get more to account for grouping
  });

  // Group by episode
  const episodeMatches = groupByEpisode(hits).slice(0, limit);

  // Build results with episode metadata
  const results: SearchResult[] = [];

  for (const match of episodeMatches) {
    const episode = db
      .prepare(
        "SELECT title, published_at, url FROM episodes WHERE episode_number = ?"
      )
      .get(match.episodeNumber) as
      | { title: string; published_at: string; url: string }
      | undefined;

    if (!episode) continue;

    const snippet = getSnippetForHit(db, match.bestType, match.referenceId);

    results.push({
      episodeNumber: match.episodeNumber,
      title: episode.title,
      publishedAt: new Date(episode.published_at),
      url: episode.url,
      matchingSnippet: snippet,
      similarity: l2ToCosineSimilarity(match.bestDistance),
      matchType: match.bestType,
    });
  }

  return results;
}

/**
 * Check if vector tables are initialized.
 */
export function hasVectorTables(db: SqliteDatabase): boolean {
  try {
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
      )
      .get();
    return result !== undefined;
  } catch {
    return false;
  }
}

/**
 * Get count of stored embeddings by type.
 */
export function getEmbeddingCounts(
  db: SqliteDatabase
): Record<EmbeddingType, number> {
  const summaryCount = db
    .prepare("SELECT COUNT(*) as count FROM embedding_meta WHERE type = 'summary'")
    .get() as { count: number };

  const chunkCount = db
    .prepare("SELECT COUNT(*) as count FROM embedding_meta WHERE type = 'chunk'")
    .get() as { count: number };

  return {
    summary: summaryCount.count,
    chunk: chunkCount.count,
  };
}
