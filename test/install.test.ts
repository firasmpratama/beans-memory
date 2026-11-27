import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../src/install";

const directory = mkdtempSync(join(tmpdir(), "beans-memory-install-"));
const packageRoot = join(import.meta.dir, "..");
const bunPath = "/usr/local/bin/bun";

function makeHome(name: string): string {
  const home = join(directory, name);
  mkdirSync(home, { recursive: true });
  return home;
}

function snapshot(paths: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of paths) files[path] = readFileSync(path, "utf8");
  return files;
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("install", () => {
  test("writes an idempotent OpenCode loader and the shared skill", () => {
    const home = makeHome("opencode");

    install({ home, targets: ["opencode"], packageRoot, bunPath });
    const loader = join(home, ".config", "opencode", "plugins", "beans-memory", "index.ts");
    const first = readFileSync(loader, "utf8");

    expect(first).toContain(join(packageRoot, "src", "plugin.ts"));
    expect(first).toContain("async setup()");
    expect(first).toContain("noop");
    expect(existsSync(join(home, ".claude", "skills", "beans-memory", "SKILL.md"))).toBe(true);

    install({ home, targets: ["opencode"], packageRoot, bunPath });

    expect(readFileSync(loader, "utf8")).toBe(first);
    expect(readdirSync(join(home, ".config", "opencode", "plugins"))).toEqual(["beans-memory"]);
  });

  test("resolves the package root from the module when not provided", () => {
    const home = makeHome("default-root");
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true });

    install({ home, targets: ["opencode"], bunPath });

    const loader = join(home, ".config", "opencode", "plugins", "beans-memory", "index.ts");
    expect(readFileSync(loader, "utf8")).toContain(join(packageRoot, "src", "plugin.ts"));
  });

  test("updates a managed loader written with Windows path separators", () => {
    const home = makeHome("opencode-windows");
    const pluginsDirectory = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDirectory, { recursive: true });
    const loader = join(pluginsDirectory, "custom.ts");
    writeFileSync(
      loader,
      `${String.raw`// Managed by beans-memory install.
const ENTRY = "C:\\tools\\beans-memory\\src\\plugin.ts";`}\n`,
    );

    install({ home, targets: ["opencode"], packageRoot, bunPath });

    expect(readdirSync(pluginsDirectory)).toEqual(["custom.ts"]);
    expect(readFileSync(loader, "utf8")).toContain("noop");
  });

  test("leaves an unmanaged loader untouched", () => {
    const home = makeHome("opencode-custom");
    const pluginsDirectory = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDirectory, { recursive: true });
    const loader = join(pluginsDirectory, "custom.ts");
    const original = `${String.raw`const ENTRY = "C:\tools\beans-memory\src\plugin.ts";`}\n`;
    writeFileSync(loader, original);

    const reports = install({ home, targets: ["opencode"], packageRoot, bunPath });

    expect(readFileSync(loader, "utf8")).toBe(original);
    expect(readdirSync(pluginsDirectory)).toEqual(["custom.ts"]);
    expect(reports.find((report) => report.target === "opencode")?.status).toBe("manual");
  });

  test("configures every target once and preserves the first backup", () => {
    const home = makeHome("all");
    const codexConfig = join(home, ".codex", "config.toml");
    const geminiConfig = join(home, ".gemini", "settings.json");
    const hermesConfig = join(home, ".hermes", "config.yaml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".gemini"), { recursive: true });
    mkdirSync(join(home, ".hermes"), { recursive: true });
    writeFileSync(codexConfig, 'model = "gpt-5"\n');
    writeFileSync(geminiConfig, '{"theme":"dark"}\n');
    writeFileSync(hermesConfig, "model: anthropic/claude\n");

    const targets = ["opencode", "claude", "codex", "gemini", "hermes"] as const;
    const reports = install({ home, targets: [...targets], packageRoot, bunPath });

    expect(reports.map((report) => report.target)).toEqual([...targets]);

    const codex = readFileSync(codexConfig, "utf8");
    expect(codex).toContain("model = \"gpt-5\"");
    expect(codex.match(/\[mcp_servers\.beans_memory\]/g)?.length).toBe(1);
    expect(readFileSync(`${codexConfig}.beans-memory.bak`, "utf8")).toBe('model = "gpt-5"\n');
    expect(readFileSync(`${geminiConfig}.beans-memory.bak`, "utf8")).toBe('{"theme":"dark"}\n');
    expect(readFileSync(`${hermesConfig}.beans-memory.bak`, "utf8")).toBe("model: anthropic/claude\n");

    const gemini = JSON.parse(readFileSync(geminiConfig, "utf8")) as {
      theme: string;
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(gemini.theme).toBe("dark");
    expect(gemini.mcpServers["beans-memory"]?.command).toBe(bunPath);
    expect(gemini.mcpServers["beans-memory"]?.args[0]).toBe(join(packageRoot, "src", "mcp.ts"));

    const hermes = readFileSync(hermesConfig, "utf8");
    expect(hermes).toContain("model: anthropic/claude");
    expect(hermes.match(/# beans-memory begin/g)?.length).toBe(1);
    expect(existsSync(join(home, ".hermes", "skills", "beans-memory", "SKILL.md"))).toBe(true);

    const before = snapshot([codexConfig, geminiConfig, hermesConfig]);
    install({ home, targets: [...targets], packageRoot, bunPath });
    expect(snapshot([codexConfig, geminiConfig, hermesConfig])).toEqual(before);

    expect(readFileSync(`${codexConfig}.beans-memory.bak`, "utf8")).toBe('model = "gpt-5"\n');
    expect(readFileSync(`${geminiConfig}.beans-memory.bak`, "utf8")).toBe('{"theme":"dark"}\n');
    expect(readFileSync(`${hermesConfig}.beans-memory.bak`, "utf8")).toBe("model: anthropic/claude\n");
  });

  test("leaves existing MCP mappings alone when there is no managed block", () => {
    const home = makeHome("conflicts");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    mkdirSync(join(home, ".hermes"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });

    const geminiConfig = join(home, ".gemini", "settings.json");
    writeFileSync(geminiConfig, "not json");
    const hermesConfig = join(home, ".hermes", "config.yaml");
    writeFileSync(hermesConfig, "mcp_servers:\n  other:\n    command: other\n");
    const codexConfig = join(home, ".codex", "config.toml");
    writeFileSync(codexConfig, '[mcp_servers."beans_memory"]\ncommand = "other"\n');

    const reports = install({
      home,
      targets: ["codex", "gemini", "hermes"],
      packageRoot,
      bunPath,
    });

    expect(readFileSync(geminiConfig, "utf8")).toBe("not json");
    expect(readFileSync(hermesConfig, "utf8")).toBe("mcp_servers:\n  other:\n    command: other\n");
    expect(readFileSync(codexConfig, "utf8")).toBe('[mcp_servers."beans_memory"]\ncommand = "other"\n');
    expect(reports.find((report) => report.target === "gemini")?.status).toBe("manual");
    expect(reports.find((report) => report.target === "hermes")?.status).toBe("manual");
    expect(reports.find((report) => report.target === "codex")?.status).toBe("skipped");
  });

  test("keeps a non-object Gemini mcpServers value", () => {
    const home = makeHome("gemini-shape");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    const config = join(home, ".gemini", "settings.json");
    const original = '{"mcpServers":"keep-this"}\n';
    writeFileSync(config, original);

    const reports = install({ home, targets: ["gemini"], packageRoot, bunPath });

    expect(readFileSync(config, "utf8")).toBe(original);
    expect(reports[0]?.status).toBe("manual");
  });

  test("keeps an existing null Gemini server entry", () => {
    const home = makeHome("gemini-null");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    const config = join(home, ".gemini", "settings.json");
    const original = '{"mcpServers":{"beans-memory":null},"theme":"dark"}\n';
    writeFileSync(config, original);

    const reports = install({ home, targets: ["gemini"], packageRoot, bunPath });

    expect(readFileSync(config, "utf8")).toBe(original);
    expect(reports[0]?.status).toBe("skipped");
  });

  test("ignores commented Codex tables and quoted Hermes keys", () => {
    const home = makeHome("commented");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const codexConfig = join(home, ".codex", "config.toml");
    writeFileSync(codexConfig, '# [mcp_servers."beans_memory"]\nmodel = "gpt-5"\n');
    const hermesConfig = join(home, ".hermes", "config.yaml");
    const hermesOriginal = '"mcp_servers":\n  other:\n    command: other\n';
    writeFileSync(hermesConfig, hermesOriginal);

    const reports = install({ home, targets: ["codex", "hermes"], packageRoot, bunPath });

    expect(readFileSync(codexConfig, "utf8").match(/\[mcp_servers\.beans_memory\]/g)?.length).toBe(1);
    expect(readFileSync(hermesConfig, "utf8")).toBe(hermesOriginal);
    expect(reports.find((report) => report.target === "hermes")?.status).toBe("manual");
  });

  test("detects installed agents when no target is given", () => {
    const home = makeHome("detect");
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });

    const reports = install({ home, packageRoot, bunPath });

    expect(reports.map((report) => report.target)).toEqual(["opencode", "codex"]);
  });

  test("fails when no agent is detected and no target is given", () => {
    const home = makeHome("empty");

    expect(() => install({ home, packageRoot, bunPath })).toThrow("Tidak ada agent yang terdeteksi");
  });

  test("dry run writes nothing", () => {
    const home = makeHome("dry-run");

    const reports = install({
      home,
      targets: ["opencode", "claude", "codex", "gemini", "hermes"],
      packageRoot,
      bunPath,
      dryRun: true,
    });

    expect(existsSync(join(home, ".config"))).toBe(false);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(join(home, ".codex"))).toBe(false);
    expect(existsSync(join(home, ".gemini"))).toBe(false);
    expect(existsSync(join(home, ".hermes"))).toBe(false);
    expect(reports.every((report) => report.detail.startsWith("[dry-run]"))).toBe(true);
  });

  test("dry run leaves an existing install unchanged", () => {
    const home = makeHome("dry-run-existing");
    const targets = ["opencode", "codex", "gemini", "hermes"] as const;
    install({ home, targets: [...targets], packageRoot, bunPath });

    const paths = [
      join(home, ".config", "opencode", "plugins", "beans-memory", "index.ts"),
      join(home, ".codex", "config.toml"),
      join(home, ".gemini", "settings.json"),
      join(home, ".hermes", "config.yaml"),
    ];
    const before = snapshot(paths);

    install({ home, targets: [...targets], packageRoot, bunPath, dryRun: true });

    expect(snapshot(paths)).toEqual(before);
  });
});

describe("install command", () => {
  test("runs from the CLI without opening the database", () => {
    const home = makeHome("cli");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const blocked = join(home, "blocked");
    writeFileSync(blocked, "not a directory");

    const result = Bun.spawnSync({
      cmd: [process.execPath, cli, "install", "--opencode"],
      env: { ...process.env, HOME: home, MEMORY_DB: join(blocked, "memory.db") },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, ".config", "opencode", "plugins", "beans-memory", "index.ts"))).toBe(
      true,
    );
  });
});
