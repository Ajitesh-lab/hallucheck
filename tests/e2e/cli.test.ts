import { beforeAll, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const exec = promisify(execFile);
const cli = path.resolve("bin/halluc-check.mjs");
let root: string;
beforeAll(async () => {
  await exec(process.execPath, ["scripts/build.mjs"]);
  root = await mkdtemp(path.join(tmpdir(), "hc-cli-"));
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(
    path.join(root, "bad.ts"),
    'import { missing } from "invented-package"; export const x:number="bad";',
  );
});
afterAll(async () => {
  try {
    await exec(process.execPath, [cli, "daemon", "stop", "--root", root]);
  } catch {}
  await rm(root, { recursive: true, force: true });
});
it("runs packaged CLI init, scan, daemon, status and prevents noninteractive approval", async () => {
  await exec(process.execPath, [cli, "init", "--root", root]);
  const scan = JSON.parse(
    (
      await exec(process.execPath, [
        cli,
        "scan",
        "--file",
        "bad.ts",
        "--root",
        root,
        "--json",
      ])
    ).stdout,
  );
  expect(
    scan.findings.some((f: { status: string }) => f.status === "CONTRADICTED"),
  ).toBe(true);
  expect(scan.providerStatus).toBe("disabled");
  await exec(process.execPath, [cli, "daemon", "start", "--root", root]);
  expect(
    JSON.parse(
      (await exec(process.execPath, [cli, "status", "--root", root, "--json"]))
        .stdout,
    ).running,
  ).toBe(true);
  const warm = JSON.parse(
    (
      await exec(process.execPath, [
        cli,
        "scan",
        "--file",
        "bad.ts",
        "--root",
        root,
        "--json",
      ])
    ).stdout,
  );
  expect(warm.findings.length).toBeGreaterThan(0);
  await expect(
    exec(process.execPath, [
      cli,
      "approve",
      scan.findings[0].id,
      "--root",
      root,
    ]),
  ).rejects.toThrow();
  await exec(process.execPath, [cli, "daemon", "stop", "--root", root]);
}, 20000);
it("serves real MCP JSON-RPC over stdio from the packaged executable", async () => {
  const client = new Client({ name: "packaged-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--root", root],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(9);
    const response = await client.callTool({
      name: "halluc_check_get_status",
      arguments: {},
    });
    expect(JSON.stringify(response)).toContain("disabled");
  } finally {
    await client.close();
  }
}, 10000);
it("copies installable plugins and uninstalls only marked directories", async () => {
  const destination = path.join(root, "plugin-install");
  await exec(process.execPath, [
    "bin/install-plugin.mjs",
    "claude-code",
    destination,
  ]);
  expect(
    JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(
          path.join(destination, ".claude-plugin/plugin.json"),
          "utf8",
        ),
      ),
    ).name,
  ).toBe("hallucheck");
  await exec(process.execPath, ["bin/uninstall-plugin.mjs", destination]);
  await expect(
    exec(process.execPath, ["bin/uninstall-plugin.mjs", root]),
  ).rejects.toThrow();
});
it("runs the actual Stop hook completion review with recursion protection", async () => {
  const { spawn } = await import("node:child_process");
  const invoke = (active: boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "hook", "codex", "--root", root],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (v) => (stdout += String(v)));
      child.stderr.on("data", (v) => (stderr += String(v)));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stderr));
        else resolve(JSON.parse(stdout));
      });
      child.stdin.end(
        JSON.stringify({
          session_id: "stop-test",
          cwd: root,
          hook_event_name: "Stop",
          stop_hook_active: active,
          last_assistant_message: "The feature is implemented.",
        }),
      );
    });
  const warning = await invoke(false);
  expect(warning).not.toHaveProperty("decision");
  expect(JSON.stringify(warning)).toContain("hallucheck fix");
  expect(await invoke(true)).not.toHaveProperty("decision");
}, 10000);
