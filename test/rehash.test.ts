import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { rehashDatabase } from "../src/rehash";

let directory: string;
let db: Database;

function insert(hash: string, title: string, body: string): void {
  db.run(
    `INSERT INTO observations
      (project, type, title, body, files, concepts, source, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, '[]', '[]', 'agent', ?, '2026-01-01T00:00:00.000Z', 1767225600000)`,
    ["demo", "note", title, body, hash],
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "beans-memory-rehash-"));
  db = openDb(join(directory, "memory.db"));
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("rehashDatabase", () => {
  test("updates stale hashes and removes duplicates", () => {
    insert("old-a", "Same", "body");
    insert("old-b", "Same", "body");
    insert("old-c", "Unique", "other");

    const report = rehashDatabase(db);

    expect(report).toEqual({ scanned: 3, updated: 2, removed: 1 });
    expect(
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM observations").get()?.n,
    ).toBe(2);
  });

  test("is idempotent", () => {
    insert("old", "Stable", "body");
    rehashDatabase(db);

    expect(rehashDatabase(db)).toEqual({ scanned: 1, updated: 0, removed: 0 });
  });

  test("runs as a CLI entrypoint", () => {
    const cliDb = join(directory, "cli.db");
    const handle = openDb(cliDb);
    handle.run(
      `INSERT INTO observations
        (project, type, title, body, files, concepts, source, content_hash, created_at, created_at_epoch)
       VALUES ('demo', 'note', 'CLI note', 'body', '[]', '[]', 'agent', 'stale', '2026-01-01T00:00:00.000Z', 1767225600000)`,
    );
    handle.close();

    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "src", "rehash.ts"), cliDb],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      db: cliDb,
      scanned: 1,
      updated: 1,
      removed: 0,
    });
  });
});
