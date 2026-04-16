import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "fs";
import path from "path";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbPath: string) {
  if (!_db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    _sqlite = new Database(dbPath);
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");

    // Load sqlite-vec extension
    sqliteVec.load(_sqlite);

    // Create tables
    _sqlite.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        title TEXT,
        url TEXT,
        tags TEXT,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    `);

    // Create sqlite-vec virtual table (768 dims for nomic-embed-text)
    _sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[768]
      );
    `);

    // Create FTS5 table for keyword search
    _sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content='chunks',
        content_rowid='id'
      );

      -- Triggers to keep FTS in sync with chunks table
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);

    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function getSqlite(): Database.Database {
  if (!_sqlite) throw new Error("Database not initialized. Call getDb() first.");
  return _sqlite;
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
