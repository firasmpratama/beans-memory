import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDbPath } from "../src/db";

const directory = mkdtempSync(join(tmpdir(), "beans-memory-path-"));
const decoy = join(directory, "decoy");

let originalOverride: string | undefined;

beforeEach(() => {
  originalOverride = process.env.MEMORY_DB;
  delete process.env.MEMORY_DB;
});

afterEach(() => {
  if (originalOverride === undefined) {
    delete process.env.MEMORY_DB;
  } else {
    process.env.MEMORY_DB = originalOverride;
  }
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("resolveDbPath", () => {
  test("honors MEMORY_DB and creates the parent directory", () => {
    const home = join(directory, "home-override");
    mkdirSync(home, { recursive: true });
    const target = join(directory, "custom", "nested", "memory.db");
    process.env.MEMORY_DB = target;

    const resolved = resolveDbPath(decoy, home);

    expect(resolved).toBe(target);
    expect(existsSync(dirname(target))).toBe(true);
  });

  test("copies a legacy agent-memory database on first use", () => {
    const home = join(directory, "home-legacy");
    const legacyDirectory = join(home, ".local", "share", "agent-memory");
    mkdirSync(legacyDirectory, { recursive: true });

    const legacyDb = new Database(join(legacyDirectory, "memory.db"), { create: true });
    legacyDb.run("CREATE TABLE notes (title TEXT)");
    legacyDb.run("INSERT INTO notes (title) VALUES ('old note')");
    legacyDb.close();

    const resolved = resolveDbPath(decoy, home);
    const current = join(home, ".local", "share", "beans-memory", "memory.db");

    expect(resolved).toBe(current);
    expect(existsSync(current)).toBe(true);

    const copy = new Database(current, { readonly: true });
    const row = copy.query<{ title: string }, []>("SELECT title FROM notes").get();
    copy.close();
    expect(row?.title).toBe("old note");

    const source = new Database(join(legacyDirectory, "memory.db"), { readonly: true });
    const sourceRow = source.query<{ title: string }, []>("SELECT title FROM notes").get();
    source.close();
    expect(sourceRow?.title).toBe("old note");
  });

  test("leaves the legacy database untouched when the copy fails", () => {
    const home = join(directory, "home-broken");
    const legacyDirectory = join(home, ".local", "share", "agent-memory");
    mkdirSync(legacyDirectory, { recursive: true });
    const legacyPath = join(legacyDirectory, "memory.db");
    writeFileSync(legacyPath, "not a database");

    const resolved = resolveDbPath(decoy, home);
    const current = join(home, ".local", "share", "beans-memory", "memory.db");

    expect(resolved).toBe(current);
    expect(existsSync(current)).toBe(false);
    expect(readFileSync(legacyPath, "utf8")).toBe("not a database");
  });

  test("keeps the current database when it already exists", () => {
    const home = join(directory, "home-current");
    const currentDirectory = join(home, ".local", "share", "beans-memory");
    const legacyDirectory = join(home, ".local", "share", "agent-memory");
    mkdirSync(currentDirectory, { recursive: true });
    mkdirSync(legacyDirectory, { recursive: true });

    const currentDb = new Database(join(currentDirectory, "memory.db"), { create: true });
    currentDb.run("CREATE TABLE notes (title TEXT)");
    currentDb.run("INSERT INTO notes (title) VALUES ('current note')");
    currentDb.close();

    const legacyDb = new Database(join(legacyDirectory, "memory.db"), { create: true });
    legacyDb.run("CREATE TABLE notes (title TEXT)");
    legacyDb.run("INSERT INTO notes (title) VALUES ('legacy note')");
    legacyDb.close();

    const resolved = resolveDbPath(decoy, home);
    expect(resolved).toBe(join(currentDirectory, "memory.db"));

    const db = new Database(join(currentDirectory, "memory.db"), { readonly: true });
    const row = db.query<{ title: string }, []>("SELECT title FROM notes").get();
    db.close();
    expect(row?.title).toBe("current note");
  });
});
