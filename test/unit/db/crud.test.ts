import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runSchemaMigrations } from "../../../src/db";

describe("episode CRUD operations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runSchemaMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  test("insert new episode → verify retrieval", () => {
    db.run(`
      INSERT INTO episodes (episode_number, slug, title, published_at, url, status)
      VALUES (42, 'real-estate-42', 'House Hacking 101', '2026-01-15T00:00:00Z', 'https://example.com/42', 'pending')
    `);

    const row = db.query("SELECT * FROM episodes WHERE episode_number = ?").get(42) as {
      episode_number: number;
      slug: string;
      title: string;
      status: string;
    };

    expect(row.episode_number).toBe(42);
    expect(row.slug).toBe("real-estate-42");
    expect(row.title).toBe("House Hacking 101");
    expect(row.status).toBe("pending");
  });

  test("update episode status → verify state change", () => {
    db.run(`
      INSERT INTO episodes (episode_number, slug, status)
      VALUES (1, 'real-estate-1', 'pending')
    `);

    db.run("UPDATE episodes SET status = 'fetched' WHERE episode_number = 1");

    const row = db.query("SELECT status FROM episodes WHERE episode_number = 1").get() as {
      status: string;
    };
    expect(row.status).toBe("fetched");
  });

  test("upsert existing episode → verify update not duplicate", () => {
    db.run(`
      INSERT INTO episodes (episode_number, slug, status)
      VALUES (1, 'real-estate-1', 'pending')
    `);

    // Use INSERT OR REPLACE (upsert)
    db.run(`
      INSERT OR REPLACE INTO episodes (episode_number, slug, title, status)
      VALUES (1, 'real-estate-1', 'Updated Title', 'fetched')
    `);

    const count = db.query("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number };
    expect(count.cnt).toBe(1);

    const row = db.query("SELECT title, status FROM episodes WHERE episode_number = 1").get() as {
      title: string;
      status: string;
    };
    expect(row.title).toBe("Updated Title");
    expect(row.status).toBe("fetched");
  });

  test("get non-existent episode → returns null", () => {
    const row = db.query("SELECT * FROM episodes WHERE episode_number = 999").get();
    expect(row).toBeNull();
  });

  test("get episodes by status → correct filtering", () => {
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (1, 'ep-1', 'pending')");
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (2, 'ep-2', 'fetched')");
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (3, 'ep-3', 'pending')");
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (4, 'ep-4', 'fetched')");

    const pending = db.query("SELECT episode_number FROM episodes WHERE status = 'pending'").all() as Array<{
      episode_number: number;
    }>;
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.episode_number)).toEqual([1, 3]);
  });

  test("save summary → verify summarizedAt timestamp set", () => {
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (1, 'ep-1', 'fetched')");

    const now = new Date().toISOString();
    db.run(`
      UPDATE episodes SET summary = 'This is a summary.', summarized_at = ?, status = 'summarized'
      WHERE episode_number = 1
    `, [now]);

    const row = db.query("SELECT summary, summarized_at, status FROM episodes WHERE episode_number = 1").get() as {
      summary: string;
      summarized_at: string;
      status: string;
    };

    expect(row.summary).toBe("This is a summary.");
    expect(row.summarized_at).toBe(now);
    expect(row.status).toBe("summarized");
  });
});

