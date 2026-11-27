import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";

const directory = mkdtempSync(join(tmpdir(), "beans-memory-import-"));
const repoRoot = join(import.meta.dir, "..");

type Result = { code: number; out: string; err: string };

function runScript(script: string, args: string[]): Result {
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(repoRoot, "src", script), ...args],
    env: { ...process.env, MEMORY_DB: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode ?? -1,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

function caseDirectory(name: string): string {
  const path = join(directory, name);
  mkdirSync(path, { recursive: true });
  return path;
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("import scripts", () => {
  test("redacts imported prompts and survives null and invalid rows", () => {
    const root = caseDirectory("extras");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE session_summaries (project TEXT, request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT, created_at TEXT)",
    );
    source.run("CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT)");
    source.run(
      "CREATE TABLE user_prompts (content_session_id TEXT, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER, session_db_id INTEGER)",
    );
    source.run("INSERT INTO sdk_sessions (id, project) VALUES (1, 'demo')");
    source.run(
      "INSERT INTO session_summaries VALUES ('demo', 'Valid summary sk-abcdefghijklmnopqrstuvwxyz', '', '', '', '', '2026-01-01T00:00:00.000Z')",
    );
    source.run(
      "INSERT INTO session_summaries VALUES ('demo', 'Broken summary', '', '', '', '', 'not-a-date')",
    );
    source.run(
      "INSERT INTO user_prompts VALUES ('s1', 'my token is sk-abcdefghijklmnopqrstuvwxyz', '2026-01-01T00:00:00.000Z', 1767225600000, 1)",
    );
    source.run(
      "INSERT INTO user_prompts VALUES ('s2', NULL, '2026-01-01T00:00:00.000Z', 1767225600001, 1)",
    );
    source.run(
      "INSERT INTO user_prompts VALUES ('s3', 'second prompt', '2026-01-01T00:00:00.000Z', 1767225600002, 1)",
    );
    source.run(
      "INSERT INTO user_prompts VALUES ('s4', 'broken date prompt', 'not-a-date', 1767225600003, 1)",
    );
    source.close();

    const result = runScript("import-claude-mem-extras.ts", [
      "--source",
      sourcePath,
      "--db",
      dbPath,
    ]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.out) as {
      summaries: {
        total: number;
        inserted: number;
        dup: number;
        redacted: number;
        removed: number;
        scrubFailed: number;
        failed: number;
      };
      prompts: { total: number; inserted: number; dup: number; redacted: number; failed: number };
    };
    expect(report.summaries).toEqual({
      total: 2,
      inserted: 1,
      dup: 0,
      redacted: 0,
      removed: 0,
      scrubFailed: 0,
      failed: 1,
    });
    expect(report.prompts).toEqual({ total: 4, inserted: 2, dup: 0, redacted: 0, failed: 1 });

    const db = new Database(dbPath, { readonly: true });
    const prompts = db
      .query<{ body: string }, []>("SELECT body FROM prompts ORDER BY session_id")
      .all()
      .map((row) => row.body);
    const summaries = db
      .query<{ title: string }, []>("SELECT title FROM observations")
      .all()
      .map((row) => row.title);
    db.close();

    expect(prompts).toEqual(["my token is sk-***", "second prompt"]);
    expect(prompts.join(" ")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(summaries).toEqual(["Valid summary sk-***"]);

    const dry = runScript("import-claude-mem-extras.ts", [
      "--source",
      sourcePath,
      "--db",
      dbPath,
      "--dry-run",
    ]);
    expect(dry.code).toBe(0);
    const dryReport = JSON.parse(dry.out) as {
      summaries: { inserted: number; failed: number };
      prompts: { inserted: number; failed: number };
    };
    expect(dryReport.summaries).toMatchObject({ inserted: 1, failed: 1 });
    expect(dryReport.prompts).toMatchObject({ inserted: 2, failed: 1 });
  });

  test("scrubs secrets from previously imported summaries", () => {
    const root = caseDirectory("extras-scrub");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE session_summaries (project TEXT, request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT, created_at TEXT)",
    );
    source.run("CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT)");
    source.run(
      "CREATE TABLE user_prompts (content_session_id TEXT, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER, session_db_id INTEGER)",
    );
    source.close();

    const target = openDb(dbPath);
    target.run(
      "INSERT INTO observations (project, type, title, body, files, concepts, source, content_hash, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "demo",
        "session_summary",
        "secret sk-abcdefghijklmnopqrstuvwxyz",
        "token sk-abcdefghijklmnopqrstuvwxyz",
        "[]",
        "[]",
        "import_summary",
        "raw-hash",
        "2026-01-01T00:00:00.000Z",
        1767225600000,
      ],
    );
    target.close();

    const result = runScript("import-claude-mem-extras.ts", [
      "--source",
      sourcePath,
      "--db",
      dbPath,
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as { summaries: { redacted: number } };
    expect(report.summaries.redacted).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .query<{ title: string; body: string }, []>("SELECT title, body FROM observations")
      .all();
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("secret sk-***");
    expect(rows[0]?.body).toBe("token sk-***");
  });

  test("redacts an existing unsanitized imported prompt instead of duplicating it", () => {
    const root = caseDirectory("extras-existing");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");
    const epoch = 1767225600000;

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE session_summaries (project TEXT, request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT, created_at TEXT)",
    );
    source.run("CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT)");
    source.run(
      "CREATE TABLE user_prompts (content_session_id TEXT, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER, session_db_id INTEGER)",
    );
    source.run("INSERT INTO sdk_sessions (id, project) VALUES (1, 'demo')");
    source.run(
      "INSERT INTO user_prompts VALUES ('s1', 'my token is sk-abcdefghijklmnopqrstuvwxyz', '2026-01-01T00:00:00.000Z', 1767225600000, 1)",
    );
    source.close();

    const target = openDb(dbPath);
    target.run(
      "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
      [
        "s1",
        "demo",
        "my token is sk-abcdefghijklmnopqrstuvwxyz",
        "2026-01-01T00:00:00.000Z",
        epoch,
      ],
    );
    target.close();

    const result = runScript("import-claude-mem-extras.ts", [
      "--source",
      sourcePath,
      "--db",
      dbPath,
    ]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.out) as {
      prompts: { inserted: number; dup: number; redacted: number; failed: number };
    };
    expect(report.prompts).toMatchObject({ inserted: 0, dup: 0, redacted: 1, failed: 0 });

    const db = new Database(dbPath, { readonly: true });
    const prompts = db
      .query<{ body: string }, []>("SELECT body FROM prompts")
      .all()
      .map((row) => row.body);
    db.close();
    expect(prompts).toEqual(["my token is sk-***"]);
  });

  test("scrubs a legacy duplicate prompt even when sanitized duplicate already exists", () => {
    const root = caseDirectory("extras-mixed-duplicates");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");
    const epoch = 1767225600000;
    const secret = ["sk-", "abcdefghijklmnopqrstuvwxyz"].join("");
    const body = `my token is ${secret}`;

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE session_summaries (project TEXT, request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT, created_at TEXT)",
    );
    source.run("CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT)");
    source.run(
      "CREATE TABLE user_prompts (content_session_id TEXT, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER, session_db_id INTEGER)",
    );
    source.run("INSERT INTO sdk_sessions (id, project) VALUES (1, 'demo')");
    source.run(
      "INSERT INTO user_prompts VALUES ('s1', ?, '2026-01-01T00:00:00.000Z', ?, 1)",
      [body, epoch],
    );
    source.close();

    const target = openDb(dbPath);
    target.run(
      "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
      ["s1", "demo", "my token is sk-***", "2026-01-01T00:00:00.000Z", epoch],
    );
    target.run(
      "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
      ["s1", "demo", body, "2026-01-01T00:00:00.000Z", epoch],
    );
    target.close();

    const result = runScript("import-claude-mem-extras.ts", [
      "--source",
      sourcePath,
      "--db",
      dbPath,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).prompts).toMatchObject({
      inserted: 0,
      dup: 1,
      redacted: 1,
      failed: 0,
    });

    const db = new Database(dbPath, { readonly: true });
    const prompts = db.query<{ body: string }, []>("SELECT body FROM prompts ORDER BY id").all();
    db.close();
    expect(prompts).toEqual([{ body: "my token is sk-***" }, { body: "my token is sk-***" }]);
    expect(JSON.stringify(prompts)).not.toContain(secret);
  });

  test("continues past an observation with an invalid date", () => {
    const root = caseDirectory("observations");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE observations (project TEXT, type TEXT, title TEXT, subtitle TEXT, narrative TEXT, facts TEXT, concepts TEXT, files_modified TEXT, created_at)",
    );
    source.run(
      "INSERT INTO observations VALUES ('demo', 'decision', 'Valid note', '', 'body', '[]', '[]', '[]', 1767225600000)",
    );
    source.run(
      "INSERT INTO observations VALUES ('demo', 'decision', 'Broken note', '', 'body', '[]', '[]', '[]', 'not-a-date')",
    );
    source.close();

    const result = runScript("import-claude-mem-db.ts", ["--source", sourcePath, "--db", dbPath]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.out) as {
      projects: Record<string, { inserted: number; failed: number }>;
    };
    expect(report.projects.demo).toMatchObject({ inserted: 1, failed: 1 });

    const db = new Database(dbPath, { readonly: true });
    const titles = db
      .query<{ title: string }, []>("SELECT title FROM observations")
      .all()
      .map((row) => row.title);
    db.close();
    expect(titles).toEqual(["Valid note"]);

    const dryPath = join(root, "dry.db");
    const dry = runScript("import-claude-mem-db.ts", [
      "--source",
      sourcePath,
      "--db",
      dryPath,
      "--dry-run",
    ]);
    expect(dry.code).toBe(0);
    const dryReport = JSON.parse(dry.out) as {
      projects: Record<string, { inserted: number; failed: number }>;
    };
    expect(dryReport.projects.demo).toMatchObject({ inserted: 1, failed: 1 });
    expect(existsSync(dryPath)).toBe(false);
  });

  test("imports JSONL rows and skips invalid or unwanted lines", () => {
    const root = caseDirectory("jsonl");
    const jsonlPath = join(root, "observations.jsonl");
    const dbPath = join(root, "target.db");

    writeFileSync(
      jsonlPath,
      [
        JSON.stringify({
          project: "demo",
          type: "decision",
          title: "JSONL note",
          narrative: "narrative body",
          facts: JSON.stringify(["fact one"]),
          created_at: Date.UTC(2026, 0, 1),
        }),
        JSON.stringify({
          project: "demo",
          type: "discovery",
          title: "Discovery note",
          narrative: "discovery body",
          created_at: "2026-01-01T00:00:00.000Z",
        }),
        JSON.stringify({
          project: "demo",
          type: "decision",
          title: "Broken date note",
          narrative: "bad date body",
          created_at: "not-a-date",
        }),
        "{not json",
      ].join("\n"),
    );

    const result = runScript("import-claude-mem.ts", [
      "--jsonl",
      jsonlPath,
      "--db",
      dbPath,
      "--project",
      "demo",
    ]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.out) as {
      inserted: number;
      skippedType: number;
      failed: number;
    };
    expect(report).toMatchObject({ inserted: 1, skippedType: 1, failed: 2 });

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .query<{ title: string; body: string }, []>("SELECT title, body FROM observations")
      .all();
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("JSONL note");
    expect(rows[0]?.body).toContain("fact one");

    const dryPath = join(root, "dry.db");
    const dry = runScript("import-claude-mem.ts", [
      "--jsonl",
      jsonlPath,
      "--db",
      dryPath,
      "--project",
      "demo",
      "--dry-run",
    ]);
    expect(dry.code).toBe(0);
    const dryReport = JSON.parse(dry.out) as {
      inserted: number;
      skippedType: number;
      failed: number;
    };
    expect(dryReport).toMatchObject({ inserted: 1, skippedType: 1, failed: 2 });
    expect(existsSync(dryPath)).toBe(false);
  });

  test("migrate-legacy-db continues past invalid dates", () => {
    const root = caseDirectory("migrate");
    const sourcePath = join(root, "source.db");
    const dbPath = join(root, "target.db");

    const source = new Database(sourcePath, { create: true });
    source.run(
      "CREATE TABLE observations (project TEXT, type TEXT, title TEXT, body TEXT, files TEXT, concepts TEXT, source TEXT, created_at)",
    );
    source.run(
      "INSERT INTO observations VALUES ('demo', 'decision', 'Valid note', 'body', '[]', '[]', 'agent', 1767225600000)",
    );
    source.run(
      "INSERT INTO observations VALUES ('demo', 'decision', 'Broken note', 'body', '[]', '[]', 'agent', 'not-a-date')",
    );
    source.close();

    const result = runScript("migrate-legacy-db.ts", ["--from", sourcePath, "--db", dbPath]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.out) as { inserted: number; failed: number };
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    const titles = db
      .query<{ title: string }, []>("SELECT title FROM observations")
      .all()
      .map((row) => row.title);
    db.close();
    expect(titles).toEqual(["Valid note"]);
  });
});
