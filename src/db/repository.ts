import type { Database, Statement } from "bun:sqlite";
import type { Episode, EpisodeStatus, Chunk, EmbeddingType, EmbeddingRecord } from "../types";

export class EpisodeRepository {
  private readonly db: Database;
  private readonly stmtUpsert: Statement;
  private readonly stmtGetByNumber: Statement;
  private readonly stmtGetBySlug: Statement;
  private readonly stmtGetByStatus: Statement;
  private readonly stmtGetAll: Statement;
  private readonly stmtUpdateStatus: Statement;
  private readonly stmtSaveSummary: Statement;

  constructor(db: Database) {
    this.db = db;

    this.stmtUpsert = db.prepare(`
      INSERT INTO episodes (
        episode_number, slug, title, published_at, url,
        transcript_text, summary, status, fetched_at, summarized_at
      ) VALUES (
        $episode_number, $slug, $title, $published_at, $url,
        $transcript_text, $summary, $status, $fetched_at, $summarized_at
      )
      ON CONFLICT(episode_number) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        published_at = excluded.published_at,
        url = excluded.url,
        transcript_text = COALESCE(excluded.transcript_text, transcript_text),
        summary = COALESCE(excluded.summary, summary),
        status = excluded.status,
        fetched_at = COALESCE(excluded.fetched_at, fetched_at),
        summarized_at = COALESCE(excluded.summarized_at, summarized_at)
    `);

    this.stmtGetByNumber = db.prepare(
      "SELECT * FROM episodes WHERE episode_number = ?"
    );

    this.stmtGetBySlug = db.prepare("SELECT * FROM episodes WHERE slug = ?");

    this.stmtGetByStatus = db.prepare(
      "SELECT * FROM episodes WHERE status = ? ORDER BY episode_number"
    );

    this.stmtGetAll = db.prepare(
      "SELECT * FROM episodes ORDER BY episode_number"
    );

    this.stmtUpdateStatus = db.prepare(
      "UPDATE episodes SET status = ? WHERE episode_number = ?"
    );

    this.stmtSaveSummary = db.prepare(`
      UPDATE episodes
      SET summary = ?, status = 'summarized', summarized_at = ?
      WHERE episode_number = ?
    `);
  }

  upsertEpisode(episode: Partial<Episode> & { episodeNumber: number; slug: string }): void {
    this.stmtUpsert.run({
      episode_number: episode.episodeNumber,
      slug: episode.slug,
      title: episode.title ?? null,
      published_at: episode.publishedAt?.toISOString() ?? null,
      url: episode.url ?? null,
      transcript_text: episode.transcriptText ?? null,
      summary: episode.summary ?? null,
      status: episode.status ?? "pending",
      fetched_at: episode.fetchedAt?.toISOString() ?? null,
      summarized_at: episode.summarizedAt?.toISOString() ?? null,
    });
  }

  upsertEpisodes(episodes: Array<Partial<Episode> & { episodeNumber: number; slug: string }>): void {
    const upsertMany = this.db.transaction((eps: typeof episodes) => {
      for (const episode of eps) {
        this.upsertEpisode(episode);
      }
    });
    upsertMany(episodes);
  }

  getEpisode(episodeNumber: number): Episode | null {
    const row = this.stmtGetByNumber.get(episodeNumber) as EpisodeRow | null;
    return row ? rowToEpisode(row) : null;
  }

  getEpisodeBySlug(slug: string): Episode | null {
    const row = this.stmtGetBySlug.get(slug) as EpisodeRow | null;
    return row ? rowToEpisode(row) : null;
  }

