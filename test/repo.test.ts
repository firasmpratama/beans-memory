import { afterAll, describe, expect, test } from "bun:test";
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
  stats,
  touchSessionFiles,
} from "../src/repo";

const directory = mkdtempSync(join(tmpdir(), "beans-memory-"));
const db = openDb(join(directory, "memory.db"));
const project = "demo";

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("memory store", () => {
  test("stores an observation and finds it with FTS", () => {
    const result = addObservation(db, {
      project,
      title: "TrMappingService active condition",
      body: "applyActiveForTrCondition sekarang mengecek revoked_key_at sebelum menghitung closing.",
      type: "bugfix",
      files: ["app/Services/TenantRelation/TrMappingService.php"],
    });

    expect(result.inserted).toBe(true);

    const rows = searchObservations(db, { project, query: "revoked_key_at" });
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(result.id);
  });

  test("deduplicates identical observations", () => {
    const first = addObservation(db, { project, title: "Sama", body: "isi" });
    const second = addObservation(db, { project, title: "Sama", body: "isi" });
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);
  });

  test("returns full observation bodies by id", () => {
    const result = addObservation(db, {
      project,
      title: "Manual transaction",
      body: "requester_notes wajib, closing_id nullable",
      type: "decision",
    });
    const rows = getObservations(db, [result.id]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toContain("requester_notes");
  });

  test("recent observations are ordered newest first", () => {
    addObservation(db, { project, title: "Terbaru", body: "x", createdAt: "2099-01-01T00:00:00Z" });
    const rows = recentObservations(db, project, 1);
    expect(rows[0]?.title).toBe("Terbaru");
  });

  test("stores prompts and counts sessions", () => {
    ensureSession(db, { id: "ses_1", project, directory });
    addPrompt(db, { sessionID: "ses_1", project, body: "cek guard reset closing" });
    touchSessionFiles(db, "ses_1", ["app/Foo.php"]);
    const value = stats(db, project);
    expect(value.prompts).toBe(1);
    expect(value.sessions).toBe(1);
    expect(value.observations).toBeGreaterThanOrEqual(3);
  });
});
