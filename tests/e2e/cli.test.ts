import { beforeAll, it, expect, afterAll } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
const exec = promisify(execFile);
const cli = path.resolve("bin/halluc-check.mjs");
let root: string;
async function inputCli(
  args: string[],
  data: unknown,
  cwd?: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: {
        ...process.env,
        HALLUCHECK_OFFLINE: "1",
        HALLUCHECK_EXTERNAL_INFERENCE: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (v) => (stdout += String(v)));
    child.stderr.on("data", (v) => (stderr += String(v)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)),
    );
    child.stdin.end(JSON.stringify(data));
  });
}
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
it("diagnoses a provider access restriction through the packaged CLI without exposing credentials", async () => {
  let received = "";
  const server = createServer((request, response) => {
    expect(request.url).toBe("/typesafe/v1/systemone");
    request.on("data", (chunk) => {
      received += chunk;
    });
    request.on("end", () => {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { type: "no_providers_available" } }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    const result = await exec(
      process.execPath,
      [cli, "doctor", "--jev", "--root", root, "--json"],
      {
        env: {
          ...process.env,
          JEV_API_KEY: "vck_test_diagnostic_key",
          JEV_BASE_URL: `http://127.0.0.1:${address.port}/typesafe`,
          HALLUCHECK_EXTERNAL_INFERENCE: "0",
        },
      },
    ).then(
      () => {
        throw new Error("Expected diagnostic exit code 1");
      },
      (error) => error,
    );
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).jev).toMatchObject({
      ok: false,
      code: "ACCESS_DENIED",
    });
    expect(result.stdout).not.toContain("vck_test_diagnostic_key");
    expect(JSON.parse(received).state).toBe("The number is 2.");
    expect(received).not.toContain("bad.ts");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
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
    env: { HALLUCHECK_OFFLINE: "1", HALLUCHECK_EXTERNAL_INFERENCE: "0" },
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
it("reviews ordinary completion text, explicit assertions and source errors through the installed CLI", async () => {
  const result = await inputCli(["review-task", "--root", root, "--json"], {
    text: "Everything works and all tests pass.",
    claims: [
      {
        statement: "package exists",
        requiredEvidence: [{ kind: "file", path: "package.json" }],
      },
    ],
  });
  expect(
    result.findings.some(
      (f: any) =>
        f.claim.statement === "package exists" && f.status === "VERIFIED",
    ),
  ).toBe(true);
  expect(
    result.findings.some(
      (f: any) =>
        f.claim.statement === "Everything works and all tests pass." &&
        f.status === "NOT_CHECKED",
    ),
  ).toBe(true);
  expect(result.findings.some((f: any) => f.status === "CONTRADICTED")).toBe(
    true,
  );
  const prose = await inputCli(["review-task", "--root", root, "--json"], {
    text: "This advice is correct.",
  });
  expect(prose.findings[0].status).toBe("NOT_CHECKED");
  await expect(
    inputCli(["review-task", "--root", root, "--json"], {}),
  ).rejects.toThrow("requires completion");
});
it("uses hook payload cwd even when launched from another directory", async () => {
  const output = await inputCli(
    ["hook", "codex"],
    {
      session_id: "cwd-test",
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix this",
    },
    path.dirname(root),
  );
  expect(JSON.stringify(output)).toContain(root);
  await expect(
    inputCli(["hook", "codex", "--root", path.dirname(root)], {
      session_id: "cwd-test",
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix this",
    }),
  ).rejects.toThrow("mismatch");
});
it("does not mistake a plugin launch folder for a project and accepts explicit project roots", async () => {
  const plugin = path.join(root, "plugin-cache");
  await mkdir(plugin);
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({ name: "hallucheck" }),
  );
  const client = new Client({ name: "plugin-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: plugin,
    env: { HALLUCHECK_OFFLINE: "1", HALLUCHECK_EXTERNAL_INFERENCE: "0" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const noRoot = await client.callTool({
      name: "halluc_check_get_status",
      arguments: {},
    });
    expect(noRoot.isError).toBe(true);
    expect(JSON.stringify(noRoot)).toContain("No workspace selected");
    const result = await client.callTool({
      name: "halluc_check_verify",
      arguments: {
        repositoryRoot: root,
        claims: [
          {
            statement: "package exists",
            requiredEvidence: [{ kind: "file", path: "package.json" }],
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("VERIFIED");
    const { access } = await import("node:fs/promises");
    await expect(access(path.join(plugin, ".hallucheck"))).rejects.toThrow();
  } finally {
    await client.close();
  }
});
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
it("installs a standalone skill without replacing an existing skill", async () => {
  const target = path.join(root, "standalone-skill");
  const env = {
    ...process.env,
    CODEX_HOME: path.join(root, "test-codex-home"),
  };
  await exec(process.execPath, ["bin/install-skill.mjs", target], { env });
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(path.join(target, "SKILL.md"), "utf8")).toContain(
    "Final-response note",
  );
  await expect(
    exec(process.execPath, ["bin/install-skill.mjs", target], { env }),
  ).rejects.toThrow();
  expect(
    await readFile(path.join(env.CODEX_HOME, "AGENTS.md"), "utf8"),
  ).toContain("substantive coding work");
});
it("reports saved credentials without showing them and refuses noninteractive secret entry or key arguments", async () => {
  const dir = path.join(root, "auth-test");
  await mkdir(dir, { mode: 0o700 });
  const file = path.join(dir, "jev.env");
  const key = "test-never-display-this-key";
  await writeFile(
    file,
    `TYPESAFE_API_KEY=${key}\nHALLUCHECK_EXTERNAL_INFERENCE=0\n`,
    { mode: 0o600 },
  );
  const env = { ...process.env, HALLUCHECK_PROVIDER_ENV_FILE: file };
  const status = await exec(
    process.execPath,
    [cli, "auth", "status", "--json"],
    { env },
  );
  expect(JSON.parse(status.stdout)).toMatchObject({
    saved: true,
    provider: "TypeSafe",
    externalInference: false,
  });
  expect(status.stdout + status.stderr).not.toContain(key);
  await expect(
    exec(process.execPath, [cli, "auth", "login"], { env }),
  ).rejects.toThrow("interactive terminal");
  const bad = await exec(
    process.execPath,
    [cli, "auth", "login", "--key", key],
    { env },
  ).catch((error) => error);
  expect(bad.stderr).toContain("no key arguments");
  expect(bad.stdout + bad.stderr).not.toContain(key);
  const badRoot = await exec(
    process.execPath,
    [cli, "auth", "login", "--root", key],
    { env },
  ).catch((error) => error);
  expect(badRoot.stderr).toContain("no key arguments");
  expect(badRoot.stdout + badRoot.stderr).not.toContain(key);
  const removed = await exec(
    process.execPath,
    [cli, "auth", "logout", "--json"],
    { env },
  );
  expect(JSON.parse(removed.stdout).removed).toBe(true);
});
it("manages substantial-task activation through the packaged CLI without reinstalling", async () => {
  const home = path.join(root, "managed-codex-home");
  const env = { ...process.env, CODEX_HOME: home };
  const run = async (mode: string) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, "auto-review", mode, "--json"], {
          env,
        })
      ).stdout,
    );
  expect((await run("status")).enabled).toBe(false);
  expect(await run("enable")).toMatchObject({
    enabled: true,
    scope: "substantial-tasks",
    hooksInstalled: false,
  });
  expect((await run("status")).enabled).toBe(true);
  expect((await run("disable")).enabled).toBe(false);
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