  getEpisodesByStatus(status: EpisodeStatus): Episode[] {
    const rows = this.stmtGetByStatus.all(status) as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  getPendingEpisodes(): Episode[] {
    return this.getEpisodesByStatus("pending");
  }

  getAllEpisodes(): Episode[] {
    const rows = this.stmtGetAll.all() as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  updateStatus(episodeNumber: number, status: EpisodeStatus): void {
    this.stmtUpdateStatus.run(status, episodeNumber);
  }

  saveSummary(episodeNumber: number, summary: string): void {
    this.stmtSaveSummary.run(summary, new Date().toISOString(), episodeNumber);
  }
}

export class ChunkRepository {
  private readonly db: Database;
  private readonly stmtInsert: Statement;
  private readonly stmtGetByEpisode: Statement;
  private readonly stmtGetById: Statement;
  private readonly stmtDeleteByEpisode: Statement;

  constructor(db: Database) {
    this.db = db;

    this.stmtInsert = db.prepare(`
      INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.stmtGetByEpisode = db.prepare(
      "SELECT * FROM chunks WHERE episode_number = ? ORDER BY chunk_index"
    );

    this.stmtGetById = db.prepare("SELECT * FROM chunks WHERE id = ?");

    this.stmtDeleteByEpisode = db.prepare(
      "DELETE FROM chunks WHERE episode_number = ?"
    );
  }

  saveChunks(episodeNumber: number, chunks: Omit<Chunk, "id">[]): void {
    const insertMany = this.db.transaction((chks: typeof chunks) => {
      this.stmtDeleteByEpisode.run(episodeNumber);
      for (const chunk of chks) {
        this.stmtInsert.run(
          episodeNumber,
          chunk.chunkIndex,
          chunk.chunkText,
          chunk.startChar,
          chunk.endChar
        );
      }
    });
    insertMany(chunks);
  }

  getChunksForEpisode(episodeNumber: number): Chunk[] {
    const rows = this.stmtGetByEpisode.all(episodeNumber) as ChunkRow[];
    return rows.map(rowToChunk);
  }

  getChunk(id: number): Chunk | null {
    const row = this.stmtGetById.get(id) as ChunkRow | null;
    return row ? rowToChunk(row) : null;
  }

  deleteChunksForEpisode(episodeNumber: number): void {
    this.stmtDeleteByEpisode.run(episodeNumber);
  }
}

export class EmbeddingRepository {
  private readonly db: Database;
  private readonly stmtInsert: Statement;
  private readonly stmtGetByType: Statement;
  private readonly stmtGetByEpisode: Statement;
  private readonly stmtGetAll: Statement;
  private readonly stmtDelete: Statement;

  constructor(db: Database) {
    this.db = db;

    this.stmtInsert = db.prepare(`
      INSERT OR REPLACE INTO embeddings (reference_id, type, episode_number, vector)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtGetByType = db.prepare(
      "SELECT * FROM embeddings WHERE type = ?"
    );

    this.stmtGetByEpisode = db.prepare(
      "SELECT * FROM embeddings WHERE episode_number = ?"
    );

    this.stmtGetAll = db.prepare("SELECT * FROM embeddings");

    this.stmtDelete = db.prepare(
      "DELETE FROM embeddings WHERE type = ? AND reference_id = ?"
    );
  }

  saveEmbedding(
    referenceId: number,
    type: EmbeddingType,
    episodeNumber: number,
    vector: Float32Array
  ): void {
    const buffer = Buffer.from(vector.buffer);
    this.stmtInsert.run(referenceId, type, episodeNumber, buffer);
  }

  saveEmbeddings(
    embeddings: { referenceId: number; type: EmbeddingType; episodeNumber: number; vector: Float32Array }[]
  ): void {
    const insertMany = this.db.transaction((embs: typeof embeddings) => {
      for (const emb of embs) {
        const buffer = Buffer.from(emb.vector.buffer);
        this.stmtInsert.run(emb.referenceId, emb.type, emb.episodeNumber, buffer);
      }
    });
    insertMany(embeddings);
  }

  getEmbeddingsByType(type: EmbeddingType): EmbeddingRecord[] {
    const rows = this.stmtGetByType.all(type) as EmbeddingRow[];
    return rows.map(rowToEmbedding);
  }

  getEmbeddingsForEpisode(episodeNumber: number): EmbeddingRecord[] {
    const rows = this.stmtGetByEpisode.all(episodeNumber) as EmbeddingRow[];
    return rows.map(rowToEmbedding);
  }

  getAllEmbeddings(): EmbeddingRecord[] {
    const rows = this.stmtGetAll.all() as EmbeddingRow[];
    return rows.map(rowToEmbedding);
  }

  deleteEmbedding(type: EmbeddingType, referenceId: number): void {
    this.stmtDelete.run(type, referenceId);
  }

  count(): number {
    const result = this.db.query("SELECT COUNT(*) as cnt FROM embeddings").get() as { cnt: number };
    return result.cnt;
  }
}

// Row types from database
interface EpisodeRow {
  episode_number: number;
  slug: string;
  title: string | null;
  published_at: string | null;
  url: string | null;
  transcript_text: string | null;
  summary: string | null;
  status: EpisodeStatus;
  fetched_at: string | null;
  summarized_at: string | null;
}

interface ChunkRow {
  id: number;
  episode_number: number;
  chunk_index: number;
  chunk_text: string;
  start_char: number;
  end_char: number;
}

interface EmbeddingRow {
  id: number;
  reference_id: number;
  type: EmbeddingType;
  episode_number: number;
  vector: Buffer;
}

function rowToEpisode(row: EpisodeRow): Episode {
  return {
    episodeNumber: row.episode_number,
    slug: row.slug,
    title: row.title ?? "",
    publishedAt: row.published_at ? new Date(row.published_at) : new Date(),
    url: row.url ?? "",
    transcriptText: row.transcript_text,
    summary: row.summary,
    status: row.status,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at) : null,
    summarizedAt: row.summarized_at ? new Date(row.summarized_at) : null,
  };
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    episodeNumber: row.episode_number,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    startChar: row.start_char,
    endChar: row.end_char,
  };
}

function rowToEmbedding(row: EmbeddingRow): EmbeddingRecord {
  return {
    id: row.id,
    referenceId: row.reference_id,
    type: row.type,
    episodeNumber: row.episode_number,
    vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4),
  };
}

export function withTransaction<T>(db: Database, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}
