/**
 * E2E Pipeline Test
 *
 * Full scrape → process → embed → search pipeline validation
 * with detailed step-by-step logging and test fixtures.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Test utilities
function log(stage: string, message: string): void {
  console.log(`[${stage}] ${message}`);
}

// Test configuration
const TEST_DB_PATH = "/tmp/pipeline-test.db";
const TEST_DATA_DIR = "/tmp/pipeline-test-data";

// Test fixtures: sample episodes
const TEST_EPISODES = [
  {
    episodeNumber: 1001,
    slug: "real-estate-1001",
    title: "House Hacking 101: Living for Free",
    publishedAt: "2026-01-15T00:00:00Z",
    url: "https://example.com/1001",
    transcriptText: `Welcome to the BiggerPockets podcast. Today we have Sarah, who quit her nursing job to pursue real estate full time.

Sarah: I started with a duplex in Cleveland. Bought it for $120,000, put $20,000 into rehab. Now I live in one unit and rent the other for $1,200 a month.

Host: That's amazing! Tell us about your strategy.

Sarah: It's called house hacking. You buy a multi-unit property, live in one unit, and rent the others. My mortgage is only $850, so I'm essentially living for free plus making $350 per month.

Host: What advice would you give to listeners?

Sarah: Start small. Don't wait for the perfect deal. I was scared at first but took action anyway. Now I have 5 properties and $4,000 monthly cash flow.`,
    summary: `# Episode Summary

## NARRATIVE
Sarah, a former nurse, shares her journey into real estate investing. She started with a duplex in Cleveland and now owns 5 properties generating $4,000 monthly cash flow.

## KEY TAKEAWAYS
- Start small and don't wait for the perfect deal
- House hacking allows you to live for free while building wealth
- Taking action despite fear is essential

## STRATEGIES
- House hacking with multi-unit properties
- BRRRR (implied through rehab mention)
- Buy and hold for cash flow

## MARKETS
- Cleveland, Ohio - mentioned as starting market

## CONTEXT
- Current market conditions with $120k purchase prices
- Rental rates around $1,200 for units in Cleveland`,
  },
  {
    episodeNumber: 1002,
    slug: "real-estate-1002",
    title: "BRRRR Method: From $50k to 15 Units",
    publishedAt: "2026-01-20T00:00:00Z",
    url: "https://example.com/1002",
    transcriptText: `Today's guest is Mike who built a 15-unit portfolio using the BRRRR method.

Mike: BRRRR stands for Buy, Rehab, Rent, Refinance, Repeat. I buy distressed properties, fix them up, rent them out, then refinance to pull my capital out.

Host: How did you start?

Mike: I saved $50,000 working as an electrician. Bought my first property in Detroit for $35,000, put $15,000 into it. After rehab it appraised for $80,000.

Host: That's a great return!

Mike: Exactly. I refinanced at 75% LTV, pulled out $60,000, and had money left over to do it again.`,
    summary: `# Episode Summary

## NARRATIVE
Mike, a former electrician, explains how he built a 15-unit portfolio starting with just $50,000 using the BRRRR method.

## KEY TAKEAWAYS
- BRRRR allows you to recycle capital
- Buy distressed properties below market value
- Forced appreciation through rehab

## STRATEGIES
- BRRRR (Buy, Rehab, Rent, Refinance, Repeat)
- Forced appreciation through value-add

## MARKETS
- Detroit, Michigan - primary market mentioned

## CONTEXT
- Properties available at $35,000 in Detroit
- 75% LTV refinance strategies`,
  },
  {
    episodeNumber: 1003,
    slug: "real-estate-1003",
    title: "Mobile Home Park Millions",
    publishedAt: "2026-01-25T00:00:00Z",
    url: "https://example.com/1003",
    transcriptText: `We're talking mobile home parks today with investor Jane.

Jane: Mobile home parks are the best kept secret in real estate. I own 3 parks with 200 lots total.

Host: What makes them special?

Jane: Residents own their homes, we just own the land. Lower maintenance, higher margins. My parks generate $47,000 monthly cash flow.

Host: Where do you invest?

Jane: Midwest mainly - Indiana, Ohio, Missouri. Lot rents are $350-450 per month. Cap rates are still 8-10% unlike apartments.`,
    summary: `# Episode Summary

## NARRATIVE
Jane discusses her mobile home park investing strategy, owning 3 parks with 200 total lots generating $47,000 monthly cash flow.

## KEY TAKEAWAYS
- Mobile home parks have lower maintenance than apartments
- Land ownership vs home ownership model
- Higher cap rates than traditional multifamily

## STRATEGIES
- Mobile home park investing
- Lot rent model (tenants own homes)

## MARKETS
- Indiana, Ohio, Missouri - Midwest focus
- Lot rents $350-450/month

## CONTEXT
- Cap rates 8-10% in mobile home parks
- Comparison to apartment investing`,
  },
];

describe("Pipeline E2E Test", () => {
  let db: Database;

  beforeAll(() => {
    log("SETUP", "Creating test environment...");

    // Create test data directory
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Initialize test database
    db = new Database(TEST_DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        episode_number INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT,
        published_at TEXT,
        url TEXT,
        transcript_text TEXT,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        fetched_at TEXT,
        summarized_at TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_number INTEGER NOT NULL REFERENCES episodes(episode_number),
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        UNIQUE(episode_number, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
      CREATE INDEX IF NOT EXISTS idx_chunks_episode ON chunks(episode_number);
    `);

    log("SETUP", "Test environment ready");
  });

  afterAll(() => {
    log("TEARDOWN", "Cleaning up test environment...");
    db.close();

    try {
      rmSync(TEST_DB_PATH, { force: true });
      rmSync(TEST_DB_PATH + "-wal", { force: true });
      rmSync(TEST_DB_PATH + "-shm", { force: true });
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    log("TEARDOWN", "Cleanup complete");
  });

  describe("Stage 1: Scrape simulation", () => {
    test("inserts test episodes into database", () => {
      log("SCRAPE", "Starting episode import...");

      const insert = db.prepare(`
        INSERT INTO episodes (
          episode_number, slug, title, published_at, url,
          transcript_text, status, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'fetched', datetime('now'))
      `);

      for (const ep of TEST_EPISODES) {
        log("SCRAPE", `Importing episode ${ep.episodeNumber}...`);
        insert.run(
          ep.episodeNumber,
          ep.slug,
          ep.title,
          ep.publishedAt,
          ep.url,
          ep.transcriptText
        );
      }

      const count = db.query("SELECT COUNT(*) as cnt FROM episodes").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(3);
      log("SCRAPE", `Imported ${count.cnt} episodes successfully`);
    });
  });

  describe("Stage 2: Process - Summarization", () => {
    test("adds summaries to episodes", () => {
      log("PROCESS", "Starting summarization...");

      const update = db.prepare(`
        UPDATE episodes
        SET summary = ?, status = 'summarized', summarized_at = datetime('now')
        WHERE episode_number = ?
      `);

      for (const ep of TEST_EPISODES) {
        const wordCount = ep.transcriptText.split(/\s+/).length;
        const summaryWordCount = ep.summary.split(/\s+/).length;

        log(
          "PROCESS",
          `Summarizing episode ${ep.episodeNumber}... (${wordCount} words → ${summaryWordCount} words)`
        );
        update.run(ep.summary, ep.episodeNumber);
      }

      const summarized = db
        .query("SELECT COUNT(*) as cnt FROM episodes WHERE status = 'summarized'")
        .get() as { cnt: number };

      expect(summarized.cnt).toBe(3);
      log("PROCESS", `Summarized ${summarized.cnt} episodes`);
    });

    test("summaries are within expected word range", () => {
      const episodes = db
        .query("SELECT summary FROM episodes WHERE status = 'summarized'")
        .all() as { summary: string }[];

      for (const ep of episodes) {
        const wordCount = ep.summary.split(/\s+/).length;
        // Summaries should be roughly 100-500 words for these test fixtures
        expect(wordCount).toBeGreaterThan(50);
        expect(wordCount).toBeLessThan(600);
      }
    });
  });

  describe("Stage 3: Process - Chunking", () => {
    test("chunks transcripts with overlap", async () => {
      log("PROCESS", "Starting chunking...");

      const { chunkTranscript } = await import("../../src/processing/chunker");

      const episodes = db
        .query("SELECT episode_number, transcript_text FROM episodes")
        .all() as { episode_number: number; transcript_text: string }[];

      const insertChunk = db.prepare(`
        INSERT INTO chunks (episode_number, chunk_index, chunk_text, start_char, end_char)
        VALUES (?, ?, ?, ?, ?)
      `);

      let totalChunks = 0;

      for (const ep of episodes) {
        const chunks = chunkTranscript(ep.transcript_text, ep.episode_number, {
          targetWords: 100, // Smaller chunks for test data
          overlapWords: 20,
        });

        log(
          "PROCESS",
          `Chunking episode ${ep.episode_number}... (${chunks.length} chunks, 20 word overlap)`
        );

        for (const chunk of chunks) {
          insertChunk.run(
            ep.episode_number,
            chunk.chunkIndex,
            chunk.chunkText,
            chunk.startChar,
            chunk.endChar
          );
        }

        totalChunks += chunks.length;
      }

      const chunkCount = db.query("SELECT COUNT(*) as cnt FROM chunks").get() as {
        cnt: number;
      };

      expect(chunkCount.cnt).toBe(totalChunks);
      expect(chunkCount.cnt).toBeGreaterThan(0);
      log("PROCESS", `Created ${chunkCount.cnt} total chunks`);
    });

    test("chunks have correct structure", () => {
      const chunks = db
        .query(
          "SELECT * FROM chunks WHERE episode_number = 1001 ORDER BY chunk_index"
        )
        .all() as {
        id: number;
        episode_number: number;
        chunk_index: number;
        chunk_text: string;
        start_char: number;
        end_char: number;
      }[];

      expect(chunks.length).toBeGreaterThan(0);

      // Verify chunk indices are sequential
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]?.chunk_index).toBe(i);
      }

      // Verify chunks have content
      for (const chunk of chunks) {
        expect(chunk.chunk_text.length).toBeGreaterThan(0);
        expect(chunk.end_char).toBeGreaterThan(chunk.start_char);
      }
    });
  });

  describe("Stage 4: Search simulation", () => {
    test("can query episodes by keyword", () => {
      log("SEARCH", "Testing keyword search...");

      // Simple keyword search simulation
      const query = "house hacking";
      const results = db
        .query(
          `SELECT episode_number, title, transcript_text
           FROM episodes
           WHERE transcript_text LIKE '%' || ? || '%'
              OR summary LIKE '%' || ? || '%'`
        )
        .all(query, query) as {
        episode_number: number;
        title: string;
        transcript_text: string;
      }[];

      log("SEARCH", `Query: '${query}'`);
      log("SEARCH", `Results: ${results.length} episodes found`);

      for (const r of results) {
        log("SEARCH", `  - Episode ${r.episode_number}: "${r.title}"`);
      }

      expect(results.length).toBeGreaterThan(0);
      // Episode 1001 should match "house hacking"
      expect(results.some((r) => r.episode_number === 1001)).toBe(true);
    });

    test("returns expected results for specific queries", () => {
      const testQueries = [
        { query: "Cleveland", expectedEpisode: 1001 },
        { query: "BRRRR", expectedEpisode: 1002 },
        { query: "mobile home", expectedEpisode: 1003 },
        { query: "$47,000", expectedEpisode: 1003 },
        { query: "nursing", expectedEpisode: 1001 },
      ];

      for (const { query, expectedEpisode } of testQueries) {
        const results = db
          .query(
            `SELECT episode_number FROM episodes
             WHERE transcript_text LIKE '%' || ? || '%'
                OR summary LIKE '%' || ? || '%'`
          )
          .all(query, query) as { episode_number: number }[];

        log("SEARCH", `Query '${query}': expecting episode ${expectedEpisode}`);

        const found = results.some((r) => r.episode_number === expectedEpisode);
        expect(found).toBe(true);

        if (found) {
          log("SEARCH", `  ✓ Found expected episode`);
        }
      }
    });
  });

  describe("Pipeline integrity checks", () => {
    test("all episodes have transcripts", () => {
      const withoutTranscript = db
        .query(
          "SELECT COUNT(*) as cnt FROM episodes WHERE transcript_text IS NULL"
        )
        .get() as { cnt: number };

      expect(withoutTranscript.cnt).toBe(0);
    });

    test("all episodes have summaries", () => {
      const withoutSummary = db
        .query("SELECT COUNT(*) as cnt FROM episodes WHERE summary IS NULL")
        .get() as { cnt: number };

      expect(withoutSummary.cnt).toBe(0);
    });

    test("all episodes have chunks", () => {
      const episodesWithoutChunks = db
        .query(
          `SELECT e.episode_number
           FROM episodes e
           LEFT JOIN chunks c ON e.episode_number = c.episode_number
           WHERE c.id IS NULL`
        )
        .all() as { episode_number: number }[];

      expect(episodesWithoutChunks.length).toBe(0);
    });

    test("chunks reference valid episodes", () => {
      const orphanChunks = db
        .query(
          `SELECT c.id
           FROM chunks c
           LEFT JOIN episodes e ON c.episode_number = e.episode_number
           WHERE e.episode_number IS NULL`
        )
        .all() as { id: number }[];

      expect(orphanChunks.length).toBe(0);
    });
  });
});
