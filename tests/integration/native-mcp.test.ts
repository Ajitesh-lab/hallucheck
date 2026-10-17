import { it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ElicitRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcp } from "../../apps/mcp-server/src/index.js";
import { Engine } from "../../packages/core/src/index.js";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(
  forms: boolean,
  select: (options: string[]) => string | null,
) {
  const root = await mkdtemp(path.join(tmpdir(), "hc-choice-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(
    path.join(root, "bad.ts"),
    'export const token:number="bad";',
  );
  const engine = await Engine.open(root);
  const finding = (
    await engine.analyze({
      repositoryRoot: root,
      eventType: "MANUAL_SCAN",
      filePaths: ["bad.ts"],
    })
  ).findings[0]!;
  engine.close();
  const { server, close } = await createMcp(root);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: forms ? "Claude Code test" : "portable-no-choices", version: "1" },
    { capabilities: forms ? { elicitation: { form: {} } } : {} },
  );
  const choices: unknown[] = [];
  if (forms)
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      choices.push(request.params);
      if (request.params.mode === "url")
        throw new Error("URL elicitation is not used");
      const properties = request.params.requestedSchema.properties;
      const field = "action" in properties ? "action" : "mode";
      const options = (properties[field] as { enum: string[] }).enum;
      const selected = select(options);
      return selected
        ? {
            action: "accept",
            content: {
              [field]: selected,
              reason: "Developer choice from native test client",
            },
          }
        : { action: "cancel" };
    });
  await server.connect(st);
  await client.connect(ct);
  cleanups.push(async () => {
    await client.close();
    await server.close();
    close();
  });
  return { root, client, finding, choices };
}
function result(input: unknown): any {
  const response = CallToolResultSchema.parse(input);
  expect(response.isError).not.toBe(true);
  return response.structuredContent?.result;
}
it("negotiates real MCP form choices, returns evidence to the same connection and independently rechecks repair", async () => {
  const { root, client, finding, choices } = await setup(true, (options) =>
    options.includes("fix") ? "fix" : options[0]!,
  );
  const settings = result(
    await client.callTool({ name: "halluc_check_settings", arguments: {} }),
  );
  expect(settings.capabilities.nativeInteractiveChoices).toBe(true);
  const action = result(
    await client.callTool({
      name: "halluc_check_action",
      arguments: {
        findingId: finding.id,
        action: "choose",
        sessionId: "same-agent",
      },
    }),
  );
  expect(choices).toHaveLength(1);
  expect(action.instruction).toContain("Independent evidence");
  expect(action.repair.sessionId).toBe("same-agent");
  await writeFile(path.join(root, "bad.ts"), "export const token:number=1;");
  const completed = result(
    await client.callTool({
      name: "halluc_check_complete_repair",
      arguments: { repairId: action.repair.id, agentSummary: "Updated source" },
    }),
  );
  expect(completed.repair.outcome).toBe("VERIFIED");
});
it("records native accept-risk as a separate lifecycle without changing evidence", async () => {
  const { client, finding } = await setup(true, (options) =>
    options.includes("accept_risk") ? "accept_risk" : options[0]!,
  );
  expect(
    result(
      await client.callTool({
        name: "halluc_check_action",
        arguments: { findingId: finding.id, action: "accept_risk" },
      }),
    ).state,
  ).toBe("ACCEPTED_RISK");
  const view = result(
    await client.callTool({
      name: "halluc_check_action",
      arguments: { findingId: finding.id, action: "evidence" },
    }),
  );
  expect(view).toMatchObject({
    evidenceStatus: "CONTRADICTED",
    lifecycle: "ACCEPTED_RISK",
  });
});
it("does not fabricate native choices or approval in a client without elicitation", async () => {
  const { client, finding, choices } = await setup(false, () => null);
  const action = result(
    await client.callTool({
      name: "halluc_check_action",
      arguments: { findingId: finding.id, action: "fix" },
    }),
  );
  expect(action).toMatchObject({
    status: "AWAITING_USER_ACTION",
    nativeChoices: false,
  });
  expect(action.message).toContain("hallucheck fix");
  expect(choices).toEqual([]);
  const evidence = result(
    await client.callTool({
      name: "halluc_check_action",
      arguments: { findingId: finding.id, action: "evidence" },
    }),
  );
  expect(evidence.lifecycle).not.toBe("INVESTIGATING");
});
it("canceled native choices preserve the open finding and settings require a real user response", async () => {
  const { client, finding } = await setup(true, () => null);
  expect(
    result(
      await client.callTool({
        name: "halluc_check_action",
        arguments: { findingId: finding.id, action: "choose" },
      }),
    ).status,
  ).toBe("CANCELLED");
  expect(
    result(
      await client.callTool({
        name: "halluc_check_settings",
        arguments: { mode: "AUTO_FIX" },
      }),
    ),
  ).toMatchObject({ status: "CANCELLED", mode: "ASK_BEFORE_FIXING" });
});
