import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { runSchemaMigrations } from "../../../src/db";

function listSqlObjects(
  db: Database,
  objectType: "table" | "index",
): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name ASC")
    .all(objectType) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

describe("database schema migrations", () => {
  test("creates episodes/chunks tables and indexes", () => {
    const db = new Database(":memory:");

    runSchemaMigrations(db);

    const tables = listSqlObjects(db, "table");
    const indexes = listSqlObjects(db, "index");

    expect(tables).toContain("episodes");
    expect(tables).toContain("chunks");
    expect(indexes).toContain("idx_episodes_status");
    expect(indexes).toContain("idx_chunks_episode");

    db.close();
  });

  test("enforces episode status CHECK constraint", () => {
    const db = new Database(":memory:");
    runSchemaMigrations(db);

    const insertEpisode = db.query(
      "INSERT INTO episodes (episode_number, slug, status) VALUES (?, ?, ?)",
    );

    expect(() => insertEpisode.run(1, "real-estate-1", "pending")).not.toThrow();
    expect(() => insertEpisode.run(2, "real-estate-2", "invalid-status")).toThrow();

    db.close();
  });
});
