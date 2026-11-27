import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb, resolveDbPath } from "./db";
import { redactSecrets } from "./redact";
import { addObservation, observationHash, stats } from "./repo";
import { normalizeIsoDate } from "./time";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  const value = args[index + 1];
  return index >= 0 && value ? value : fallback;
}

const sourcePath = arg("source", join(homedir(), ".claude-mem", "claude-mem.db"));
const dbPath = arg("db", resolveDbPath());
const dryRun = args.includes("--dry-run");

function normalizeProject(project: string): string {
  const trimmed = project.trim();
  if (trimmed.startsWith("sinarmas-api/")) return "sinarmas-api";
  return trimmed;
}

function clip(value: string | null, limit: number): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const source = new Database(sourcePath, { readonly: true });
source.run("PRAGMA busy_timeout = 5000");
const db = dryRun ? null : openDb(dbPath);

const summaries = source
  .query<
    {
      project: string;
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      created_at: unknown;
    },
    []
  >(
    `SELECT project, request, investigated, learned, completed, next_steps, created_at
     FROM session_summaries ORDER BY created_at`,
  )
  .all();

let summaryInserted = 0;
let summaryDup = 0;
let summaryRedacted = 0;
let summaryRemoved = 0;
let summaryScrubFailed = 0;
let summaryFailed = 0;

function scrubImportedSummaries(): void {
  if (!db) return;
  const rows = db
    .query<{ id: number; project: string; title: string; body: string }, []>(
      "SELECT id, project, title, coalesce(body, '') AS body FROM observations WHERE source = 'import_summary'",
    )
    .all();

  for (const row of rows) {
    const title = redactSecrets(row.title).trim().slice(0, 300);
    const body = redactSecrets(row.body).trim().slice(0, 20000);
    if (title === row.title && body === row.body) continue;

    const hash = observationHash(row.project, title, body);
    try {
      db.run("UPDATE observations SET title = ?, body = ?, content_hash = ? WHERE id = ?", [
        title,
        body,
        hash,
        row.id,
      ]);
      summaryRedacted += 1;
    } catch {
      try {
        db.run("DELETE FROM observations WHERE id = ?", [row.id]);
        summaryRemoved += 1;
      } catch (deleteError) {
        summaryScrubFailed += 1;
        console.error(
          "ringkasan gagal dibersihkan:",
          deleteError instanceof Error ? deleteError.message : deleteError,
        );
      }
    }
  }
}

scrubImportedSummaries();

for (const row of summaries) {
  const project = normalizeProject(row.project);
  const request = redactSecrets(row.request ?? "");
  const investigated = redactSecrets(row.investigated ?? "");
  const learned = redactSecrets(row.learned ?? "");
  const completed = redactSecrets(row.completed ?? "");
  const nextSteps = redactSecrets(row.next_steps ?? "");
  const title = clip(request, 140) || "Ringkasan sesi";
  const body = [
    clip(request, 1200) ? `Request: ${clip(request, 1200)}` : "",
    clip(investigated, 1200) ? `Investigasi: ${clip(investigated, 1200)}` : "",
    clip(learned, 1500) ? `Dipelajari: ${clip(learned, 1500)}` : "",
    clip(completed, 1200) ? `Selesai: ${clip(completed, 1200)}` : "",
    clip(nextSteps, 600) ? `Berikutnya: ${clip(nextSteps, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!body) continue;
  const createdAt = normalizeIsoDate(row.created_at);
  if (createdAt === null) {
    summaryFailed += 1;
    console.error("ringkasan gagal: tanggal tidak valid");
    continue;
  }
  if (dryRun || !db) {
    summaryInserted += 1;
    continue;
  }

  try {
    const result = addObservation(db, {
      project,
      type: "session_summary",
      title,
      body,
      source: "import_summary",
      createdAt,
    });
    if (result.inserted) summaryInserted += 1;
    else summaryDup += 1;
  } catch (error) {
    summaryFailed += 1;
    console.error("ringkasan gagal:", error instanceof Error ? error.message : error);
  }
}

const prompts = source
  .query<
    {
      project: string;
      session_id: string;
      body: string | null;
      created_at: unknown;
      created_at_epoch: number | null;
    },
    []
  >(
    `SELECT coalesce(s.project, 'unknown') AS project,
            p.content_session_id AS session_id,
            p.prompt_text AS body,
            p.created_at,
            p.created_at_epoch
     FROM user_prompts p
     LEFT JOIN sdk_sessions s ON s.id = p.session_db_id
     ORDER BY p.created_at_epoch`,
  )
  .all();

let promptInserted = 0;
let promptDup = 0;
let promptRedacted = 0;
let promptFailed = 0;

for (const row of prompts) {
  const project = normalizeProject(row.project);
  const sourceBody = (row.body ?? "").trim();
  const body = redactSecrets(row.body ?? "").trim().slice(0, 8000);
  if (!body) continue;

  const createdAt = normalizeIsoDate(row.created_at);
  if (
    createdAt === undefined ||
    createdAt === null ||
    typeof row.created_at_epoch !== "number" ||
    !Number.isFinite(row.created_at_epoch)
  ) {
    promptFailed += 1;
    console.error(`prompt gagal: tanggal tidak valid untuk sesi ${row.session_id}`);
    continue;
  }

  if (dryRun || !db) {
    promptInserted += 1;
    continue;
  }

  try {
    const candidates = db
      .query<{ id: number; body: string }, [string, number]>(
        "SELECT id, body FROM prompts WHERE session_id = ? AND created_at_epoch = ?",
      )
      .all(row.session_id, row.created_at_epoch);

    const hadSanitized = candidates.some((candidate) => candidate.body === body);
    const unsanitized = candidates.filter(
      (candidate) => candidate.body !== body && candidate.body === sourceBody.slice(0, 8000),
    );

    for (const candidate of unsanitized) {
      db.run("UPDATE prompts SET body = ? WHERE id = ?", [body, candidate.id]);
    }
    if (unsanitized.length > 0) {
      promptRedacted += unsanitized.length;
    }

    if (hadSanitized) {
      promptDup += 1;
      continue;
    }

    if (unsanitized.length > 0) {
      continue;
    }

    db.run(
      "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
      [row.session_id, project, body, createdAt, row.created_at_epoch],
    );
    promptInserted += 1;
  } catch (error) {
    promptFailed += 1;
    console.error("prompt gagal:", error instanceof Error ? error.message : error);
  }
}

source.close();

const projectStats: Record<string, unknown> = {};
if (db) {
  const projects = db
    .query<{ project: string }, []>("SELECT DISTINCT project FROM observations ORDER BY project")
    .all();
  for (const { project } of projects) projectStats[project] = stats(db, project);
}

console.log(
  JSON.stringify(
    {
      db: dbPath,
      dryRun,
      summaries: {
        total: summaries.length,
        inserted: summaryInserted,
        dup: summaryDup,
        redacted: summaryRedacted,
        removed: summaryRemoved,
        scrubFailed: summaryScrubFailed,
        failed: summaryFailed,
      },
      prompts: {
        total: prompts.length,
        inserted: promptInserted,
        dup: promptDup,
        redacted: promptRedacted,
        failed: promptFailed,
      },
      projects: projectStats,
    },
    null,
    2,
  ),
);

if (db) db.close();
