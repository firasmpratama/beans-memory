import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");

function frontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("frontmatter tidak ditemukan");
  const parsed = Bun.YAML.parse(match[1]!) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter bukan objek YAML");
  }
  return parsed as Record<string, unknown>;
}

describe("repository artifacts", () => {
  test("SKILL.md frontmatter follows the portable skill format", () => {
    const skillPath = join(root, "skills", "beans-memory", "SKILL.md");
    const fields = frontmatter(readFileSync(skillPath, "utf8"));
    const directory = basename(join(skillPath, ".."));
    const name = fields.name;
    const description = fields.description;
    const metadata = fields.metadata;
    const allowed = new Set([
      "name",
      "description",
      "metadata",
      "license",
      "compatibility",
      "disable-model-invocation",
    ]);

    expect(Object.keys(fields).every((key) => allowed.has(key))).toBe(true);
    expect(typeof name).toBe("string");
    expect(typeof description).toBe("string");
    expect(name).toBe(directory);
    expect(String(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(String(name).length).toBeLessThanOrEqual(64);
    expect(String(description).length).toBeGreaterThan(0);
    expect(String(description).length).toBeLessThanOrEqual(1024);
    expect(metadata).not.toBeNull();
    expect(typeof metadata).toBe("object");
    expect(Array.isArray(metadata)).toBe(false);
  });

  test("every package bin exists and uses the Bun shebang", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };

    for (const relative of Object.values(manifest.bin)) {
      const path = join(root, relative);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toMatch(/^#!\/usr\/bin\/env bun(?:\s|$)/);
    }
  });

  test("example JSON files parse", () => {
    const directory = join(root, "examples");
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(join(directory, file), "utf8"))).not.toThrow();
    }
  });
});
