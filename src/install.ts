import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TARGETS = ["opencode", "claude", "codex", "gemini", "hermes"] as const;

export type InstallTarget = (typeof TARGETS)[number];

export type InstallStatus = "installed" | "skipped" | "manual";

export type InstallReport = {
  target: InstallTarget;
  status: InstallStatus;
  detail: string;
};

export type InstallOptions = {
  home?: string;
  targets?: InstallTarget[];
  dryRun?: boolean;
  packageRoot?: string;
  bunPath?: string;
};

const BLOCK_BEGIN = "# beans-memory begin";
const BLOCK_END = "# beans-memory end";

function packageRootFromModule(): string {
  return join(import.meta.dir, "..");
}

function ensureDirectory(path: string, dryRun: boolean): void {
  if (dryRun || existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

function writeText(path: string, content: string, dryRun: boolean): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  if (dryRun) return true;
  ensureDirectory(dirname(path), false);
  writeFileSync(path, content);
  return true;
}

function writeConfig(path: string, source: string | null, next: string, dryRun: boolean): boolean {
  if (source !== null && source === next) return false;
  if (dryRun) return true;
  if (source !== null && existsSync(path)) {
    const backupPath = `${path}.beans-memory.bak`;
    if (!existsSync(backupPath)) {
      copyFileSync(path, backupPath);
    }
  }
  ensureDirectory(dirname(path), false);
  writeFileSync(path, next);
  return true;
}

function skillSource(packageRoot: string): string {
  const path = join(packageRoot, "skills", "beans-memory", "SKILL.md");
  if (!existsSync(path)) throw new Error(`Skill tidak ditemukan: ${path}`);
  return readFileSync(path, "utf8");
}

function installSkill(home: string, packageRoot: string, dryRun: boolean): string {
  const path = join(home, ".claude", "skills", "beans-memory", "SKILL.md");
  writeText(path, skillSource(packageRoot), dryRun);
  return path;
}

function installHermesSkill(home: string, packageRoot: string, dryRun: boolean): string {
  const path = join(home, ".hermes", "skills", "beans-memory", "SKILL.md");
  writeText(path, skillSource(packageRoot), dryRun);
  return path;
}

function loaderContent(entry: string): string {
  return `// Managed by beans-memory install. Re-run the command if the package moves.
import { pathToFileURL } from "node:url";

const ENTRY = ${JSON.stringify(entry)};

const noop = {
  id: "memory",
  async setup() {
    return () => {};
  },
};

let plugin: unknown = noop;

try {
  const loaded = await import(pathToFileURL(ENTRY).href);
  if (loaded?.default?.setup) plugin = loaded.default;
} catch (error) {
  console.error("[memory] plugin not loaded:", error);
}

export default plugin;
`;
}

function findExistingLoader(
  pluginsDirectory: string,
): { path: string; managed: boolean } | null {
  if (!existsSync(pluginsDirectory)) return null;
  const candidates: string[] = [];
  for (const entry of readdirSync(pluginsDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(join(pluginsDirectory, entry.name, "index.ts"));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      candidates.push(join(pluginsDirectory, entry.name));
    }
  }
  const pattern = /(beans|agent)-memory[\\/]+src[\\/]+plugin\.ts/;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf8");
    if (pattern.test(content)) {
      return { path: candidate, managed: content.includes("Managed by beans-memory") };
    }
  }
  return null;
}

function mcpSnippet(bunPath: string, mcpPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "beans-memory": {
          command: bunPath,
          args: [mcpPath],
        },
      },
    },
    null,
    2,
  );
}

function replaceBlock(source: string, block: string): string | null {
  const begin = source.indexOf(BLOCK_BEGIN);
  const end = source.indexOf(BLOCK_END);
  if (begin < 0 || end < begin) return null;
  return `${source.slice(0, begin)}${block}${source.slice(end + BLOCK_END.length)}`;
}

function appendBlock(source: string, block: string): string {
  const trimmed = source.trimEnd();
  return trimmed.length === 0 ? `${block}\n` : `${trimmed}\n\n${block}\n`;
}

