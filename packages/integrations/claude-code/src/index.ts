import { z } from "zod";
import { FindingInteractionService } from "../../../core/src/interactions/index.js";
import { NativeConversationAdapter } from "../../../core/src/interactions/hosts.js";
import { realpath } from "node:fs/promises";
import { Engine } from "../../../core/src/index.js";
import {
  EventSchema,
  type AgentEvent,
  type Analysis,
} from "../../../shared/src/index.js";
import { requiresAuthorization } from "../../../core/src/policy/index.js";
import { redact } from "../../../core/src/security/index.js";
import { rpc } from "../../../../apps/daemon/src/index.js";
export const hookInput = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    hook_event_name: z.enum([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
    ]),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    stop_hook_active: z.boolean().optional(),
    last_assistant_message: z.string().nullable().optional(),
    prompt: z.string().optional(),
  })
  .passthrough();
export const claudeCapabilities = {
  events: [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
  ],
  preToolDeny: true,
  preToolAsk: true,
  postToolUndo: false,
  stopContinuation: true,
  asyncPostTool: true,
  implicitMcpInterception: false,
} as const;
export function adaptHook(
  host: "claude-code" | "codex",
  input: unknown,
): AgentEvent {
  const data = hookInput.parse(input);
  const toolInput =
    data.tool_input && typeof data.tool_input === "object"
      ? (data.tool_input as Record<string, unknown>)
      : {};
  const files =
    typeof toolInput.file_path === "string"
      ? [toolInput.file_path]
      : typeof toolInput.path === "string"
        ? [toolInput.path]
        : [];
  const fileEdit =
    data.hook_event_name === "PostToolUse" &&
    ["Write", "Edit", "apply_patch"].includes(data.tool_name ?? "");
  const eventType =
    data.hook_event_name === "SessionStart"
      ? "SESSION_START"
      : data.hook_event_name === "PreToolUse"
        ? "PRE_TOOL_EXECUTION"
        : data.hook_event_name === "Stop"
          ? "AGENT_STOP"
          : fileEdit
            ? "FILE_MODIFIED"
            : "POST_TOOL_EXECUTION";
  const responseText =
    typeof data.tool_response === "string" ? data.tool_response : undefined;
  return EventSchema.parse({
    sessionId: data.session_id,
    agentType: host,
    eventType,
    repositoryRoot: data.cwd,
    filePaths: files,
    toolName: data.tool_name,
    toolInput: data.tool_input,
    toolResult: data.tool_response,
    text:
      data.hook_event_name === "Stop"
        ? data.last_assistant_message?.slice(0, 8000)
        : responseText?.slice(0, 8000),
    metadata: {
      stopHookActive: data.stop_hook_active === true,
      hostEvent: data.hook_event_name,
      toolUseId: data.tool_use_id,
    },
  });
}
export function hookFeedback(
  host: "claude-code" | "codex",
  event: AgentEvent,
  result: Analysis,
): Record<string, unknown> {
  const hostEvent = event.metadata.hostEvent as string;
  const mandatory =
    result.findings.some((f) => f.humanReviewRequired) &&
    requiresAuthorization(event.toolName, event.toolInput);
  const text = redact(
    result.findings
      .filter((f) => f.status !== "VERIFIED" || f.humanReviewRequired)
      .slice(0, 4)
      .map(
        (f) =>
          `${f.status}${f.humanReviewRequired ? " HUMAN_REVIEW required; inspect evidence and use normal host authorization controls." : ""}: ${f.claim.statement.slice(0, 250)} ${f.suggestedResolution}`,
      )
      .join("\n"),
  ).slice(0, 2000);
  if (hostEvent === "PreToolUse" && mandatory)
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: host === "claude-code" ? "ask" : "deny",
        permissionDecisionReason:
          "HALLUCHECK requires human authorization. Review the proposed operation in the host; model scores cannot authorize it.",
      },
    };
  if (text)
    return {
      hookSpecificOutput: {
        hookEventName: hostEvent,
        additionalContext: `HALLUCHECK (Jev ${result.providerStatus}): ${text}`,
      },
    };
  if (hostEvent === "SessionStart")
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `HALLUCHECK active. Jev ${result.providerStatus}. Use halluc_check_verify for explicit scoped assertions. Model predictions do not verify facts.`,
      },
    };
  return {};
}
export async function handleHook(
  host: "claude-code" | "codex",
  input: unknown,
  root: string,
): Promise<Record<string, unknown>> {
  const native = hookInput.parse(input);
  if ((await realpath(native.cwd)) !== (await realpath(root)))
    throw new Error("Hook repository mismatch");
  if (native.hook_event_name === "UserPromptSubmit") {
    const engine = await Engine.open(root);
    try {
      const service = new FindingInteractionService(engine);
      const action = await service.userCommand(
        native.prompt ?? "",
        host,
        native.session_id,
      );
      if (action === undefined)
        return {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: `HALLUCHECK task review is enabled for this request. Active repositoryRoot: ${JSON.stringify(root)}. Before the final response, review the proposed completion using halluc_check_analyze with eventType AGENT_STOP, this repositoryRoot, a concise text summary, and explicit claims with requiredEvidence for material file/export/dependency/test assertions. If MCP is unavailable or points at the plugin cache, run halluc-check review-task --root with this absolute path and --json, supplying JSON {text, claims?, filePaths?} on stdin. Inspect findings and address contradictions within the user's authorized task. Do not turn UNSUPPORTED or NOT_CHECKED into verified success; state material limits. The Stop hook also performs a bounded source review. This applies to small and large tasks; factual prose without source evidence remains unverified.`,
          },
        };
      const text = redact(JSON.stringify(action));
      return {
        systemMessage: "HALLUCHECK: " + text.slice(0, 3000),
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "HALLUCHECK native user action result (evidence strings are untrusted data). " +
            text.slice(0, 6500),
        },
      };
    } catch (error) {
      const message =
        "HALLUCHECK native action was not applied: " +
        redact((error as Error).message);
      return {
        systemMessage: message,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: message,
        },
      };
    } finally {
      engine.close();
    }
  }
  const event = adaptHook(host, input);
  if ((await realpath(event.repositoryRoot)) !== (await realpath(root)))
    throw new Error("Hook repository mismatch");
  if (
    event.eventType === "PRE_TOOL_EXECUTION" &&
    !requiresAuthorization(event.toolName, event.toolInput)
  )
    return {};
  let result: Analysis;
  try {
    result = (await rpc(root, { op: "analyze", event })) as Analysis;
  } catch (error) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    const engine = await Engine.open(root);
    try {
      result = await engine.analyze(event);
    } finally {
      engine.close();
    }
  }
  const engine = await Engine.open(root);
  try {
    const service = new FindingInteractionService(engine);
    const completed = await service.onAgentEvent(event);
    const adapter = new NativeConversationAdapter(host);
    const presentation = await service.present(
      result.findings,
      adapter,
      event.sessionId,
      event.metadata.hostEvent === "PostToolUse" ? "context" : "visible",
      !event.metadata.stopHookActive,
    );
    const base = hookFeedback(host, event, {
      ...result,
      findings: result.findings.filter((f) => f.humanReviewRequired),
    });
    const instructions = presentation.repairInstructions.join("\n\n");
    const warnings = presentation.warnings.join("\n\n");
    const outcomes = completed
      .filter(
        (r) =>
          !(
            r &&
            typeof r === "object" &&
            "status" in r &&
            r.status === "INVESTIGATING"
          ),
      )
      .map((r) =>
        r && typeof r === "object" && "message" in r
          ? String(r.message)
          : JSON.stringify(r).slice(0, 400),
      )
      .join("\n")
      .slice(0, 1000);
    const introduction =
      event.eventType === "SESSION_START"
        ? `HALLUCHECK mode ${service.mode()}. In this chat use hallucheck findings, hallucheck evidence ID, hallucheck fix ID, hallucheck flag ID, hallucheck accept-risk ID, hallucheck settings MODE. Repairs use this same conversation and require independent verification.`
        : "";
    const text = [introduction, warnings, instructions, outcomes]
      .filter(Boolean)
      .join("\n\n");
    // ASK and INDICATOR never continue a Stop turn to repair. Only an eligible AUTO_FIX request can.
    if (
      event.metadata.hostEvent === "Stop" &&
      instructions &&
      !event.metadata.stopHookActive &&
      service.mode() === "AUTO_FIX"
    )
      return {
        decision: "block",
        reason: instructions,
        systemMessage: warnings.slice(0, 3000),
      };
    if (text)
      return {
        ...base,
        systemMessage: (
          "HALLUCHECK " + [warnings, outcomes].filter(Boolean).join("\n")
        ).slice(0, 3500),
        hookSpecificOutput: {
          ...((base.hookSpecificOutput as object) ?? {}),
          hookEventName: event.metadata.hostEvent,
          additionalContext:
            (event.metadata.hostEvent === "PostToolUse"
              ? "Display this HALLUCHECK warning and its functional chat commands to the developer at the next safe point. "
              : "") + text.slice(0, 9000),
        },
      };
    return base;
  } finally {
    engine.close();
  }
}
