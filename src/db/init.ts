import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { CREATE_SCHEMA_STATEMENTS } from "./schema";

export const DEFAULT_DB_PATH = "data/biggerpockets.db";

export type SqliteDatabase = Database;

export interface DatabaseInitOptions {
  dbPath?: string;
  enableWal?: boolean;
}

export function resolveDatabasePath(dbPathOverride?: string): string {
  const candidatePath = dbPathOverride ?? process.env.BP_DB_PATH ?? DEFAULT_DB_PATH;
  return resolve(candidatePath);
}

export function runSchemaMigrations(db: SqliteDatabase): void {
  const migrate = db.transaction(() => {
    for (const statement of CREATE_SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
  });

  migrate();
}

export function initializeDatabase(
  options: DatabaseInitOptions = {},
): { db: SqliteDatabase; dbPath: string } {
  const dbPath = resolveDatabasePath(options.dbPath);
  const enableWal = options.enableWal ?? true;

  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true, strict: true });

  try {
    db.exec("PRAGMA foreign_keys = ON;");
    if (enableWal) {
      db.exec("PRAGMA journal_mode = WAL;");
    }

    runSchemaMigrations(db);

    return { db, dbPath };
  } catch (error) {
    db.close();
    throw error;
  }
}
