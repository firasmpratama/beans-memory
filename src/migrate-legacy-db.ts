import { Database } from "bun:sqlite";
import { openDb, resolveDbPath } from "./db";
import { addObservation } from "./repo";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  const value = args[index + 1];
  return index >= 0 && value ? value : fallback;
}

const fromPath = arg("from", "");
const dbPath = arg("db", resolveDbPath());

if (!fromPath) {
  console.error("Usage: bun migrate-legacy-db.ts --from <old/memory.db> [--db <new/memory.db>]");
  process.exit(1);
}

const source = new Database(fromPath, { readonly: true });
source.run("PRAGMA busy_timeout = 5000");
const target = openDb(dbPath);

const rows = source
  .query<
    {
      project: string;
      type: string;
      title: string;
      body: string | null;
      files: string;
      concepts: string;
      source: string;
      created_at: string;
    },
    []
  >(
    `SELECT project, type, title, coalesce(body, '') AS body, files, concepts, source, created_at
     FROM observations ORDER BY created_at`,
  )
  .all();

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

let inserted = 0;
let dup = 0;
for (const row of rows) {
  const result = addObservation(target, {
    project: row.project,
    type: row.type,
    title: row.title,
    body: row.body ?? "",
    files: parseArray(row.files),
    concepts: parseArray(row.concepts),
    source: row.source === "agent" ? "agent" : "import",
    createdAt: row.created_at,
  });
  if (result.inserted) inserted += 1;
  else dup += 1;
}

source.close();
target.close();

console.log(JSON.stringify({ from: fromPath, to: dbPath, rows: rows.length, inserted, dup }, null, 2));
