import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { openDb, resolveDbPath } from "./db";

function hashOf(project: string, title: string, body: string): string {
  return createHash("sha256")
    .update(JSON.stringify([project, title, body]))
    .digest("hex");
}

export function rehashDatabase(
  db: Database,
): { scanned: number; updated: number; removed: number } {
  const rows = db
    .query<
      { id: number; project: string; title: string; body: string; content_hash: string },
      []
    >("SELECT id, project, title, coalesce(body, '') AS body, content_hash FROM observations")
    .all();

  let updated = 0;
  let removed = 0;

  db.transaction(() => {
    for (const row of rows) {
      const next = hashOf(row.project, row.title, row.body);
      if (next === row.content_hash) continue;

      const clash = db
        .query<{ id: number }, [string, number]>(
          "SELECT id FROM observations WHERE content_hash = ? AND id <> ?",
        )
        .get(next, row.id);

      if (clash) {
        db.run("DELETE FROM observations WHERE id = ?", [row.id]);
        removed += 1;
        continue;
      }

      db.run("UPDATE observations SET content_hash = ? WHERE id = ?", [next, row.id]);
      updated += 1;
    }
  })();

  return { scanned: rows.length, updated, removed };
}

if (import.meta.main) {
  const dbPath = process.argv[2] ?? resolveDbPath();
  const db = openDb(dbPath);
  const report = rehashDatabase(db);
  console.log(JSON.stringify({ db: dbPath, ...report }, null, 2));
  db.close();
}
