---
name: hallucheck
description: Automatically review substantial coding work, meaningful code reviews, and extensive factual answers before the final response. Also handle HALLUCHECK findings and uncertainty notes. Skip greetings, short follow-ups, simple answers and trivial text edits unless the user explicitly requests a review.
---

Keep the user in this conversation. Do not launch a new coding session, frontend, browser or terminal UI for these actions.

## Automatic activation and task size

For a user-requested installation, the repository installer enables substantial-task reviews by default. If the user asks to install this skill by downloading its folder directly, run its bundled `scripts/activate.mjs enable` as part of that requested setup; this adds a managed policy to user-level Codex instructions while preserving existing content. Do not activate global instructions merely because the skill was read during unrelated work. The user can choose manual installation or disable the managed policy. The Codex CLI also exposes `halluc-check auto-review enable`, `status`, and `disable`. Activation grants neither hook trust nor API access.

Automatically review substantive implementation, debugging, meaningful code reviews, and lengthy explanations/reports with material factual claims. Judge the work actually performed, not the brevity of the initial prompt. Skip greetings, acknowledgements, short follow-ups, simple factual answers and trivial typo/formatting edits. An explicit request to review still takes precedence and runs the check for a small task. Do not add an uncertainty footer solely because a small reply was not checked.

For qualifying work, require an actual checker response with `eventId`, findings and provider status before saying a review ran. Inspect its evidence and apply the final-note rules below. If the checker is unavailable, disclose that the affected work remains unverified instead of silently skipping. These agent instructions do not guarantee execution or verify every sentence; supported trusted hooks add an independent bounded review.

## Task review and key setup

The skill requires the installed `halluc-check` CLI on PATH. For a task review, run `halluc-check review-task --root /absolute/active/project --json`, supplying JSON on stdin with a concise truthful `text` summary, optional evidence-bearing `claims`, and optional `filePaths`. Use exact file/export/module/test evidence requirements for material assertions; never use the plugin cache as the project. Inspect the returned findings before applying the final-note rules below. If connected MCP tools support workspace selection, `halluc_check_analyze` with `eventType: AGENT_STOP` and the active `repositoryRoot` is an alternative.

For a direct TypeSafe key, tell the user to run `halluc-check auth login` themselves in their terminal. It hides key entry, asks before enabling external inference, and saves an owner-only local file outside Git. Never request the key in chat, accept it as a command argument, print it, or add it to repository files. `halluc-check auth status` reports saved settings without the key; `halluc-check auth logout` removes them. `halluc-check doctor --jev` is an explicit synthetic API request that may use provider credits. Setup itself sends no request. See the repository's `docs/SETUP.md` when available for installation and rotation.

If this is a standalone skill without MCP or hooks, use the CLI review fallback. Do not pretend native tools, hook interception, or repair IDs are available. When MCP tools are connected, follow the native interaction workflow below and pass the active absolute `repositoryRoot` on each call.

## Final-response note

After the task review, append one short note at the very end of the final response when a specific, material claim remains unresolved. Name the affected part of the work and a concrete check the user can make. Cover relevant UNSUPPORTED or NOT_CHECKED claims and confirmed contradictions; a generic completion summary being NOT_CHECKED alone does not justify a warning about the whole task. Omit the note when no material uncertainty remains, and do not repeat a resolved or stale warning.

For an unresolved claim with a current, real Jev prediction, use `round(100 * finding.prediction.incorrectRisk)` (or the equivalent `model.risk` from its evidence view), only if it is a finite number between 0 and 1, the prediction provider is `jev`, and the provider is available. Never invent a percentage, use a mock score, substitute `unsupported`, impact, action confidence or severity, average unrelated findings, or treat a model score as proof. These scores are uncalibrated model estimates, not measured probabilities that the work is hallucinated. Identify them that way in the note.

Example shape with a real score: “HALLUCHECK note: [specific claim] may be a hallucination (model-estimated risk: [X]%; uncalibrated). Please double-check [specific evidence or check].” Without a usable score: “HALLUCHECK note: [specific claim] is unverified; please double-check [specific check].” For a contradiction, say “[specific claim] conflicts with [observed evidence]; please check [location]” instead of softening established evidence into a speculative percentage. Do not include literal placeholders in the user's answer.

Keep the note to one or two sentences, with no extra heading or dashboard. Existing authorization and repair rules still apply. The note is not a claim that every other part of the answer has been verified.

When MCP tools are connected, read `halluc_check_settings` for the current mode and negotiated capabilities. List outstanding findings with `halluc_check_list_open`, and show evidence with `halluc_check_action` action `evidence` (use `detailed=true` only when requested). Distinguish lifecycle state from independently established evidence status; accepted risk is never verified correctness.

For a user choice, call `halluc_check_action` action `choose` or the requested action. If the client supports MCP form elicitation, the tool presents the native choices and executes the actual selection. If the response is AWAITING_USER_ACTION, ask the user to send the exact supported native chat message returned by the tool, such as `hallucheck fix FULL_ID` or `hallucheck accept-risk FULL_ID reason`. Do not simulate user input, forge a UserPromptSubmit hook, set a confirmation boolean, or run a hook subprocess to approve your own action. Codex also supports explicit `$hallucheck` invocation; `/hallucheck` is not promised as a Codex slash command.

On a repair request, follow the evidence-bearing instruction returned by the service in this same conversation. Independently inspect the source, installed API definitions, and relevant documentation. A warning may be wrong. Preserve correct code and explain supporting evidence; otherwise make the smallest appropriate correction under normal host permissions and run relevant checks. Call `halluc_check_complete_repair` with the returned repairId. Your summary is not proof: the tool rechecks independently. Report VERIFIED, STILL_SUSPICIOUS, CONTRADICTED or REPAIR_FAILED accurately, then resume the user's original task. Cancel explicitly with `cancel=true` if the user abandons the repair. Respect the persisted attempt limit.

ASK_BEFORE_FIXING is the default; do not repair before a developer choice. AUTO_FIX permits only service-approved, low-risk investigations. INDICATOR_ONLY never triggers an automatic repair or Stop continuation. To change mode, use `halluc_check_settings`; if native forms are unavailable, the user can send `hallucheck settings ASK_BEFORE_FIXING`, `hallucheck settings AUTO_FIX`, or `hallucheck settings INDICATOR_ONLY`. These preferences persist locally without disabling security policy.

No MCP result authorizes destructive operations or bypasses host permissions. If a host supports neither form elicitation nor user-prompt hooks, evidence/listing remain available; do not invent a trusted user-decision channel.