describe("chunk CRUD operations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runSchemaMigrations(db);
    // Create episode first (foreign key)
    db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (42, 'ep-42', 'fetched')");
  });

  afterEach(() => {
    db.close();
  });

  test("save chunks for episode → verify count and content", () => {
    const insertChunk = db.prepare(`
      INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertChunk.run(42, 0, "First chunk of text", 0, 100);
    insertChunk.run(42, 1, "Second chunk of text", 100, 200);
    insertChunk.run(42, 2, "Third chunk of text", 200, 300);

    const chunks = db.query("SELECT * FROM chunks WHERE episode_number = 42 ORDER BY chunk_index").all() as Array<{
      chunk_index: number;
      chunk_text: string;
    }>;

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.chunk_text).toBe("First chunk of text");
    expect(chunks[2]?.chunk_text).toBe("Third chunk of text");
  });

  test("get chunks → correct order by chunk_index", () => {
    // Insert out of order
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 2, 'C', 200, 300)");
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 0, 'A', 0, 100)");
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 1, 'B', 100, 200)");

    const chunks = db.query(
      "SELECT chunk_text FROM chunks WHERE episode_number = 42 ORDER BY chunk_index"
    ).all() as Array<{ chunk_text: string }>;

    expect(chunks.map((c) => c.chunk_text)).toEqual(["A", "B", "C"]);
  });

  test("delete chunks → verify removal", () => {
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 0, 'text', 0, 100)");
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 1, 'text2', 100, 200)");

    db.run("DELETE FROM chunks WHERE episode_number = 42");

    const count = db.query("SELECT COUNT(*) as cnt FROM chunks WHERE episode_number = 42").get() as { cnt: number };
    expect(count.cnt).toBe(0);
  });

  test("unique constraint on episode_number + chunk_index", () => {
    db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 0, 'text', 0, 100)");

    expect(() => {
      db.run("INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char) VALUES (42, 0, 'duplicate', 0, 100)");
    }).toThrow();
  });
});

describe("transaction handling", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runSchemaMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  test("successful transaction → changes committed", () => {
    db.transaction(() => {
      db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (1, 'ep-1', 'pending')");
      db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (2, 'ep-2', 'pending')");
    })();

    const count = db.query("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number };
    expect(count.cnt).toBe(2);
  });

  test("failed transaction → changes rolled back", () => {
    try {
      db.transaction(() => {
        db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (1, 'ep-1', 'pending')");
        // This should fail due to duplicate primary key
        db.run("INSERT INTO episodes (episode_number, slug, status) VALUES (1, 'ep-1-dup', 'pending')");
      })();
    } catch {
      // Expected to throw
    }

    const count = db.query("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number };
    expect(count.cnt).toBe(0);
  });
});

describe("edge cases", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runSchemaMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  test("very long transcript text", () => {
    const longText = "x".repeat(100_000);
    db.run("INSERT INTO episodes (episode_number, slug, status, transcript_text) VALUES (1, 'ep-1', 'fetched', ?)", [longText]);

    const row = db.query("SELECT LENGTH(transcript_text) as len FROM episodes WHERE episode_number = 1").get() as {
      len: number;
    };
    expect(row.len).toBe(100_000);
  });

  test("unicode characters in title/transcript", () => {
    const unicodeTitle = "Episode 日本語 🎙️ العربية";
    const unicodeText = "Transcript with émojis 🏠 and ñ characters";

    db.run("INSERT INTO episodes (episode_number, slug, status, title, transcript_text) VALUES (1, 'ep-1', 'fetched', ?, ?)", [
      unicodeTitle,
      unicodeText,
    ]);

    const row = db.query("SELECT title, transcript_text FROM episodes WHERE episode_number = 1").get() as {
      title: string;
      transcript_text: string;
    };

    expect(row.title).toBe(unicodeTitle);
    expect(row.transcript_text).toBe(unicodeText);
  });

  test("empty string vs null handling", () => {
    db.run("INSERT INTO episodes (episode_number, slug, status, transcript_text) VALUES (1, 'ep-1', 'pending', '')");
    db.run("INSERT INTO episodes (episode_number, slug, status, transcript_text) VALUES (2, 'ep-2', 'pending', NULL)");

    const row1 = db.query("SELECT transcript_text FROM episodes WHERE episode_number = 1").get() as {
      transcript_text: string | null;
    };
    const row2 = db.query("SELECT transcript_text FROM episodes WHERE episode_number = 2").get() as {
      transcript_text: string | null;
    };

    expect(row1.transcript_text).toBe("");
    expect(row2.transcript_text).toBeNull();
  });
});

describe("WAL mode", () => {
  test("can enable WAL mode", () => {
    const db = new Database(":memory:");
    runSchemaMigrations(db);

    db.run("PRAGMA journal_mode = WAL");
    const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };

    // Memory databases don't actually use WAL, but the command should succeed
    expect(["wal", "memory"]).toContain(result.journal_mode);

    db.close();
  });
});
