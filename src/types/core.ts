export type EpisodeStatus =
  | "pending"
  | "fetched"
  | "missing"
  | "failed"
  | "summarized";

export interface Episode {
  episodeNumber: number;
  slug: string;
  title: string;
  publishedAt: Date;
  url: string;
  transcriptText: string | null;
  summary: string | null;
  status: EpisodeStatus;
  fetchedAt: Date | null;
  summarizedAt: Date | null;
}

export interface Chunk {
  id: number;
  episodeNumber: number;
  chunkIndex: number;
  chunkText: string;
  startChar: number;
  endChar: number;
}

export type EmbeddingType = "summary" | "chunk";

export interface EmbeddingRecord {
  id: number;
  referenceId: number;  // episode_number for summary, chunk.id for chunk
  type: EmbeddingType;
  episodeNumber: number;  // always present for grouping results
  vector: Float32Array;
}

export interface SearchResult {
  episodeNumber: number;
  title: string;
  publishedAt: Date;
  url: string;
  matchingSnippet: string;
  similarity: number;
  matchType: EmbeddingType;
}

export type EmbeddingProvider = "openai" | "voyage" | "local";

export interface Config {
  dbPath: string;
  claudeApiKey: string;
  embeddingProvider: EmbeddingProvider;
  embeddingApiKey?: string;
  scrapeRateLimit: number;
}
