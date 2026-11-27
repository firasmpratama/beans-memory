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
const onlyProject = arg("project", "");
const includeDiscovery = args.includes("--include-discovery");
const dryRun = args.includes("--dry-run");

const KEEP_TYPES = new Set([
  "decision",
  "bugfix",
  "feature",
  "change",
  "refactor",
  "security_note",
  "sensitive",
  "test-coverage",
]);

function normalizeProject(project: string): string {
  const trimmed = project.trim();
  if (trimmed.startsWith("sinarmas-api/")) return "sinarmas-api";
  return trimmed;
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const source = new Database(sourcePath, { readonly: true });
source.run("PRAGMA busy_timeout = 5000");

const rows = source
  .query<
    {
      project: string;
      type: string;
      title: string | null;
      subtitle: string | null;
      narrative: string | null;
      facts: string | null;
      concepts: string | null;
      files_modified: string | null;
      created_at: string;
    },
    []
  >(
    `SELECT project, type, title, subtitle, narrative, facts, concepts, files_modified, created_at
     FROM observations ORDER BY created_at`,
  )
  .all();

const db = dryRun ? null : openDb(dbPath);
const perProject = new Map<string, { inserted: number; dup: number; skipped: number }>();

for (const row of rows) {
  const project = normalizeProject(row.project);
  if (onlyProject && project !== onlyProject) continue;

  const entry = perProject.get(project) ?? { inserted: 0, dup: 0, skipped: 0 };
  perProject.set(project, entry);

  const type = (row.type ?? "note").toLowerCase();
  if (!KEEP_TYPES.has(type) && !(includeDiscovery && type === "discovery")) {
    entry.skipped += 1;
    continue;
  }

  const facts = parseArray(row.facts);
  const body = [
    row.narrative ?? "",
    facts.length > 0 ? facts.map((fact) => `- ${fact}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (dryRun || !db) {
    entry.inserted += 1;
    continue;
  }

  const result = addObservation(db, {
    project,
    type,
    title: row.title ?? row.subtitle ?? "Tanpa judul",
    body,
    files: parseArray(row.files_modified),
    concepts: parseArray(row.concepts),
    source: "import",
    createdAt: row.created_at,
  });
  if (result.inserted) entry.inserted += 1;
  else entry.dup += 1;
}

source.close();

const report: Record<string, unknown> = { db: dbPath, dryRun, totalRows: rows.length, projects: {} };
for (const [project, value] of [...perProject.entries()].sort((a, b) => b[1].inserted - a[1].inserted)) {
  (report.projects as Record<string, unknown>)[project] = {
    ...value,
    stats: db ? stats(db, project) : null,
  };
}

console.log(JSON.stringify(report, null, 2));
if (db) db.close();
