#!/usr/bin/env bun
import { initializeDatabase } from "../db";

const { db, dbPath } = initializeDatabase();
db.close();

console.log(
  JSON.stringify({
    ok: true,
    dbPath,
  }),
);
