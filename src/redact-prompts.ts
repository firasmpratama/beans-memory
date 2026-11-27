import type { Database } from "bun:sqlite";
import { openDb, resolveDbPath } from "./db";
import { redactSecrets } from "./redact";

export function redactPromptRows(db: Database): { scanned: number; redacted: number } {
  const rows = db
    .query<{ id: number; body: string }, []>("SELECT id, body FROM prompts")
    .all();

  let redacted = 0;
  db.transaction(() => {
    for (const row of rows) {
      const next = redactSecrets(row.body);
      if (next === row.body) continue;
      db.run("UPDATE prompts SET body = ? WHERE id = ?", [next, row.id]);
      redacted += 1;
    }
  })();

  return { scanned: rows.length, redacted };
}

if (import.meta.main) {
  const dbPath = process.argv[2] ?? resolveDbPath();
  const db = openDb(dbPath);
  const report = redactPromptRows(db);
  console.log(JSON.stringify({ db: dbPath, ...report }, null, 2));
  db.close();
}
