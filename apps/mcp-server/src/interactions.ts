import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Engine } from "../../../packages/core/src/index.js";
import { FindingInteractionService } from "../../../packages/core/src/interactions/index.js";
import { NativeConversationAdapter } from "../../../packages/core/src/interactions/hosts.js";
import {
  OperatingMode,
  UserAction,
  type FindingView,
} from "../../../packages/shared/src/index.js";
export function registerInteractionTools(
  server: McpServer,
  engine: Engine,
): void {
  const service = new FindingInteractionService(engine);
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
  });
  const adapter = () => {
    const supports =
      server.server.getClientCapabilities()?.elicitation?.form !== undefined;
    const name = server.server.getClientVersion()?.name.toLowerCase() ?? "";
    const host = name.includes("claude")
      ? "claude-code"
      : name.includes("codex")
        ? "codex"
        : "mcp";
    return new NativeConversationAdapter(
      host,
      supports,
      async (view: FindingView, actions) => {
        const choice = await server.server.elicitInput(
          {
            mode: "form",
            message: `HALLUCHECK ${view.findingId}: ${view.statement.slice(0, 250)}\n${view.evidenceStatus}. Choose an action; accepting risk never verifies the claim or authorizes a destructive operation.`,
            requestedSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  title: "Action",
                  enum: actions,
                  enumNames: actions.map(
                    (a) =>
                      ({
                        fix: "Fix with AI",
                        evidence: "Review evidence",
                        flag: "Flag for later",
                        accept_risk: "Accept risk",
                      })[a],
                  ),
                },
                reason: { type: "string", title: "Optional reason" },
              },
              required: ["action"],
            },
          },
          { timeout: 120000 },
        );
        if (choice.action !== "accept") return null;
        const parsed = z
          .object({
            action: UserAction,
            reason: z.string().max(2000).optional(),
          })
          .parse(choice.content);
        if (!actions.includes(parsed.action))
          throw new Error(
            "Host returned an action outside the offered choices",
          );
        return parsed;
      },
    );
  };
  const fallback = (findingId: string, action: string) => ({
    status: "AWAITING_USER_ACTION",
    nativeChoices: false,
    message: `This client has not advertised MCP form elicitation. In Claude Code or Codex, send this exact message in the existing conversation: hallucheck ${action === "accept_risk" ? "accept-risk" : action} ${findingId}. The UserPromptSubmit hook handles the decision. Evidence and findings remain available through MCP. No button or user approval was fabricated.`,
  });
  server.registerTool(
    "halluc_check_action",
    {
      description:
        "Show evidence or offer native user choices for Fix with AI, Flag for Later, Accept Risk. Repairs remain in this session. User decisions require an actual elicitation response or native user command.",
      inputSchema: {
        findingId: z.string(),
        action: z.enum(["choose", "fix", "evidence", "flag", "accept_risk"]),
        sessionId: z.string().default("mcp-current"),
        detailed: z.boolean().default(false),
      },
      _meta: { "anthropic/requiresUserInteraction": true },
    },
    async ({ findingId, action, sessionId, detailed }) => {
      const host = adapter();
      const view = await service.evidence(findingId, detailed);
      if (action === "evidence") return result(view);
      if (action === "fix" && service.mode() === "AUTO_FIX") {
        const finding = engine.store.get(findingId)!;
        if (service.eligibleForAuto(finding))
          return result(
            await service.act(findingId, "fix", {
              host: host.capabilities().host,
              sessionId,
              authority: "auto-policy",
            }),
          );
      }
      if (!host.capabilities().nativeInteractiveChoices)
        return result(
          fallback(findingId, action === "choose" ? "evidence" : action),
        );
      const choice = await host.requestUserAction(
        view,
        action === "choose" ? UserAction.options : [action],
      );
      if (!choice)
        return result({
          status: "CANCELLED",
          findingId,
          message: "No action taken; finding remains open.",
        });
      return result(
        await service.act(findingId, choice.action, {
          host: host.capabilities().host,
          sessionId,
          authority: "mcp-elicitation",
          reason: choice.reason,
          detailed,
        }),
      );
    },
  );
  server.registerTool(
    "halluc_check_complete_repair",
    {
      description:
        "Independently recheck a same-session repair. Agent summary is audited, never used as proof. Can also cancel a repair without losing its finding.",
      inputSchema: {
        repairId: z.string(),
        agentSummary: z.string().max(2000).optional(),
        attemptedRepair: z.boolean().default(true),
        cancel: z.boolean().default(false),
      },
    },
    async ({ repairId, agentSummary, attemptedRepair, cancel }) =>
      result(
        cancel
          ? service.cancel(repairId)
          : await service.complete(repairId, { agentSummary, attemptedRepair }),
      ),
  );
  server.registerTool(
    "halluc_check_settings",
    {
      description:
        "Read persistent interaction mode and real negotiated host capabilities, or request a native user-confirmed mode change.",
      inputSchema: { mode: OperatingMode.optional() },
    },
    async ({ mode }) => {
      const host = adapter();
      if (!mode)
        return result({
          mode: service.mode(),
          availableModes: OperatingMode.options,
          capabilities: host.capabilities(),
        });
      if (!host.capabilities().nativeInteractiveChoices)
        return result({
          status: "AWAITING_USER_ACTION",
          message: `Send in this chat: hallucheck settings ${mode}. The native user-prompt hook persists it.`,
        });
      const answer = await server.server.elicitInput(
        {
          mode: "form",
          message:
            "Choose HALLUCHECK operating mode. AUTO_FIX only requests bounded, low-risk same-session investigations under normal host permissions.",
          requestedSchema: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                enum: OperatingMode.options,
                default: mode,
              },
            },
            required: ["mode"],
          },
        },
        { timeout: 120000 },
      );
      if (answer.action !== "accept")
        return result({ status: "CANCELLED", mode: service.mode() });
      const selected = z.object({ mode: OperatingMode }).parse(answer.content);
      return result(service.setMode(selected.mode, "mcp-elicitation"));
    },
  );
  server.registerTool(
    "halluc_check_list_open",
    {
      description:
        "List durable open, flagged, accepted-risk and stale findings with lifecycle and evidence status kept separate.",
      inputSchema: {},
    },
    async () => result(await service.list()),
  );
}
