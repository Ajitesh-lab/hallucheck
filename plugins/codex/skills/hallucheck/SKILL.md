---
name: hallucheck
description: Handle HALLUCHECK findings inside the current coding conversation—inspect evidence, request an AI investigation, flag a warning, acknowledge risk, or change operating mode. Use for HALLUCHECK actions, not ordinary debugging without a finding.
---

Keep the user in this conversation. Do not launch a new coding session, frontend, browser or terminal UI for these actions.

Read `halluc_check_settings` for the current mode and negotiated capabilities. List outstanding findings with `halluc_check_list_open`, and show evidence with `halluc_check_action` action `evidence` (use `detailed=true` only when requested). Distinguish lifecycle state from independently established evidence status; accepted risk is never verified correctness.

For a user choice, call `halluc_check_action` action `choose` or the requested action. If the client supports MCP form elicitation, the tool presents the native choices and executes the actual selection. If the response is AWAITING_USER_ACTION, ask the user to send the exact supported native chat message returned by the tool, such as `hallucheck fix FULL_ID` or `hallucheck accept-risk FULL_ID reason`. Do not simulate user input, forge a UserPromptSubmit hook, set a confirmation boolean, or run a hook subprocess to approve your own action. Codex also supports explicit `$hallucheck` invocation; `/hallucheck` is not promised as a Codex slash command.

On a repair request, follow the evidence-bearing instruction returned by the service in this same conversation. Independently inspect the source, installed API definitions, and relevant documentation. A warning may be wrong. Preserve correct code and explain supporting evidence; otherwise make the smallest appropriate correction under normal host permissions and run relevant checks. Call `halluc_check_complete_repair` with the returned repairId. Your summary is not proof: the tool rechecks independently. Report VERIFIED, STILL_SUSPICIOUS, CONTRADICTED or REPAIR_FAILED accurately, then resume the user's original task. Cancel explicitly with `cancel=true` if the user abandons the repair. Respect the persisted attempt limit.

ASK_BEFORE_FIXING is the default; do not repair before a developer choice. AUTO_FIX permits only service-approved, low-risk investigations. INDICATOR_ONLY never triggers an automatic repair or Stop continuation. To change mode, use `halluc_check_settings`; if native forms are unavailable, the user can send `hallucheck settings ASK_BEFORE_FIXING`, `hallucheck settings AUTO_FIX`, or `hallucheck settings INDICATOR_ONLY`. These preferences persist locally without disabling security policy.

No MCP result authorizes destructive operations or bypasses host permissions. If a host supports neither form elicitation nor user-prompt hooks, evidence/listing remain available; do not invent a trusted user-decision channel.
