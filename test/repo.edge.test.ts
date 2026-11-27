import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import {
  addObservation,
  addPrompt,
  ensureSession,
  getObservations,
  recentObservations,
  searchObservations,
  touchSessionFiles,
} from "../src/repo";

const project = "repo-edge";
let directory: string;
let db: Database;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "beans-memory-repo-edge-"));
  db = openDb(join(directory, "memory.db"));
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("observation query edge cases", () => {
  test("strips punctuation and quotes from FTS queries", () => {
    const saved = addObservation(db, {
      project,
      title: "Theta delta note",
      body: "Punctuation should not become FTS syntax.",
    });

    const rows = searchObservations(db, {
      project,
      query: '"theta" + delta!!!',
    });

    expect(rows.map((row) => row.id)).toEqual([saved.id]);
  });

  test("matches Unicode letters in FTS queries", () => {
    const saved = addObservation(db, {
      project,
      title: "Café 東京 memory",
      body: "Résumé and other accented words remain searchable.",
    });

    const rows = searchObservations(db, { project, query: "東京" });

    expect(rows.map((row) => row.id)).toEqual([saved.id]);
  });

  test("uses recent observations when query has no searchable tokens", () => {
    addObservation(db, {
      project,
      title: "Older note",
      body: "older body",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const newest = addObservation(db, {
      project,
      title: "Newest note",
      body: "newer body",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const rows = searchObservations(db, { project, query: "", limit: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(newest.id);
  });

  test("requires all query tokens when the AND search finds matches", () => {
    const both = addObservation(db, {
      project,
      title: "Amber cobalt",
      body: "Both search tokens live here.",
    });
    addObservation(db, { project, title: "Amber only", body: "Amber." });
    addObservation(db, { project, title: "Cobalt only", body: "Cobalt." });

    const rows = searchObservations(db, { project, query: "amber cobalt" });

    expect(rows.map((row) => row.id)).toEqual([both.id]);
  });

  test("falls back to OR when separate records match each query token", () => {
    const quartz = addObservation(db, {
      project,
      title: "Quartz record",
      body: "Quartz appears here.",
    });
    const opal = addObservation(db, {
      project,
      title: "Opal record",
      body: "Opal appears here.",
    });

    const rows = searchObservations(db, { project, query: "quartz opal" });

    expect(new Set(rows.map((row) => row.id))).toEqual(new Set([quartz.id, opal.id]));
  });

  test("deduplicates by project, title, and body hash despite metadata changes", () => {
    const first = addObservation(db, {
      project,
      title: "Stable title",
      body: "Stable body",
      type: "note",
    });

    const duplicate = addObservation(db, {
      project,
      title: "Stable title",
      body: "Stable body",
      type: "decision",
      files: ["src/repo.ts"],
    });

    expect(duplicate.inserted).toBe(false);
    expect(duplicate.id).toBe(first.id);
  });

  test("stores same-title observations when their bodies differ", () => {
    const first = addObservation(db, {
      project,
      title: "Repeated title",
      body: "First body",
    });
    const second = addObservation(db, {
      project,
      title: "Repeated title",
      body: "Second body",
    });

    expect(second.inserted).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  test("does not collide when a newline shifts text between title and body", () => {
    const first = addObservation(db, {
      project,
      title: "Rule\nDetails",
      body: "body",
    });
    const second = addObservation(db, {
      project,
      title: "Rule",
      body: "Details\nbody",
    });

    expect(second.inserted).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  test("excludes import summaries from recent observations", () => {
    const visible = addObservation(db, {
      project,
      title: "Visible observation",
      body: "normal source",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const summary = addObservation(db, {
      project,
      title: "Imported summary",
      body: "summary source",
      source: "import",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    db.run("UPDATE observations SET source = 'import_summary' WHERE id = ?", [summary.id]);

    const rows = recentObservations(db, project);

    expect(rows.map((row) => row.id)).toEqual([visible.id]);
  });

  test("filters FTS results by observation type", () => {
    addObservation(db, {
      project,
      title: "Shared keyword bugfix",
      body: "sharedkeyword",
      type: "bugfix",
    });
    const decision = addObservation(db, {
      project,
      title: "Shared keyword decision",
      body: "sharedkeyword",
      type: "decision",
    });

    const rows = searchObservations(db, {
      project,
      query: "sharedkeyword",
      type: "decision",
    });

    expect(rows.map((row) => row.id)).toEqual([decision.id]);
  });

  test("returns an empty list when getObservations receives no ids", () => {
    expect(getObservations(db, [])).toEqual([]);
  });

  test("returns an empty list when getObservations receives unknown ids", () => {
    expect(getObservations(db, [999999])).toEqual([]);
  });

  test("rejects an invalid createdAt instead of storing a corrupt date", () => {
    expect(() =>
      addObservation(db, {
        project,
        title: "Invalid date",
        body: "x",
        createdAt: "not-a-date",
      }),
    ).toThrow("createdAt tidak valid");

    expect(() =>
      addObservation(db, {
        project,
        title: "Empty date",
        body: "x",
        createdAt: "",
      }),
    ).toThrow("createdAt tidak valid");

    expect(() =>
      addObservation(db, {
        project,
        title: "Null date",
        body: "x",
        createdAt: null as unknown as string,
      }),
    ).toThrow("createdAt tidak valid");
  });

  test("ignores malformed session file payloads", () => {
    ensureSession(db, { id: "ses_bad", project });
    db.run("UPDATE sessions SET files = ? WHERE id = ?", ['{"file":"a"}', "ses_bad"]);

    expect(() => touchSessionFiles(db, "ses_bad", ["src/a.ts"])).not.toThrow();

    const stored = db
      .query<{ files: string }, [string]>("SELECT files FROM sessions WHERE id = ?")
      .get("ses_bad");
    expect(JSON.parse(stored!.files)).toEqual(["src/a.ts"]);
  });

  test("falls back to default limits for non-finite values", () => {
    addObservation(db, { project, title: "Limit one", body: "limitkeyword" });
    addObservation(db, { project, title: "Limit two", body: "limitkeyword" });

    expect(
      searchObservations(db, { project, query: "limitkeyword", limit: Number.NaN }),
    ).toHaveLength(2);
    expect(recentObservations(db, project, Number.NaN)).toHaveLength(2);
  });

  test("truncates oversized observation and prompt data and retains last 200 files", () => {
    const longTitle = `${"T".repeat(300)}x`;
    const longBody = `${"B".repeat(20000)}x`;
    const first = addObservation(db, {
      project,
      title: longTitle,
      body: longBody,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const replay = addObservation(db, {
      project,
      title: `${"T".repeat(300)}y`,
      body: `${"B".repeat(20000)}y`,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    ensureSession(db, { id: "ses_limits", project });
    addPrompt(db, { sessionID: "ses_limits", project, body: "P".repeat(8001) });
    const files = Array.from({ length: 205 }, (_, index) => `src/file-${index}.ts`);
    touchSessionFiles(db, "ses_limits", files);

    const observation = getObservations(db, [first.id])[0]!;
    const prompt = db.query<{ body: string }, []>("SELECT body FROM prompts").get()!;
    const storedFiles = db
      .query<{ files: string }, [string]>("SELECT files FROM sessions WHERE id = ?")
      .get("ses_limits")!;

    expect(replay).toEqual({ id: first.id, inserted: false });
    expect(observation.title).toHaveLength(300);
    expect(observation.body).toHaveLength(20000);
    expect(prompt.body).toHaveLength(8000);
    expect(JSON.parse(storedFiles.files)).toHaveLength(200);
    expect(JSON.parse(storedFiles.files)[0]).toBe("src/file-5.ts");
    expect(JSON.parse(storedFiles.files).at(-1)).toBe("src/file-204.ts");
  });

  test("caps search results at 50 and recent results at 200", () => {
    for (let index = 0; index < 205; index += 1) {
      addObservation(db, {
        project,
        title: `Limit boundary ${index}`,
        body: "cappedquerytoken",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      });
    }

    expect(searchObservations(db, { project, query: "cappedquerytoken", limit: 999 }).length).toBe(50);
    expect(recentObservations(db, project, 999).length).toBe(200);
    expect(recentObservations(db, project, 0).length).toBe(1);
  });
});
