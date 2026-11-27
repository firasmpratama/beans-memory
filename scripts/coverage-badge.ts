import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const lcovPath = join(root, "coverage", "lcov.info");

if (!existsSync(lcovPath)) {
  console.error("coverage/lcov.info tidak ada. Jalankan: bun test --coverage --coverage-reporter=lcov");
  process.exit(1);
}

let linesFound = 0;
let linesHit = 0;

for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
  if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
  else if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
}

if (linesFound === 0) {
  console.error("lcov.info tidak berisi data baris.");
  process.exit(1);
}

const percent = (linesHit / linesFound) * 100;
const color =
  percent >= 90
    ? "brightgreen"
    : percent >= 80
      ? "green"
      : percent >= 70
        ? "yellowgreen"
        : percent >= 60
          ? "yellow"
          : "red";

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${percent.toFixed(2)}%`,
  color,
};

writeFileSync(join(root, "coverage.json"), `${JSON.stringify(badge, null, 2)}\n`);
console.log(`coverage ${badge.message} (${linesHit}/${linesFound} lines)`);
