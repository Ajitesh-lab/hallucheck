import {
  type HostCapabilities,
  type HostInteractionAdapter,
  type FindingView,
  type OperatingMode,
  type UserAction,
} from "../../../shared/src/index.js";
/** Hook output is returned to its invoking host; this adapter never claims a push/resume API. */
export class NativeConversationAdapter implements HostInteractionAdapter {
  constructor(
    readonly host: "claude-code" | "codex" | "mcp",
    readonly formChoices = false,
    readonly elicit?: (
      view: FindingView,
      actions: UserAction[],
    ) => Promise<{ action: UserAction; reason?: string } | null>,
  ) {}
  capabilities(): HostCapabilities {
    return {
      host: this.host,
      nativeNotifications: false,
      nativeInteractiveChoices: this.formChoices && !!this.elicit,
      conversationVisibleWarnings: true,
      sameSessionRepairInstructions: true,
      commandsOrSkills: this.host !== "mcp",
      lifecycleHooks: this.host !== "mcp",
      mcpTools: true,
      canResumeIdleTurn: false,
    };
  }
  showFinding(view: FindingView, mode: OperatingMode): string {
    const location =
      view.locations
        .map((l) => `${l.file}${l.line ? ":" + l.line : ""}`)
        .join(", ") || "Unspecified source";
    const command = "hallucheck";
    return `HALLUCHECK ${view.findingId}\n${view.confirmed ? "Confirmed scoped contradiction" : "Suspicious — not confirmed"} · ${view.evidenceStatus} · ${location}\n${view.statement.slice(0, 240)}\n${mode === "INDICATOR_ONLY" ? "Indicator only; coding may continue. " : ""}Actions in this chat: ${command} fix ${view.findingId} | ${command} evidence ${view.findingId} | ${command} flag ${view.findingId} | ${command} accept-risk ${view.findingId}\nDo not modify code solely because of this warning. In ASK_BEFORE_FIXING, wait for the developer to request a fix. For native choices call halluc_check_action with action=choose when supported.`;
  }
  async requestUserAction(
    view: FindingView,
    actions: UserAction[],
  ): Promise<{ action: UserAction; reason?: string } | null> {
    if (!this.capabilities().nativeInteractiveChoices) return null;
    return this.elicit!(view, actions);
  }
}
