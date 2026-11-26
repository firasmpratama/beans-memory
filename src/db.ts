import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function resolveDbPath(_directory: string = process.cwd()): string {
  const override = process.env.MEMORY_DB;
  if (override) {
    mkdirSync(dirname(override), { recursive: true, mode: 0o700 });
    return resolve(override);
  }
  const folder = join(homedir(), ".local", "share", "agent-memory");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return join(folder, "memory.db");
}

function secure(path: string): void {
  if (path === ":memory:" || path.startsWith("file::memory:")) return;
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  for (const file of [`${path}-wal`, `${path}-shm`]) {
    try {
      chmodSync(file, 0o600);
    } catch {
      // sidecar may not exist yet
    }
  }
}

export function openDb(path: string = resolveDbPath()): Database {
  const db = new Database(path, { create: true });
  secure(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  secure(path);
  return db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      directory TEXT,
      title TEXT,
      files TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      project TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      body TEXT,
      files TEXT NOT NULL DEFAULT '[]',
      concepts TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'agent',
      content_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      title,
      body,
      files,
      content='observations',
      content_rowid='id',
      tokenize='unicode61'
    )
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, body, files)
      VALUES (new.id, new.title, coalesce(new.body, ''), new.files);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, body, files)
      VALUES ('delete', old.id, old.title, coalesce(old.body, ''), old.files);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, body, files)
      VALUES ('delete', old.id, old.title, coalesce(old.body, ''), old.files);
      INSERT INTO observations_fts(rowid, title, body, files)
      VALUES (new.id, new.title, coalesce(new.body, ''), new.files);
    END
  `);

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_observations_project_date ON observations(project, created_at_epoch DESC)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_prompts_project_date ON prompts(project, created_at_epoch DESC)",
  );
}
