import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
