import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb, resolveDbPath } from "./db";
import { addObservation, stats } from "./repo";

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
      created_at: string;
    },
    []
  >(
    `SELECT project, request, investigated, learned, completed, next_steps, created_at
     FROM session_summaries ORDER BY created_at`,
  )
  .all();

let summaryInserted = 0;
let summaryDup = 0;

for (const row of summaries) {
  const project = normalizeProject(row.project);
  const title = clip(row.request, 140) || "Ringkasan sesi";
  const body = [
    clip(row.request, 1200) ? `Request: ${clip(row.request, 1200)}` : "",
    clip(row.investigated, 1200) ? `Investigasi: ${clip(row.investigated, 1200)}` : "",
    clip(row.learned, 1500) ? `Dipelajari: ${clip(row.learned, 1500)}` : "",
    clip(row.completed, 1200) ? `Selesai: ${clip(row.completed, 1200)}` : "",
    clip(row.next_steps, 600) ? `Berikutnya: ${clip(row.next_steps, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!body) continue;
  if (dryRun || !db) {
    summaryInserted += 1;
    continue;
  }

  const result = addObservation(db, {
    project,
    type: "session_summary",
    title,
    body,
    source: "import_summary",
    createdAt: row.created_at,
  });
  if (result.inserted) summaryInserted += 1;
  else summaryDup += 1;
}

const prompts = source
  .query<
    {
      project: string;
      session_id: string;
      body: string;
      created_at: string;
      created_at_epoch: number;
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

for (const row of prompts) {
  const project = normalizeProject(row.project);
  const body = row.body.trim().slice(0, 8000);
  if (!body) continue;

  if (dryRun || !db) {
    promptInserted += 1;
    continue;
  }

  const exists = db
    .query<{ id: number }, [string, number, string]>(
      "SELECT id FROM prompts WHERE session_id = ? AND created_at_epoch = ? AND body = ? LIMIT 1",
    )
    .get(row.session_id, row.created_at_epoch, body);
  if (exists) {
    promptDup += 1;
    continue;
  }

  db.run(
    "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
    [row.session_id, project, body, row.created_at, row.created_at_epoch],
  );
  promptInserted += 1;
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
      summaries: { total: summaries.length, inserted: summaryInserted, dup: summaryDup },
      prompts: { total: prompts.length, inserted: promptInserted, dup: promptDup },
      projects: projectStats,
    },
    null,
    2,
  ),
);

if (db) db.close();
