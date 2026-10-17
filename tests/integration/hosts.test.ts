import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  adaptHook,
  hookFeedback,
  claudeCapabilities,
} from "../../packages/integrations/claude-code/src/index.js";
import { codexCapabilities } from "../../packages/integrations/codex/src/index.js";
import { type Analysis } from "../../packages/shared/src/index.js";
const hostInput = {
  session_id: "session-1",
  cwd: process.cwd(),
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "rm -rf ./build" },
};
const result = {
  providerStatus: "disabled",
  findings: [
    {
      status: "NOT_CHECKED",
      humanReviewRequired: true,
      claim: { statement: "Requires authorization" },
      suggestedResolution: "Review",
    },
  ],
} as Analysis;
describe("host-specific hooks", () => {
  it("normalizes supported host input", () => {
    expect(adaptHook("claude-code", hostInput)).toMatchObject({
      eventType: "PRE_TOOL_EXECUTION",
      toolName: "Bash",
      agentType: "claude-code",
    });
    expect(
      adaptHook("codex", {
        ...hostInput,
        hook_event_name: "Stop",
        last_assistant_message: "All tests pass",
        stop_hook_active: true,
      }),
    ).toMatchObject({
      eventType: "AGENT_STOP",
      text: "All tests pass",
      metadata: { stopHookActive: true },
    });
  });
  it("does not fabricate Codex ask support", () => {
    const claude = hookFeedback(
      "claude-code",
      adaptHook("claude-code", hostInput),
      result,
    );
    const codex = hookFeedback("codex", adaptHook("codex", hostInput), result);
    expect(claude).toMatchObject({
      hookSpecificOutput: { permissionDecision: "ask" },
    });
    expect(codex).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(codexCapabilities.preToolAsk).toBe(false);
    expect(claudeCapabilities.postToolUndo).toBe(false);
  });
  it("prevents infinite Stop continuation and does not block speculative model risks", () => {
    const stop = {
      ...hostInput,
      hook_event_name: "Stop",
      tool_input: undefined,
      stop_hook_active: false,
    };
    const contradiction = {
      ...result,
      findings: [{ ...result.findings[0]!, status: "CONTRADICTED" }],
    } as Analysis;
    expect(
      hookFeedback("codex", adaptHook("codex", stop), contradiction),
    ).not.toHaveProperty("decision");
    expect(
      hookFeedback(
        "codex",
        adaptHook("codex", { ...stop, stop_hook_active: true }),
        contradiction,
      ),
    ).not.toHaveProperty("decision");
    expect(
      hookFeedback("codex", adaptHook("codex", stop), result),
    ).not.toHaveProperty("decision");
  });
  it("rejects unsupported lifecycle inputs", () => {
    expect(() =>
      adaptHook("codex", { ...hostInput, hook_event_name: "InventedHook" }),
    ).toThrow();
  });
  it("packages real manifests and async observational PostToolUse handlers", async () => {
    const claude = JSON.parse(
      await readFile("plugins/claude-code/.claude-plugin/plugin.json", "utf8"),
    );
    const codex = JSON.parse(
      await readFile("plugins/codex/plugin.json", "utf8"),
    );
    expect(claude.name).toBe("hallucheck");
    expect(codex.extensions["com.openai"].hooks).toBe("./hooks/hooks.json");
    for (const host of ["codex", "claude-code"]) {
      const hook = JSON.parse(
        await readFile(`plugins/${host}/hooks/hooks.json`, "utf8"),
      );
      expect(Object.keys(hook.hooks)).toEqual([
        "SessionStart",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "UserPromptSubmit",
      ]);
      expect(hook.hooks.PostToolUse[0].hooks[0].async).toBe(true);
    }
  });
});
