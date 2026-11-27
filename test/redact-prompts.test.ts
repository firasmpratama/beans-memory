import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { redactPromptRows } from "../src/redact-prompts";

let directory: string;
let db: Database;

function insert(body: string): void {
  db.run(
    "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
    ["s1", "demo", body, "2026-01-01T00:00:00.000Z", 1767225600000],
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "beans-memory-redact-prompts-"));
  db = openDb(join(directory, "memory.db"));
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("redactPromptRows", () => {
  test("redacts stored prompts and is idempotent", () => {
    insert("my token is sk-abcdefghijklmnopqrstuvwxyz");
    insert("clean prompt");

    expect(redactPromptRows(db)).toEqual({ scanned: 2, redacted: 1 });

    const bodies = db
      .query<{ body: string }, []>("SELECT body FROM prompts ORDER BY id")
      .all()
      .map((row) => row.body);
    expect(bodies).toEqual(["my token is sk-***", "clean prompt"]);
    expect(redactPromptRows(db)).toEqual({ scanned: 2, redacted: 0 });
  });

  test("runs as a CLI entrypoint", () => {
    const cliDb = join(directory, "cli.db");
    const handle = openDb(cliDb);
    handle.run(
      "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
      [
        "s1",
        "demo",
        "my token is sk-abcdefghijklmnopqrstuvwxyz",
        "2026-01-01T00:00:00.000Z",
        1767225600000,
      ],
    );
    handle.close();

    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "src", "redact-prompts.ts"), cliDb],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      db: cliDb,
      scanned: 1,
      redacted: 1,
    });
  });
});
