import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { initializeDatabase } from "../../src/db";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE_DB_PATH = resolve(PROJECT_ROOT, "test/fixtures/cli-smoke.db");

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function seedFixtureDatabase(): void {
  mkdirSync(dirname(FIXTURE_DB_PATH), { recursive: true });

  const { db } = initializeDatabase({ dbPath: FIXTURE_DB_PATH });

  db.exec("DELETE FROM chunks;");
  db.exec("DELETE FROM episodes;");

  const insertEpisode = db.prepare(`
    INSERT INTO episodes (
      episode_number,
      slug,
      title,
      published_at,
      url,
      transcript_text,
      summary,
      status,
      fetched_at,
      summarized_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertEpisode.run(
    1001,
    "real-estate-1001",
    "House Hacking Starter Story",
    "2026-03-01T00:00:00.000Z",
    "https://www.biggerpockets.com/blog/real-estate-1001",
    "Episode 1001 transcript body.",
    "Episode 1001 summary body.",
    "summarized",
    "2026-03-01T00:00:00.000Z",
    "2026-03-01T00:05:00.000Z",
  );

  insertEpisode.run(
    1002,
    "real-estate-1002",
    "Transcript Exists But No Summary",
    "2026-03-02T00:00:00.000Z",
    "https://www.biggerpockets.com/blog/real-estate-1002",
    "Episode 1002 transcript body.",
    null,
    "fetched",
    "2026-03-02T00:00:00.000Z",
    null,
  );

  insertEpisode.run(
    1003,
    "real-estate-1003",
    "Missing Transcript Episode",
    "2026-03-03T00:00:00.000Z",
    "https://www.biggerpockets.com/blog/real-estate-1003",
    null,
    null,
    "missing",
    null,
    null,
  );

  db.close();
}

async function runCli(args: string[]): Promise<CliRunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "index.ts", ...args],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      BP_DB_PATH: FIXTURE_DB_PATH,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

beforeAll(() => {
  seedFixtureDatabase();
});

describe("CLI smoke e2e", () => {
  test("summary command returns formatted summary for existing episode", async () => {
    const result = await runCli(["summary", "1001"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Episode 1001: House Hacking Starter Story");
    expect(result.stdout).toContain("## Summary");
    expect(result.stdout).toContain("Episode 1001 summary body.");
  });

  test("summary command errors for missing episode", async () => {
    const result = await runCli(["summary", "99999"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Episode 99999 does not exist");
  });

  test("summary command errors when summary has not been generated", async () => {
    const result = await runCli(["summary", "1002"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Episode 1002 exists but has not been summarized yet");
  });

  test("episode command returns transcript for existing episode", async () => {
    const result = await runCli(["episode", "1001"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Episode 1001: House Hacking Starter Story");
    expect(result.stdout).toContain("Source: https://www.biggerpockets.com/blog/real-estate-1001");
    expect(result.stdout).toContain("Episode 1001 transcript body.");
  });

  test("episode command errors for missing episode", async () => {
    const result = await runCli(["episode", "99999"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Episode 99999 does not exist");
  });

  test("episode command errors when transcript is missing", async () => {
    const result = await runCli(["episode", "1003"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Episode 1003 exists but transcript not available");
  });

  test("search command errors when query is empty", async () => {
    const result = await runCli(["search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Search query required");
  });

  test("search command errors when embedding API key is missing", async () => {
    const result = await runCli(["search", "house hacking"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("EMBEDDING_API_KEY environment variable required for search");
  });
});
