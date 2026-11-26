import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "agent-memory-cli-"));
const db = join(directory, "memory.db");
const cli = join(import.meta.dir, "..", "src", "cli.ts");

function run(args: string[]): { code: number; out: string; err: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, cli, ...args],
    env: { ...process.env, MEMORY_DB: db, MEMORY_PROJECT: "demo" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode ?? -1,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("cli", () => {
  test("note, search, get, and stats", () => {
    const note = run([
      "note",
      "--title",
      "CLI smoke",
      "--body",
      "catatan dari cli",
      "--type",
      "decision",
      "--files",
      "src/a.ts,src/b.ts",
    ]);
    expect(note.code).toBe(0);
    expect(note.out).toContain("tersimpan");

    const search = run(["search", "catatan", "--limit", "5"]);
    expect(search.code).toBe(0);
    expect(search.out).toContain("CLI smoke");

    const get = run(["get", "1"]);
    expect(get.code).toBe(0);
    expect(get.out).toContain("catatan dari cli");
    expect(get.out).toContain("src/a.ts");

    const stats = run(["stats"]);
    expect(stats.code).toBe(0);
    expect(stats.out).toContain("1 catatan");
  });

  test("deduplicates identical notes", () => {
    run(["note", "--title", "Sama", "--body", "isi"]);
    const second = run(["note", "--title", "Sama", "--body", "isi"]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("identik");
  });

  test("json output is machine readable", () => {
    const result = run(["stats", "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed.observations).toBeGreaterThanOrEqual(2);
  });

  test("unknown command exits non-zero", () => {
    const result = run(["--tidak-ada"]);
    expect(result.code).not.toBe(0);
  });
});
