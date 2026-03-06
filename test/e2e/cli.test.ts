/**
 * E2E CLI Command Smoke Tests
 *
 * Tests the CLI commands: search, summary, episode
 * Validates error handling, exit codes, and output formats
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Test utilities
function log(message: string): void {
  console.log(`[CLI-TEST] ${message}`);
}

// Import CLI utilities to test them directly
import {
  CLIError,
  formatError,
  formatSearchResults,
  parseArgs,
  validateEpisodeNumber,
  validateSearchQuery,
  showHelp,
} from "../../src/cli";
import type { SearchResult } from "../../src/types";

describe("CLI utility functions", () => {
  describe("parseArgs", () => {
    test("parses command and arguments", () => {
      const result = parseArgs(["bun", "cli.ts", "search", "house", "hacking"]);
      expect(result.command).toBe("search");
      expect(result.args).toEqual(["house", "hacking"]);
    });

    test("returns null command for --help", () => {
      const result = parseArgs(["bun", "cli.ts", "--help"]);
      expect(result.command).toBeNull();
    });

    test("returns null command for -h", () => {
      const result = parseArgs(["bun", "cli.ts", "-h"]);
      expect(result.command).toBeNull();
    });

    test("returns null command when no args", () => {
      const result = parseArgs(["bun", "cli.ts"]);
      expect(result.command).toBeNull();
    });
  });

  describe("validateEpisodeNumber", () => {
    test("parses valid episode number", () => {
      expect(validateEpisodeNumber("1001")).toBe(1001);
      expect(validateEpisodeNumber("1")).toBe(1);
      expect(validateEpisodeNumber("99999")).toBe(99999);
    });

    test("throws on missing episode number", () => {
      expect(() => validateEpisodeNumber(undefined)).toThrow(CLIError);
      expect(() => validateEpisodeNumber(undefined)).toThrow("Episode number required");
    });

    test("throws on invalid episode number", () => {
      expect(() => validateEpisodeNumber("abc")).toThrow(CLIError);
      expect(() => validateEpisodeNumber("0")).toThrow(CLIError);
      expect(() => validateEpisodeNumber("-1")).toThrow(CLIError);
      expect(() => validateEpisodeNumber("")).toThrow(CLIError);
    });
  });

  describe("validateSearchQuery", () => {
    test("joins args into query string", () => {
      expect(validateSearchQuery(["house", "hacking"])).toBe("house hacking");
      expect(validateSearchQuery(["BRRRR"])).toBe("BRRRR");
    });

    test("throws on empty query", () => {
      expect(() => validateSearchQuery([])).toThrow(CLIError);
      expect(() => validateSearchQuery([""])).toThrow(CLIError);
      expect(() => validateSearchQuery(["  "])).toThrow(CLIError);
    });
  });

  describe("formatError", () => {
    test("formats CLIError with message", () => {
      const error = new CLIError("Episode not found");
      expect(formatError(error)).toBe("Error: Episode not found");
    });

    test("formats generic Error", () => {
      const error = new Error("Something went wrong");
      expect(formatError(error)).toBe("Error: Something went wrong");
    });

    test("formats SQLite errors specially", () => {
      const error = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
      expect(formatError(error)).toContain("Database error");
    });

    test("handles non-Error values", () => {
      expect(formatError("string error")).toBe("Error: string error");
      expect(formatError(null)).toBe("Error: null");
    });
  });

  describe("formatSearchResults", () => {
    test("formats results with ranking", () => {
      const results: SearchResult[] = [
        {
          episodeNumber: 1246,
          title: "$1 Rental Properties",
          publishedAt: new Date("2026-03-15"),
          matchingSnippet: "quit my nursing job after hitting $4k/month cash flow",
          similarity: 0.92,
          matchType: "chunk",
        },
        {
          episodeNumber: 803,
          title: "From ER Nurse to 15 Units",
          publishedAt: new Date("2024-10-20"),
          matchingSnippet: "was working doubles in the ER",
          similarity: 0.85,
          matchType: "summary",
        },
      ];

      const formatted = formatSearchResults(results);
      log(`Formatted output:\n${formatted}`);

      expect(formatted).toContain("1. Episode 1246");
      expect(formatted).toContain("2. Episode 803");
      expect(formatted).toContain("$1 Rental Properties");
      expect(formatted).toContain("quit my nursing job");
    });

    test("handles empty results", () => {
      const formatted = formatSearchResults([]);
      expect(formatted).toBe("No matching episodes found.");
    });
  });

  describe("CLIError", () => {
    test("has default exit code of 1", () => {
      const error = new CLIError("Test error");
      expect(error.exitCode).toBe(1);
    });

    test("accepts custom exit code", () => {
      const error = new CLIError("Test error", 2);
      expect(error.exitCode).toBe(2);
    });
  });
});

describe("CLI commands (integration)", () => {
  const TEST_DB_PATH = "/tmp/cli-test.db";

  beforeAll(() => {
    // Set up test database with sample data
    log("Setting up test database...");

    const db = new Database(TEST_DB_PATH, { create: true });

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
    `);

    // Insert test episodes
    const insert = db.prepare(`
      INSERT INTO episodes (episode_number, slug, title, published_at, transcript_text, summary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      1001,
      "real-estate-1001",
      "House Hacking 101",
      "2026-01-15",
      "This is a test transcript about house hacking strategies. The guest quit their nursing job to pursue real estate full time.",
      "# Summary\n\nThis episode covers house hacking strategies...",
      "summarized"
    );

    insert.run(
      1002,
      "real-estate-1002",
      "BRRRR Method Deep Dive",
      "2026-01-20",
      "BRRRR stands for Buy, Rehab, Rent, Refinance, Repeat...",
      null, // Not yet summarized
      "fetched"
    );

    db.close();
    log("Test database ready");
  });

  afterAll(() => {
    // Clean up test database
    log("Cleaning up test database...");
    try {
      rmSync(TEST_DB_PATH, { force: true });
      rmSync(TEST_DB_PATH + "-wal", { force: true });
      rmSync(TEST_DB_PATH + "-shm", { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("search command validation", () => {
    test("requires query argument", () => {
      log("Testing: search with no query");
      expect(() => validateSearchQuery([])).toThrow("Search query required");
      log("PASS: Got expected error for empty query");
    });

    test("accepts multi-word queries", () => {
      log("Testing: search with multi-word query");
      const query = validateSearchQuery(["house", "hacking", "strategies"]);
      expect(query).toBe("house hacking strategies");
      log("PASS: Query parsed correctly");
    });
  });

  describe("summary command validation", () => {
    test("requires episode number", () => {
      log("Testing: summary with no episode number");
      expect(() => validateEpisodeNumber(undefined)).toThrow("Episode number required");
      log("PASS: Got expected error for missing episode");
    });

    test("validates episode number format", () => {
      log("Testing: summary with invalid episode number");
      expect(() => validateEpisodeNumber("abc")).toThrow("Invalid episode number");
      log("PASS: Got expected error for invalid format");
    });
  });

  describe("episode command validation", () => {
    test("validates episode number", () => {
      log("Testing: episode with valid number");
      const num = validateEpisodeNumber("1001");
      expect(num).toBe(1001);
      log("PASS: Episode number validated");
    });
  });
});

describe("Error messages", () => {
  test("missing episode error is clear", () => {
    const error = new CLIError("Episode 99999 does not exist");
    expect(formatError(error)).toBe("Error: Episode 99999 does not exist");
  });

  test("not summarized error is clear", () => {
    const error = new CLIError("Episode 1002 exists but has not been summarized yet");
    expect(formatError(error)).toContain("not been summarized yet");
  });

  test("empty search results message is user-friendly", () => {
    const results = formatSearchResults([]);
    expect(results).toBe("No matching episodes found.");
  });
});

// Subprocess smoke tests - spawn actual CLI process
describe("CLI subprocess smoke tests", () => {
  const CLI_PATH = join(import.meta.dir, "../../index.ts");
  const TEST_DB_DIR = "/tmp/cli-e2e-subprocess";
  const TEST_DB_PATH = join(TEST_DB_DIR, "bp.db");

  interface CLIResult {
    exitCode: number;
    stdout: string;
    stderr: string;
  }

  async function runCLI(args: string[], env: Record<string, string> = {}): Promise<CLIResult> {
    const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
      env: { ...process.env, BP_DB_PATH: TEST_DB_PATH, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    log(`Testing: bp ${args.join(" ")}`);
    log(`Exit code: ${exitCode}`);
    if (stdout.trim()) log(`Output: ${stdout.trim()}`);
    if (stderr.trim()) log(`Stderr: ${stderr.trim()}`);

    return { exitCode, stdout, stderr };
  }

  beforeAll(() => {
    log("Setting up subprocess test database...");

    // Create test directory
    mkdirSync(TEST_DB_DIR, { recursive: true });

    const db = new Database(TEST_DB_PATH, { create: true });

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
    `);

    const insert = db.prepare(`
      INSERT INTO episodes (episode_number, slug, title, published_at, url, transcript_text, summary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Episode with both transcript and summary
    insert.run(
      1001,
      "real-estate-1001",
      "House Hacking 101",
      "2026-01-15T00:00:00Z",
      "https://biggerpockets.com/podcasts/1001",
      "This is a test transcript about house hacking strategies. The guest quit their nursing job to pursue real estate full time. They started by living in a duplex and renting out the other unit.",
      "# Summary\n\nThis episode covers house hacking strategies for beginners.",
      "summarized"
    );

    // Episode with transcript but no summary
    insert.run(
      1002,
      "real-estate-1002",
      "BRRRR Method Deep Dive",
      "2026-01-20T00:00:00Z",
      "https://biggerpockets.com/podcasts/1002",
      "BRRRR stands for Buy, Rehab, Rent, Refinance, Repeat. This strategy allows you to recycle capital.",
      null,
      "fetched"
    );

    // Episode with status 'missing' (no transcript)
    insert.run(
      1003,
      "real-estate-1003",
      "Missing Transcript Episode",
      "2026-01-25T00:00:00Z",
      "https://biggerpockets.com/podcasts/1003",
      null,
      null,
      "missing"
    );

    db.close();
    log("Subprocess test database ready");
  });

  afterAll(() => {
    log("Cleaning up subprocess test database...");
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("help command", () => {
    test("--help shows usage and exits 0", async () => {
      const result = await runCLI(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("BiggerPockets Brain");
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("search");
      expect(result.stdout).toContain("summary");
      expect(result.stdout).toContain("episode");
      log("PASS: Help displayed correctly");
    });

    test("-h shows usage and exits 0", async () => {
      const result = await runCLI(["-h"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      log("PASS: Short help flag works");
    });

    test("no args shows help and exits 0", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      log("PASS: No args shows help");
    });
  });

  describe("episode command", () => {
    test("valid episode with transcript → shows transcript, exits 0", async () => {
      const result = await runCLI(["episode", "1001"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Episode 1001");
      expect(result.stdout).toContain("House Hacking 101");
      expect(result.stdout).toContain("house hacking strategies");
      log("PASS: Episode 1001 transcript displayed");
    });

    test("valid episode with --raw → outputs only transcript text", async () => {
      const result = await runCLI(["episode", "1001", "--raw"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("house hacking strategies");
      expect(result.stdout).not.toContain("# Episode");
      log("PASS: Raw output works");
    });

    test("missing episode → error message, exits 1", async () => {
      const result = await runCLI(["episode", "99999"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Episode 99999 does not exist");
      log("PASS: Missing episode error");
    });

    test("episode with missing transcript → appropriate error", async () => {
      const result = await runCLI(["episode", "1003"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("transcript not available");
      log("PASS: Missing transcript handled");
    });

    test("no episode number → error message, exits 1", async () => {
      const result = await runCLI(["episode"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Episode number required");
      log("PASS: Missing episode number error");
    });

    test("invalid episode number → error message, exits 1", async () => {
      const result = await runCLI(["episode", "abc"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid episode number");
      log("PASS: Invalid episode number error");
    });
  });

  describe("summary command", () => {
    test("valid episode with summary → shows summary, exits 0", async () => {
      const result = await runCLI(["summary", "1001"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Episode 1001");
      expect(result.stdout).toContain("House Hacking 101");
      expect(result.stdout).toContain("Summary");
      expect(result.stdout).toContain("house hacking strategies");
      log("PASS: Summary displayed");
    });

    test("summary with --raw → outputs only summary text", async () => {
      const result = await runCLI(["summary", "1001", "--raw"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Summary");
      expect(result.stdout).not.toContain("(Jan 2026)");
      log("PASS: Raw summary works");
    });

    test("missing episode → error message, exits 1", async () => {
      const result = await runCLI(["summary", "99999"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Episode 99999 does not exist");
      log("PASS: Missing episode summary error");
    });

    test("episode not yet summarized → appropriate error, exits 1", async () => {
      const result = await runCLI(["summary", "1002"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not been summarized yet");
      log("PASS: Not summarized error");
    });

    test("no episode number → error message, exits 1", async () => {
      const result = await runCLI(["summary"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Episode number required");
      log("PASS: Missing episode number for summary");
    });
  });

  describe("search command", () => {
    test("no query → error message, exits 1", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Search query required");
      log("PASS: Empty search query error");
    });

    test("search without API key → appropriate error", async () => {
      const result = await runCLI(["search", "house", "hacking"], { EMBEDDING_API_KEY: "" });
      expect(result.exitCode).toBe(1);
      // Should fail due to missing API key or embeddings
      expect(result.stderr.length).toBeGreaterThan(0);
      log("PASS: Search without API key handled");
    });

    test("invalid search option → error message", async () => {
      const result = await runCLI(["search", "--invalid-option"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown search option");
      log("PASS: Invalid search option error");
    });

    test("--limit requires value → error message", async () => {
      const result = await runCLI(["search", "house", "--limit"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--limit requires a value");
      log("PASS: Missing limit value error");
    });
  });

  describe("unknown command", () => {
    test("unknown command → error message, exits 1", async () => {
      const result = await runCLI(["unknowncommand"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command");
      log("PASS: Unknown command error");
    });
  });
});
