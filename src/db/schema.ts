export const EPISODE_STATUS_VALUES = [
  "pending",
  "fetched",
  "missing",
  "failed",
  "summarized",
] as const;

export const CREATE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS episodes (
    episode_number INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT,
    published_at TEXT,
    url TEXT,
    transcript_text TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'fetched', 'missing', 'failed', 'summarized')),
    fetched_at TEXT,
    summarized_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_number INTEGER NOT NULL REFERENCES episodes(episode_number),
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    start_char INTEGER NOT NULL,
    end_char INTEGER NOT NULL,
    UNIQUE(episode_number, chunk_index)
  );`,
  `CREATE TABLE IF NOT EXISTS embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('summary', 'chunk')),
    episode_number INTEGER NOT NULL REFERENCES episodes(episode_number),
    vector BLOB NOT NULL
  );`,
  "CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);",
  "CREATE INDEX IF NOT EXISTS idx_chunks_episode ON chunks(episode_number);",
  "CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(type);",
  "CREATE INDEX IF NOT EXISTS idx_embeddings_episode ON embeddings(episode_number);",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(type, reference_id);",
] as const;
