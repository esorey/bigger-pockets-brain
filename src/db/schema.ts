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
  "CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);",
  "CREATE INDEX IF NOT EXISTS idx_chunks_episode ON chunks(episode_number);",
] as const;
