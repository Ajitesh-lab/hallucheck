# Local installation and host contracts

## Install the CLI

From this checkout, with Node >=22.13, pnpm, Git and ripgrep:

```sh
pnpm install --frozen-lockfile
pnpm check
npm link
halluc-check doctor
```

Alternatively `pnpm build && npm pack`, then `npm install -g /absolute/path/halluc-check-0.1.0.tgz`. Bundles include internal packages; external runtime dependencies install from the package manifest. No Docker or cloud backend is required.

The CLI must be on the host process PATH. For GUI applications, an absolute path to the installed executable in both hook and MCP configuration may be necessary. Run `command -v halluc-check` in the host environment to confirm.

## Claude Code

```sh
node bin/install-plugin.mjs claude-code /absolute/path/hallucheck-claude
claude plugin validate /absolute/path/hallucheck-claude
claude --plugin-dir /absolute/path/hallucheck-claude
```

The `.claude-plugin/plugin.json`, `hooks/hooks.json`, and `.mcp.json` use the official plugin layout. SessionStart starts/reuses the project daemon and reports status. PreToolUse performs a local conservative authorization check; it never blocks based solely on Jev predictions. PostToolUse runs asynchronously. File Write/Edit events trigger scoped compiler inspection; arbitrary shell output remains untrusted. Stop retains the provided completion message as a limited claim and reviews changed TypeScript/JavaScript source roots (or the bounded default selection when no tracked change list is available).

Claude can ask for authorization with `hookSpecificOutput.permissionDecision="ask"`. HALLUCHECK never returns an automatic allow. Post-tool feedback is informational and cannot undo an executed tool. In the default ASK_BEFORE_FIXING mode, Stop warns without continuing to repair. Only an eligible AUTO_FIX investigation can request continuation, and `stop_hook_active` prevents repeated continuation. Free-text claims do not invent evidence requirements, so a completion message alone normally stays NOT_CHECKED.

Uninstall:

```sh
node bin/uninstall-plugin.mjs /absolute/path/hallucheck-claude
```

Stop passing `--plugin-dir`, or remove an installed host marketplace entry, and restart the host. Stop a remaining daemon with `halluc-check daemon stop` in the project.

## Codex

This repository includes `.agents/plugins/marketplace.json`. In a trusted local checkout:

```sh
codex plugin marketplace add /absolute/path/to/Halluchecker
codex plugin add hallucheck@hallucheck-local
```

In Codex, review the exact hook definitions and trust them using `/hooks`. Installation does not grant hook trust. Restart the session after changing plugin code or configuration. The desktop can discover the same repo marketplace through its local plugin picker. No user-global settings were modified while developing this repository; CLI installation was tested with a disposable isolated CODEX_HOME.

For another target repository, copy `plugins/codex` into that repository using `node bin/install-plugin.mjs codex /target/repo/plugins/hallucheck`, then add this entry to its `.agents/plugins/marketplace.json` (paths are relative to the repository root):

```json
{
  "name": "hallucheck-local",
  "interface": { "displayName": "HALLUCHECK Local" },
  "plugins": [
    {
      "name": "hallucheck",
      "source": { "source": "local", "path": "./plugins/hallucheck" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Codex PreToolUse supports deny; ask is explicitly unsupported in the current documented runtime. HALLUCHECK maps mandatory authorization to a denial with human guidance, and never claims to create a Codex approval prompt. Normal host approval remains the authority. The HALLUCHECK review queue records human assessment; it does not bypass a mandatory tool guard. Ambiguous shell semantics remain the host sandbox/approval system's responsibility.

Supported hook subset: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop. Ordinary UserPromptSubmit events record a per-request source baseline and instruct the agent to review substantial work using the actual project path. Stop reviews source changed during that request (including untracked files), extensive prompts/answers, and explicit review requests; short replies without new source changes are skipped. Qualifying scans use a bounded source selection. Codex apply_patch has no structured file_paths in its hook contract, so its post-hook scans the bounded source selection rather than inventing a patch parser. Host versions/surfaces may expose different tool coverage. MCP tools cover explicit checks for unsupported event paths.

The standalone skill installer enables a managed substantial-task policy in user-level `~/.codex/AGENTS.md` by default. Existing downloaded skills can activate it with their bundled `scripts/activate.mjs enable`; `halluc-check auto-review enable|status|disable` manages the same policy. Use `--manual` at installation to opt out. The policy runs `halluc-check review-task` for substantial coding work and extensive answers, skips brief replies/trivial text edits, and requires an actual result with an event ID. This shared-engine fallback works even when an older MCP process remains connected. It is agent-followed guidance, not tool interception or a guarantee that every statement is verified. See [setup and size filtering](SETUP.md#automatic-reviews-for-substantial-work). Full plugin Stop hooks use a per-request source baseline to avoid rechecking already-dirty code on small follow-ups.

Uninstall with `codex plugin remove hallucheck@hallucheck-local`. Remove the local marketplace with `codex plugin marketplace remove hallucheck-local` when no longer used. For copied files, also run the marker-protected uninstall script on that exact destination.

Lifecycle-hook plugins are supported for manual Codex installation but are ineligible for the public plugin directory. See the [official packaging guide](https://developers.openai.com/plugins/build/plugins) and [hook behavior/trust reference](https://learn.chatgpt.com/docs/hooks).

## MCP

Both plugin packages declare the local MCP server. Standalone configuration:

```json
{
  "mcpServers": {
    "hallucheck": {
      "command": "halluc-check",
      "args": ["mcp", "--root", "/absolute/path/to/repository"]
    }
  }
}
```

Five base tools are exposed: `halluc_check_analyze`, `halluc_check_verify`, `halluc_check_get_findings`, `halluc_check_get_report`, `halluc_check_get_status`. MCP alone does not intercept agent activity. A server explicitly launched with `--root` stays pinned to that repository and rejects other roots. Plugin launches without `--root` resolve the workspace per request: pass an absolute `repositoryRoot` (inside `event` for analyze), or let a client advertising exactly one local MCP root select it. Multiple advertised roots require explicit selection, and requests outside advertised roots are rejected. Without client roots, an explicit path is supported; a plugin-cache launch directory is never silently used as the project. Engines, findings and interaction settings remain separate for each project. Reconnect an existing MCP process after updating the CLI to load the new schemas and routing. Four additional native interaction tools implement evidence choices, same-session repair, persistent settings and open findings. User risk acknowledgment is distinct from mandatory security approval; see [native interaction](NATIVE_INTERACTION.md).

Example `halluc_check_verify` arguments:

```json
{
  "repositoryRoot": "/absolute/path/to/repository",
  "claims": [
    {
      "statement": "src/auth.ts exports createSession.",
      "category": "API",
      "requiredEvidence": [
        { "kind": "export", "path": "src/auth.ts", "name": "createSession" }
      ]
    }
  ]
}
```

## Hook harness

After building, pipe representative host JSON to the real CLI. Run this in a fixture repository:

```sh
printf '%s\n' '{"session_id":"demo","cwd":"/absolute/path/to/fixture","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The tests pass."}' | halluc-check hook codex --root /absolute/path/to/fixture
```

`pnpm test` tests both host mappings, unsupported events, Stop recursion prevention, daemon ingestion, actual SDK MCP transport, and packaged stdio MCP calls.

Official references checked 2026-10-17: [Claude hooks](https://code.claude.com/docs/en/hooks), [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex packaging](https://developers.openai.com/plugins/build/plugins).
