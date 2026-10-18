import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Engine } from "../../../packages/core/src/index.js";
import {
  ClaimInputSchema,
  EventSchema,
} from "../../../packages/shared/src/index.js";
import { FindingInteractionService } from "../../../packages/core/src/interactions/index.js";
import { registerInteractionTools } from "./interactions.js";
import { rpc } from "../../daemon/src/index.js";
import { workspaceEngines } from "./workspace.js";
export async function createMcp(
  root?: string,
): Promise<{ server: McpServer; close: () => void }> {
  const server = new McpServer({ name: "hallucheck", version: "0.1.0" });
  const workspaces = workspaceEngines(server, root);
  const repositoryRoot = z
    .string()
    .optional()
    .describe(
      "Absolute active project path. Always pass this when using a plugin; never use the plugin cache directory.",
    );
  async function shared(
    engine: Engine,
    request: unknown,
    fallback: () => Promise<unknown> | unknown,
  ): Promise<unknown> {
    try {
      return await rpc(engine.root, request);
    } catch (error) {
      if (
        !["ENOENT", "ECONNREFUSED"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      return fallback();
    }
  }
  const result = (value: unknown, engine: Engine) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          result: value,
          interactionMode: new FindingInteractionService(engine).mode(),
          instruction:
            "In ASK_BEFORE_FIXING, do not repair from a warning alone. Offer halluc_check_action choices or wait for the developer native chat command. Never auto-accept risk.",
        }),
      },
    ],
    structuredContent: { result: value },
  });
  server.registerTool(
    "halluc_check_analyze",
    {
      description:
        "Analyze an explicit event in this configured repository. Does not intercept other tools or approve actions.",
      inputSchema: { event: EventSchema },
    },
    async ({ event }) => {
      const engine = await workspaces.get(event.repositoryRoot);
      return result(
        await shared(engine, { op: "analyze", event }, () =>
          engine.analyze(event),
        ),
        engine,
      );
    },
  );
  server.registerTool(
    "halluc_check_verify",
    {
      description:
        "Independently check scoped assertions using explicit evidence requirements. Only owner-configured commands may execute.",
      inputSchema: {
        repositoryRoot,
        claims: z.array(ClaimInputSchema).min(1).max(32),
        filePaths: z.array(z.string()).max(64).default([]),
      },
    },
    async ({ claims, filePaths, repositoryRoot }) => {
      const engine = await workspaces.get(repositoryRoot);
      const event = {
        repositoryRoot: engine.root,
        eventType: "AGENT_CLAIM",
        agentType: "mcp",
        claims,
        filePaths,
      };
      return result(
        await shared(engine, { op: "analyze", event }, () =>
          engine.analyze(event),
        ),
        engine,
      );
    },
  );
  server.registerTool(
    "halluc_check_get_findings",
    {
      description:
        "Read persisted findings. Human review cannot be performed by this server.",
      inputSchema: { repositoryRoot },
    },
    async ({ repositoryRoot }) => {
      const engine = await workspaces.get(repositoryRoot);
      return result(
        await shared(engine, { op: "findings" }, () => engine.findings()),
        engine,
      );
    },
  );
  server.registerTool(
    "halluc_check_get_report",
    {
      description:
        "Read an evidence report; this is not a project completion certificate.",
      inputSchema: { repositoryRoot },
    },
    async ({ repositoryRoot }) => {
      const engine = await workspaces.get(repositoryRoot);
      return result(
        await shared(engine, { op: "report" }, () => engine.report()),
        engine,
      );
    },
  );
  server.registerTool(
    "halluc_check_get_status",
    {
      description:
        "Report daemon and model availability without claiming unverified work is correct.",
      inputSchema: { repositoryRoot },
    },
    async ({ repositoryRoot }) => {
      const engine = await workspaces.get(repositoryRoot);
      return result(
        await shared(engine, { op: "status" }, () => ({
          running: false,
          providerStatus: engine.providerStatus,
          repositoryRoot: engine.root,
        })),
        engine,
      );
    },
  );
  registerInteractionTools(server, workspaces.get);
  return { server, close: workspaces.close };
}
export async function startMcp(root?: string): Promise<void> {
  const { server, close } = await createMcp(root);
  server.server.onclose = close;
  await server.connect(new StdioServerTransport());
}
