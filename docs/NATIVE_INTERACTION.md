# Native findings and AI repair

HALLUCHECK uses the coding conversation you already have open. No frontend, web server UI, browser window, standalone TUI, separate coding session, or editor extension is required. The background daemon and optional diagnostic CLI remain local infrastructure.

## In-conversation actions

After installing the updated plugin and trusting its hooks, send these as **ordinary messages in the existing agent conversation**. Use the full finding ID shown in the warning:

```text
hallucheck findings
hallucheck evidence FINDING_ID
hallucheck fix FINDING_ID
hallucheck flag FINDING_ID
hallucheck accept-risk FINDING_ID optional reason
hallucheck settings
hallucheck settings ASK_BEFORE_FIXING
hallucheck settings AUTO_FIX
hallucheck settings INDICATOR_ONLY
```

Both Claude Code and Codex register UserPromptSubmit. These exact messages are parsed by HALLUCHECK before the active agent continues. The result is returned as native hook context and a supported warning message. There is no shell command to copy into a separate terminal. The hook validates repository identity and finding freshness. A model should never manufacture a UserPromptSubmit event to authorize itself.

Claude Code additionally packages the `/hallucheck:hallucheck` skill. Codex packages `$hallucheck`. Those workflows use the MCP tools and direct the user to the same plain chat commands when the client has no native choice dialog. `/hallucheck` is not claimed as a universal Codex slash command.

## Native choices when supported

`halluc_check_action` offers `choose`, `fix`, `evidence`, `flag`, and `accept_risk`. The server negotiates `elicitation.form` from the actual MCP initialization capabilities. With that capability, `choose` sends a standard `elicitation/create` form with four real choices. The server applies the returned action, not the model's guess about what the user selected. Dismissal/cancellation preserves the finding and starts no repair.

The dedicated tools are:

| Tool                         | Behavior                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| halluc_check_action          | Evidence or native action selection for an exact finding          |
| halluc_check_complete_repair | Independently rechecks a repair, or cancels it                    |
| halluc_check_settings        | Current mode/capabilities; user-confirmed persistent mode changes |
| halluc_check_list_open       | Durable unresolved, flagged, accepted-risk, and stale findings    |

The five original analysis/report/status tools remain available. There are nine tools in total.

If a client has no form elicitation, mutating action requests return AWAITING_USER_ACTION plus the supported plain chat command. In Claude/Codex the installed user-prompt hook executes that command. Evidence and listing work without elicitation. A third-party client with neither form elicitation nor user-prompt hooks has no authenticated user-action channel in this MVP: it can inspect findings but cannot pretend a model-generated confirmation is a human choice. No fake buttons or confirmation booleans are used.

## Operating modes

**ASK_BEFORE_FIXING** is the default. Meaningful warnings offer functional chat actions. No repair instruction or Stop continuation is emitted until a native developer choice. A contradiction still remains a contradiction; operating mode does not suppress evidence.

**AUTO_FIX** can request an investigation only for a directly contradicted TypeScript finding with independent reliable evidence, no mandatory review, and a Jev impact estimate no greater than Moderate. Offline mode has no severity prediction, so it does not guess auto-repair eligibility. All actual changes remain the active agent's responsibility under normal host permissions. A request contains evidence and explicitly tells the agent to investigate independently. At most two attempts per claim lineage are allowed by default, across source snapshots. Reaching the limit leaves the finding open for manual work.

**INDICATOR_ONLY** records and presents warnings without initiating repairs or continuing a Stop turn. The user can explicitly request an investigation later. Mandatory destructive-operation guards still apply; indicator mode cannot weaken security permissions.

Mode preferences persist in SQLite and are read on each interaction. They do not change the source snapshot or require restarting the daemon. Project configuration supplies the default mode and repair limits:

```json
{
  "interaction": {
    "mode": "ASK_BEFORE_FIXING",
    "maxRepairAttempts": 2,
    "repairTimeoutMs": 300000
  }
}
```

## Fix with AI, in the same session

