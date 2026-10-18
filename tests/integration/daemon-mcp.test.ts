import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { Engine } from "../../packages/core/src/index.js";
import { serve, rpc, JobQueue } from "../../apps/daemon/src/index.js";
import { createMcp } from "../../apps/mcp-server/src/index.js";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "hc-"));
  await writeFile(path.join(root, "package.json"), "{}");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
describe("local daemon and MCP", () => {
  async function connect(root?: string, roots?: () => string[]) {
    const { server, close } = await createMcp(root);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "workspace-test", version: "1" },
      roots ? { capabilities: { roots: { listChanged: true } } } : undefined,
    );
    if (roots)
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: roots().map((r) => ({ uri: pathToFileURL(r).href })),
      }));
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await server.close();
      close();
    });
    return client;
  }
  it("selects explicit workspaces per request and isolates their findings and settings", async () => {
    const a = await fixture(),
      b = await fixture();
    await writeFile(path.join(a, "api.ts"), "export const actual = 1;");
    await writeFile(path.join(b, "api.ts"), "export const other = 1;");
    const client = await connect();
    for (const [repositoryRoot, status] of [
      [a, "VERIFIED"],
      [b, "CONTRADICTED"],
    ]) {
      const response = await client.callTool({
        name: "halluc_check_verify",
        arguments: {
          repositoryRoot,
          claims: [
            {
              statement: "api exports actual",
              requiredEvidence: [
                { kind: "export", path: "api.ts", name: "actual" },
              ],
            },
          ],
        },
      });
      expect(response.isError).not.toBe(true);
      const result = (response.structuredContent as any).result;
      expect(result.findings[0].repositoryRoot).toBe(
        await realpath(repositoryRoot!),
      );
      expect(result.findings[0].status).toBe(status);
    }
    const listed = await client.callTool({
      name: "halluc_check_list_open",
      arguments: { repositoryRoot: a },
    });
    expect(JSON.stringify(listed)).not.toContain(b);
    const settings = await client.callTool({
      name: "halluc_check_settings",
      arguments: { repositoryRoot: b },
    });
    expect(JSON.stringify(settings)).toContain("ASK_BEFORE_FIXING");
  });
  it("uses negotiated client roots, follows root changes, and rejects other workspaces", async () => {
    const a = await fixture(),
      b = await fixture();
    let active = [a];
    const client = await connect(undefined, () => active);
    const status = () =>
      client.callTool({ name: "halluc_check_get_status", arguments: {} });
    expect(JSON.stringify(await status())).toContain(a);
    expect(
      (
        await client.callTool({
          name: "halluc_check_get_status",
          arguments: { repositoryRoot: b },
        })
      ).isError,
    ).toBe(true);
    active = [b];
    expect(JSON.stringify(await status())).toContain(b);
    active = [a, b];
    expect((await status()).isError).toBe(true);
    expect(
      (
        await client.callTool({
          name: "halluc_check_get_status",
          arguments: { repositoryRoot: a },
        })
      ).isError,
    ).not.toBe(true);
  });
  it("keeps explicit --root servers pinned even when a caller supplies another project", async () => {
    const a = await fixture(),
      b = await fixture();
    const client = await connect(a);
    const response = await client.callTool({
      name: "halluc_check_analyze",
      arguments: { event: { eventType: "MANUAL_SCAN", repositoryRoot: b } },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toContain("identity mismatch");
  });
  it("serves real socket ingestion, bounded jobs, reports, and repository-root enforcement", async () => {
    const root = await fixture();
    const engine = await Engine.open(root);
    const daemon = await serve(engine);
    cleanups.push(daemon.close);
    expect(await rpc(root, { op: "status" })).toMatchObject({
      running: true,
      providerStatus: "disabled",
    });
    const event = {
      repositoryRoot: root,
      eventType: "AGENT_CLAIM",
      claims: [
        {
          statement: "package exists",
          requiredEvidence: [{ kind: "file", path: "package.json" }],
        },
      ],
    };
    expect(await rpc(root, { op: "analyze", event })).toMatchObject({
      findings: [{ status: "VERIFIED" }],
    });
    await expect(
      rpc(root, { op: "analyze", event: { ...event, repositoryRoot: "/tmp" } }),
    ).rejects.toThrow("identity mismatch");
    const queued = (await rpc(root, { op: "enqueue", key: "file", event })) as {
      jobId: string;
    };
    let outcome: unknown;
    for (let i = 0; i < 100; i++) {
      outcome = await rpc(root, { op: "job", id: queued.jobId });
      if ((outcome as { status: string }).status === "complete") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(outcome).toMatchObject({ status: "complete" });
    expect(await rpc(root, { op: "report" })).toMatchObject({ total: 1 });
    await expect(
      rpc(root, { op: "approve", id: "invented" }),
    ).rejects.toThrow();
  });
  it("cancels superseded jobs and rejects excess queued jobs", async () => {
    const queue = new JobQueue(1, 1);
    let release!: () => void;
    const first = queue.enqueue("same", async (signal) => {
      await new Promise<void>((r) => {
        release = r;
      });
      signal.throwIfAborted();
      return 1;
    });
    const second = queue.enqueue("same", async () => 2);
    expect(() => queue.enqueue("other", async () => 3)).toThrow("full");
    release();
    for (let i = 0; i < 30; i++) {
      if ((queue.get(second) as { status: string }).status === "complete")
        break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(queue.get(first)).toMatchObject({ status: "canceled" });
    expect(queue.get(second)).toMatchObject({ status: "complete", result: 2 });
    queue.close();
  });
  it("exposes all nine MCP tools through the official transport and validates calls", async () => {
    const root = await fixture();
    const { server, close } = await createMcp(root);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "hallucheck-test", version: "1" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await server.close();
      close();
    });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [
        "halluc_check_action",
        "halluc_check_complete_repair",
        "halluc_check_settings",
        "halluc_check_list_open",
        "halluc_check_analyze",
        "halluc_check_verify",
        "halluc_check_get_findings",
        "halluc_check_get_report",
        "halluc_check_get_status",
      ].sort(),
    );
    const response = await client.callTool({
      name: "halluc_check_verify",
      arguments: {
        claims: [
          {
            statement: "package exists",
            requiredEvidence: [{ kind: "file", path: "package.json" }],
          },
        ],
      },
    });
    expect(response.isError).not.toBe(true);
    expect(JSON.stringify(response)).toContain("VERIFIED");
    const invalid = await client.callTool({
      name: "halluc_check_verify",
      arguments: { claims: [{ statement: "" }] },
    });
    expect(invalid.isError).toBe(true);
  });
});