function installOpencode(
  home: string,
  packageRoot: string,
  dryRun: boolean,
): InstallReport {
  const pluginsDirectory = join(home, ".config", "opencode", "plugins");
  const existing = findExistingLoader(pluginsDirectory);
  const loaderPath = existing?.path ?? join(pluginsDirectory, "beans-memory", "index.ts");
  const skillPath = installSkill(home, packageRoot, dryRun);

  if (existing && !existing.managed) {
    return {
      target: "opencode",
      status: "manual",
      detail: `loader kustom terdeteksi dan tidak diubah: ${loaderPath}; skill: ${skillPath}`,
    };
  }

  const entry = join(packageRoot, "src", "plugin.ts");
  const changed = writeText(loaderPath, loaderContent(entry), dryRun);
  return {
    target: "opencode",
    status: "installed",
    detail: `${changed ? "loader ditulis" : "loader sudah benar"}: ${loaderPath}; skill: ${skillPath}`,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function installClaude(home: string, packageRoot: string, bunPath: string, dryRun: boolean): InstallReport {
  const skillPath = installSkill(home, packageRoot, dryRun);
  const mcpPath = join(packageRoot, "src", "mcp.ts");
  const command = `claude mcp add --scope user --transport stdio beans_memory -- ${shellQuote(bunPath)} ${shellQuote(mcpPath)}`;
  return {
    target: "claude",
    status: "manual",
    detail: `skill: ${skillPath}; MCP manual: ${command}`,
  };
}

function installCodex(home: string, packageRoot: string, bunPath: string, dryRun: boolean): InstallReport {
  const configPath = join(home, ".codex", "config.toml");
  const mcpPath = join(packageRoot, "src", "mcp.ts");
  const block = [
    BLOCK_BEGIN,
    "[mcp_servers.beans_memory]",
    `command = ${JSON.stringify(bunPath)}`,
    `args = [${JSON.stringify(mcpPath)}]`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 60",
    BLOCK_END,
  ].join("\n");

  if (!existsSync(configPath)) {
    writeText(configPath, `${block}\n`, dryRun);
    return { target: "codex", status: "installed", detail: `config ditulis: ${configPath}` };
  }

  const source = readFileSync(configPath, "utf8");
  const replaced = replaceBlock(source, block);
  if (replaced !== null) {
    writeConfig(configPath, source, replaced, dryRun);
    return { target: "codex", status: "installed", detail: `config diperbarui: ${configPath}` };
  }
  if (/^[ \t]*\[mcp_servers\s*\.\s*["']?beans_memory["']?(?:\s*\.|\s*\])/m.test(source)) {
    return {
      target: "codex",
      status: "skipped",
      detail: `mcp_servers.beans_memory sudah ada di ${configPath}; tidak diubah`,
    };
  }
  writeConfig(configPath, source, appendBlock(source, block), dryRun);
  return { target: "codex", status: "installed", detail: `config ditambahkan: ${configPath}` };
}

function installGemini(home: string, packageRoot: string, bunPath: string, dryRun: boolean): InstallReport {
  const configPath = join(home, ".gemini", "settings.json");
  const mcpPath = join(packageRoot, "src", "mcp.ts");
  const server = {
    command: bunPath,
    args: [mcpPath],
    timeout: 30000,
    trust: false,
  };
  const snippet = mcpSnippet(bunPath, mcpPath);

  if (!existsSync(configPath)) {
    writeText(configPath, `${JSON.stringify({ mcpServers: { "beans-memory": server } }, null, 2)}\n`, dryRun);
    return { target: "gemini", status: "installed", detail: `config ditulis: ${configPath}` };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {
      target: "gemini",
      status: "manual",
      detail: `JSON tidak bisa dibaca, tidak diubah. Tambahkan manual:\n${snippet}`,
    };
  }

  if (parsedRaw === null || typeof parsedRaw !== "object" || Array.isArray(parsedRaw)) {
    return {
      target: "gemini",
      status: "manual",
      detail: `Format settings tidak dikenali, tidak diubah. Tambahkan manual:\n${snippet}`,
    };
  }

  const parsed = parsedRaw as Record<string, unknown>;
  const existingServers = parsed.mcpServers;
  if (
    existingServers !== undefined &&
    (existingServers === null || typeof existingServers !== "object" || Array.isArray(existingServers))
  ) {
    return {
      target: "gemini",
      status: "manual",
      detail: `mcpServers bukan objek, tidak diubah. Tambahkan manual:\n${snippet}`,
    };
  }

  const servers = existingServers ? (existingServers as Record<string, unknown>) : {};
  if (Object.hasOwn(servers, "beans-memory")) {
    return {
      target: "gemini",
      status: "skipped",
      detail: `mcpServers.beans-memory sudah ada di ${configPath}; tidak diubah`,
    };
  }

  servers["beans-memory"] = server;
  parsed.mcpServers = servers;
  writeConfig(configPath, readFileSync(configPath, "utf8"), `${JSON.stringify(parsed, null, 2)}\n`, dryRun);
  return { target: "gemini", status: "installed", detail: `config diperbarui: ${configPath}` };
}

function installHermes(home: string, packageRoot: string, bunPath: string, dryRun: boolean): InstallReport {
  const skillPath = installHermesSkill(home, packageRoot, dryRun);
  const configPath = join(home, ".hermes", "config.yaml");
  const mcpPath = join(packageRoot, "src", "mcp.ts");
  const block = [
    BLOCK_BEGIN,
    "mcp_servers:",
    "  beans-memory:",
    `    command: ${JSON.stringify(bunPath)}`,
    "    args:",
    `      - ${JSON.stringify(mcpPath)}`,
    BLOCK_END,
  ].join("\n");

  if (!existsSync(configPath)) {
    writeText(configPath, `${block}\n`, dryRun);
    return {
      target: "hermes",
      status: "installed",
      detail: `skill: ${skillPath}; config ditulis: ${configPath}`,
    };
  }

  const source = readFileSync(configPath, "utf8");
  const replaced = replaceBlock(source, block);
  if (replaced !== null) {
    writeConfig(configPath, source, replaced, dryRun);
    return {
      target: "hermes",
      status: "installed",
      detail: `skill: ${skillPath}; config diperbarui: ${configPath}`,
    };
  }
  if (/^[ \t]*["']?mcp_servers["']?\s*:/m.test(source)) {
    return {
      target: "hermes",
      status: "manual",
      detail: `skill: ${skillPath}; mcp_servers sudah ada di ${configPath}. Tambahkan manual:\n${block}`,
    };
  }

  writeConfig(configPath, source, appendBlock(source, block), dryRun);
  return {
    target: "hermes",
    status: "installed",
    detail: `skill: ${skillPath}; config ditambahkan: ${configPath}`,
  };
}

function detectTargets(home: string): InstallTarget[] {
  const detected: InstallTarget[] = [];
  if (existsSync(join(home, ".config", "opencode"))) detected.push("opencode");
  if (existsSync(join(home, ".claude"))) detected.push("claude");
  if (existsSync(join(home, ".codex"))) detected.push("codex");
  if (existsSync(join(home, ".gemini"))) detected.push("gemini");
  if (existsSync(join(home, ".hermes"))) detected.push("hermes");
  return detected;
}

export function install(options: InstallOptions = {}): InstallReport[] {
  const home = options.home ?? homedir();
  const packageRoot = options.packageRoot ?? packageRootFromModule();
  const bunPath = options.bunPath ?? process.execPath;
  const dryRun = options.dryRun ?? false;
  const visibleTargets = options.targets ?? detectTargets(home);

  if (visibleTargets.length === 0) {
    throw new Error(
      "Tidak ada agent yang terdeteksi. Pilih target: --opencode, --claude, --codex, --gemini, --hermes, atau --all.",
    );
  }

  const reports: InstallReport[] = [];
  for (const target of visibleTargets) {
    if (target === "opencode") reports.push(installOpencode(home, packageRoot, dryRun));
    if (target === "claude") reports.push(installClaude(home, packageRoot, bunPath, dryRun));
    if (target === "codex") reports.push(installCodex(home, packageRoot, bunPath, dryRun));
    if (target === "gemini") reports.push(installGemini(home, packageRoot, bunPath, dryRun));
    if (target === "hermes") reports.push(installHermes(home, packageRoot, bunPath, dryRun));
  }
  return dryRun
    ? reports.map((report) => ({ ...report, detail: `[dry-run] ${report.detail}` }))
    : reports;
}
