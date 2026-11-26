import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type RpcResponse = {
  id: number;
  jsonrpc: string;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    tools?: Array<{ name: string }>;
    content?: Array<{ type: string; text: string }>;
  };
};

describe("MCP stdio server", () => {
  test("initializes, lists tools, stores and searches a note, then shuts down", async () => {
    const directory = mkdtempSync(join(tmpdir(), "beans-memory-mcp-e2e-"));
    const databasePath = join(directory, "memory.db");
    const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const child = spawn(process.execPath, ["src/mcp.ts"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MEMORY_DB: databasePath,
        MEMORY_PROJECT: "mcp-e2e",
      },
      stdio: "pipe",
    });
    const exitPromise = once(child, "exit");
    const lines = createInterface({ input: child.stdout });
    const queuedLines: string[] = [];
    const waitingReaders: Array<(line: string) => void> = [];
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    lines.on("line", (line) => {
      const reader = waitingReaders.shift();
      if (reader) {
        reader(line);
      } else {
        queuedLines.push(line);
      }
    });

    const nextLine = (): Promise<string> =>
      new Promise((resolve, reject) => {
        const queuedLine = queuedLines.shift();
        if (queuedLine !== undefined) {
          resolve(queuedLine);
          return;
        }

        const reader = (line: string): void => {
          clearTimeout(timeout);
          resolve(line);
        };
        const timeout = setTimeout(() => {
          const readerIndex = waitingReaders.indexOf(reader);
          if (readerIndex >= 0) {
            waitingReaders.splice(readerIndex, 1);
          }
          reject(new Error("Timed out waiting for MCP response"));
        }, 5000);
        waitingReaders.push(reader);
      });

    const request = async (
      id: number,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<RpcResponse> => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return JSON.parse(await nextLine()) as RpcResponse;
    };

    let exit: unknown[];
    try {
      const initialized = await request(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      });
      expect(initialized.jsonrpc).toBe("2.0");
      expect(initialized.id).toBe(1);
      expect(initialized.result?.protocolVersion).toBe("2024-11-05");
      expect(initialized.result?.serverInfo?.name).toBe("beans-memory");

      const tools = await request(2, "tools/list");
      expect(tools.result?.tools?.map((tool) => tool.name)).toContain("memory_note");
      expect(tools.result?.tools?.map((tool) => tool.name)).toContain("memory_search");

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const note = await request(3, "tools/call", {
        name: "memory_note",
        arguments: {
          title: "MCP durable note",
          body: "violet constellation archive",
          type: "decision",
        },
      });
      expect(note.result?.content?.[0]?.text).toMatch(/^Catatan tersimpan sebagai #\d+\.$/);

      const search = await request(4, "tools/call", {
        name: "memory_search",
        arguments: { query: "constellation" },
      });
      expect(search.result?.content?.[0]?.text).toContain("MCP durable note");
      expect(search.result?.content?.[0]?.text).toContain("constellation");
    } finally {
      child.kill("SIGTERM");
      exit = (await exitPromise) as unknown[];
      lines.close();
      rmSync(directory, { recursive: true, force: true });
    }

    expect(exit[0]).toBe(0);
    expect(exit[1]).toBeNull();
    expect(stderr).toBe("");
  });
});