1. The developer selects Fix with AI in a negotiated MCP form or sends `hallucheck fix FINDING_ID` in the existing chat.
2. The shared service validates freshness, records AI_RECHECK_REQUESTED then INVESTIGATING, and creates a bounded repair ID tied to the host/session and claim lineage.
3. The native tool/hook result includes the exact claim, file/line locations, actual evidence, limitations, and a compact investigation instruction. It tells the active agent to inspect source, installed definitions and documentation before changing anything. HALLUCHECK may be wrong.
4. The agent makes a minimal correction if warranted, or preserves valid code and cites evidence. It runs appropriate checks, subject to ordinary permissions.
5. The agent calls `halluc_check_complete_repair` with the repair ID. HALLUCHECK independently executes the original scoped evidence checks against current source. The agent's summary is audit data, never proof.
6. Native edit/test/Stop events also recheck pending repairs for the same host session. Intermediate failed checks remain INVESTIGATING while work continues; successful evidence can resolve immediately. Stop/completion finalizes an unsuccessful attempt.
7. The result is VERIFIED, STILL_SUSPICIOUS, CONTRADICTED, or REPAIR_FAILED. The user gets concise same-conversation feedback and the agent resumes the original task.

For MCP-started repairs, pass the current hook session ID if available to enable automatic event matching. Otherwise explicit `halluc_check_complete_repair` remains the reliable completion route on the same connection. A plain chat `hallucheck complete REPAIR_ID` is also supported. `hallucheck cancel REPAIR_ID` or tool `cancel=true` cancels without deleting the finding. Abandoned repairs expire when the next interaction/event/list checks the durable queue.

A user-requested investigation of a high-risk finding does not authorize a high-risk change. The instruction retains the human-review requirement and normal host permission boundary. Accept Risk also cannot unlock a tool guard.

## Evidence state and lifecycle are separate

Durable lifecycle:

```text
DETECTED -> PRESENTED -> FLAGGED / ACCEPTED_RISK / AI_RECHECK_REQUESTED
AI_RECHECK_REQUESTED -> INVESTIGATING -> VERIFIED / STILL_SUSPICIOUS / REPAIR_FAILED
```

CONTRADICTED is also an independent repair outcome when an investigation confirms the suspected defect without attempting a correction. Cancellation and expiry leave the finding STILL_SUSPICIOUS, with a canceled/abandoned repair audit record.

ACCEPTED_RISK records finding ID, exact source snapshot, time, and optional reason. It does not change the underlying evidence status, become VERIFIED, or grant security authorization. Code changes create fresh findings and invalidate old acknowledgments. Listings retain stale historical entries with an explicit stale marker; they are not silently discarded.

## Host visibility and limitations

- Claude synchronous hook `systemMessage` is a supported user-visible warning. Async PostToolUse hook output is delivered as model context at the next safe turn, not a direct user notification. The plugin explicitly instructs the active agent to relay the warning. Stop/UserPromptSubmit provide the synchronous user-visible fallback. HALLUCHECK does not claim a toast or desktop notification API.
- Codex uses its documented `systemMessage`/`additionalContext` contracts. Async hooks cannot block or restart an idle conversation. A supported synchronous Stop continuation is used only for a fresh, eligible AUTO_FIX request, and never when `stop_hook_active` is already true.
- Notifications are deduplicated durably by unchanged finding, host, and delivery channel. Context relay and synchronous visibility are distinct channels because Claude does not display async hook messages directly. Flagged and accepted-risk findings remain stored without repeated warnings.
- Native forms occur only during an explicit MCP tool request. A shell hook cannot independently open a choice dialog. Codex form support is detected from its actual connection, not inferred from the product name.
- Claude mods were researched. The current official overview requires terminal v2.1.287+ (desktop v2.1.286+), while the installed terminal is v2.1.273. This implementation deliberately uses supported settings hooks, skills, and MCP forms rather than ship an untestable in-process mod or require upgrading Claude. No mod/pane or button renderer is included.
- The plugin cannot force an idle agent to begin a new turn, prove that the agent followed every instruction, or guarantee a repair is possible. Actual independent post-repair evidence and an auditable unresolved outcome are the boundary.
- Host forms or hooks are not cryptographic proof of human identity; same-UID hostile processes and user-installed elicitation auto-answer hooks remain trust limitations. This acknowledgment channel never grants mandatory security approvals.

References checked 2026-10-17: [Claude elicitation](https://code.claude.com/docs/en/mcp), [Claude hook output and async behavior](https://code.claude.com/docs/en/hooks), [Claude skill namespacing](https://code.claude.com/docs/en/skills), [Claude mods requirements](https://code.claude.com/docs/en/plugins/mods/overview), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex skills](https://learn.chatgpt.com/docs/build-skills).
