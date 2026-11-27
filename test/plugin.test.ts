import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../src/plugin";

type Tool = {
  name: string;
  execute: (input: unknown) => Promise<{ content: string }>;
};

let directory: string;
let projectDirectory: string;
let dbPath: string;
let originalOverride: string | undefined;
let cleanup: (() => unknown) | undefined;
let tools: Map<string, Tool>;
let sessionHooks: Record<string, (event: any) => unknown>;
let toolHook: ((event: any) => unknown) | undefined;

function makeContext(): any {
  return {
    location: { directory: projectDirectory },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          add: (tool: Tool) => {
            tools.set(tool.name, tool);
          },
        });
        return { dispose: async () => {} };
      },
      hook: async (name: string, handler: (event: any) => unknown) => {
        if (name === "execute.after") toolHook = handler;
        return { dispose: async () => {} };
      },
    },
    session: {
      hook: async (name: string, handler: (event: any) => unknown) => {
        sessionHooks[name] = handler;
        return { dispose: async () => {} };
      },
    },
  };
}

function readDb(): Database {
  return new Database(dbPath, { readonly: true });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "beans-memory-plugin-"));
  projectDirectory = join(directory, "demo-project");
  mkdirSync(projectDirectory, { recursive: true });
  dbPath = join(directory, "memory.db");

  originalOverride = process.env.MEMORY_DB;
  process.env.MEMORY_DB = dbPath;
  tools = new Map();
  sessionHooks = {};
  toolHook = undefined;

  cleanup = (await plugin.setup(makeContext())) as () => unknown;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  if (originalOverride === undefined) delete process.env.MEMORY_DB;
  else process.env.MEMORY_DB = originalOverride;
  rmSync(directory, { recursive: true, force: true });
});

describe("plugin", () => {
  test("registers the four memory tools and stores notes", async () => {
    expect([...tools.keys()].sort()).toEqual([
      "memory_get",
      "memory_note",
      "memory_search",
      "memory_stats",
    ]);

    const saved = await tools.get("memory_note")!.execute({
      title: "Hook note",
      body: "body from the plugin",
      type: "decision",
      files: ["src/a.ts"],
    });
    expect(saved.content).toContain("#1");

    const found = await tools.get("memory_search")!.execute({ query: "hook" });
    expect(found.content).toContain("Hook note");

    const full = await tools.get("memory_get")!.execute({ ids: [1] });
    expect(full.content).toContain("body from the plugin");
    expect(full.content).toContain("src/a.ts");

    const stats = await tools.get("memory_stats")!.execute({});
    expect(stats.content).toContain("1 catatan");
  });

  test("redacts captured prompts and injects context once per session", async () => {
    await tools.get("memory_note")!.execute({
      title: "Context note",
      body: "remember this",
    });

    const promptHook = sessionHooks.prompt!;
    await promptHook({
      sessionID: "s1",
      prompt: { text: "my token is sk-abcdefghijklmnopqrstuvwxyz" },
    });

    const db = readDb();
    const prompts = db.query<{ body: string }, []>("SELECT body FROM prompts").all();
    db.close();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.body).toBe("my token is sk-***");

    const contextHook = sessionHooks.context!;
    const first = { sessionID: "s1", system: [] as Array<{ type: string; text: string }> };
    await contextHook(first);
    expect(first.system).toHaveLength(1);
    expect(first.system[0]?.text).toContain("Context note");

    await contextHook(first);
    expect(first.system).toHaveLength(1);

    const second = { sessionID: "s2", system: [] as Array<{ type: string; text: string }> };
    await contextHook(second);
    expect(second.system).toHaveLength(1);
  });

  test("records files touched by completed edit tools", async () => {
    await sessionHooks.prompt!({ sessionID: "s1", prompt: { text: "touch files" } });
    expect(toolHook).toBeDefined();

    await toolHook!({
      sessionID: "s1",
      status: "completed",
      tool: "write",
      input: { filePath: "src/a.ts" },
    });
    await toolHook!({
      sessionID: "s1",
      status: "completed",
      tool: "read",
      input: { filePath: "src/ignored.ts" },
    });
    await toolHook!({
      sessionID: "s1",
      status: "error",
      tool: "write",
      input: { filePath: "src/failed.ts" },
    });

    const db = readDb();
    const row = db
      .query<{ files: string }, [string]>("SELECT files FROM sessions WHERE id = ?")
      .get("s1");
    db.close();
    expect(JSON.parse(row!.files)).toEqual(["src/a.ts"]);
  });

  test("collects edit path aliases once and ignores malformed hook events", async () => {
    await sessionHooks.prompt!({ sessionID: "s1", prompt: { text: "track files" } });

    await expect(
      Promise.resolve(
        toolHook!({
          sessionID: "s1",
          status: "completed",
          tool: "patch",
          input: {
            filePath: "src/a.ts",
            file_path: "src/a.ts",
            path: "src/b.ts",
            filename: "C:\\work\\src\\windows.ts",
            edits: [{ filePath: "src/c.ts" }, null, {}, { filePath: "src/a.ts" }],
          },
        }),
      ),
    ).resolves.toBeUndefined();

    await toolHook!({ sessionID: "s1", status: "completed", tool: "write", input: null });
    await toolHook!({ sessionID: "s1", status: "completed", tool: "write", input: { edits: "bad" } });
    await toolHook!({ status: "completed", tool: "write", input: { filePath: "ignored.ts" } });

    const db = readDb();
    const row = db
      .query<{ files: string }, [string]>("SELECT files FROM sessions WHERE id = ?")
      .get("s1");
    db.close();
    expect(JSON.parse(row!.files)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "C:\\work\\src\\windows.ts",
      "src/c.ts",
    ]);
  });

  test("ignores missing session and whitespace-only prompt text", async () => {
    await sessionHooks.prompt!({ prompt: { text: "must not be stored" } });
    await sessionHooks.prompt!({ sessionID: "s-empty", prompt: { text: "   \n  " } });

    const db = readDb();
    const prompts = db.query<{ n: number }, []>("SELECT count(*) AS n FROM prompts").get();
    const sessions = db.query<{ id: string }, []>("SELECT id FROM sessions").all();
    db.close();

    expect(prompts?.n).toBe(0);
    expect(sessions.map((row) => row.id)).toEqual(["s-empty"]);
  });
});
