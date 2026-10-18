# Install HALLUCHECK and connect Jev

HALLUCHECK reviews coding-agent claims against local evidence and can use TypeSafe's Jev model to estimate risk. It supports local Codex and Claude Code workflows. It does not automatically attach itself to ordinary ChatGPT conversations.

## 1. Install from this repository

You need Node.js 22.13 or newer, pnpm 10, Git, and ripgrep on macOS or Linux. These instructions install from source; they do not assume an npm release exists.

```sh
git clone https://github.com/Ajitesh-lab/hallucheck.git
cd hallucheck
pnpm install --frozen-lockfile
pnpm build
npm link
node bin/install-skill.mjs
```

`npm link` makes `halluc-check` available on your PATH. The skill installer adds the [Codex skill](../plugins/codex/skills/hallucheck/SKILL.md) to `~/.codex/skills/hallucheck`, honoring `CODEX_HOME` when set. **It also enables automatic reviews for substantial coding work and extensive answers by default.** Short replies and trivial edits are skipped. It adds a marked policy block to the user-level `AGENTS.md`, preserves existing instructions, and backs up that file before changing it. It refuses to replace an existing skill; an optional destination may be supplied.

Start a new local Codex chat and work normally; qualifying tasks are reviewed without asking for the skill each time. You can also explicitly request a review of any task:

```text
$hallucheck Review this task for unsupported claims and fabricated APIs.
```

The skill uses the installed CLI even if MCP is not connected. To install the full Codex or Claude Code plugin, including supported lifecycle hooks and native finding actions, follow [Agent installation](../README.md#agent-installation). The standalone skill activates agent instructions; it does not install or trust hooks. A key is optional for local file, import, export, and compiler evidence.

If asking an agent to install it, use this prompt:

```text
Install HALLUCHECK from https://github.com/Ajitesh-lab/hallucheck.
Follow docs/SETUP.md and use the provided installer, or run the bundled
activation script if you download the skill folder directly. Enable automatic
reviews only for substantial coding work and extensive informational answers.
Keep API-key entry in my own terminal, never in this chat.
```

For a manual-only installation use `node bin/install-skill.mjs --manual`. If the skill was already downloaded by another installer, run `node /path/to/hallucheck/scripts/activate.mjs enable` as part of setup. Copying files alone cannot execute activation. The managed policy is for local Codex; Claude Code uses the full plugin's lifecycle hooks.

## 2. Get your TypeSafe key

Open the official [TypeSafe console](https://console.typesafe.ai) and obtain a Jev API key. TypeSafe links this console in its [official quick start](https://docs.typesafe.ai/introduction/quickstart). Use the full secret key, not a masked dashboard label. Never send it to the coding agent in chat or put it in a GitHub issue.

This setup command accepts a direct TypeSafe credential. Vercel Gateway keys (`vck_…`) belong to a different provider route; see [environment configuration](CONFIGURATION.md).

## 3. Save the key with hidden input

Run this yourself in your terminal:

```sh
halluc-check auth login
```

1. Paste the key at `TypeSafe / Jev API key (hidden):` and press Enter. Input is not echoed. No key is passed through the command line or shell history.
2. Choose whether HALLUCHECK may send redacted, bounded claim/evidence summaries to TypeSafe. Provider charges may apply. Pressing Enter defaults to **No**; saving a key alone does not enable inference.
3. If a credential is already saved, setup first asks whether to replace the saved provider settings. Declining keeps them unchanged. Replacing a Gateway configuration with a direct TypeSafe key also clears the old saved route/model settings.

Setup sends no API request. The command requires a real interactive terminal and refuses piped key input or key arguments. Agents should direct you to this command, never collect your secret in chat.

The file is `~/.config/hallucheck/jev.env`, with permissions `600`, inside a directory with permissions `700`. It is an owner-only plaintext file, **not encrypted** and not an OS keychain. Processes running as your user can read it. Both CLI and GUI-hosted HALLUCHECK can load it without adding a secret to your shell profile.

The writer refuses symlink targets, shared files/directories, and paths inside a Git worktree. The advanced `HALLUCHECK_PROVIDER_ENV_FILE` override must also point outside a Git worktree when using `auth login`. Repository `.env` files are not automatically loaded. Never commit a key even to a private repository.

## 4. Check configuration and access

```sh
halluc-check auth status
```

This reports whether saved settings exist and whether saved inference consent is enabled. It never prints the key and does not make a live request. `environmentOverrides: true` means a shell credential is set and takes precedence over the saved credential.

For one synthetic API request that contains no repository content:

```sh
halluc-check doctor --jev
```

This explicit diagnostic may use provider credits, even when ordinary external inference is disabled. `AUTH` means authentication failed, `ACCESS_DENIED` means model access was refused, and `BILLING` means the provider requires credits. Do not repeatedly retry a rejected credential; check your account in the official console.

If a project daemon is running, run these **in that project** after changing the key or consent:

```sh
halluc-check daemon stop
halluc-check daemon start
```

If no daemon is running, just run `halluc-check daemon start`. Reconnect an existing agent/MCP session so it picks up the new settings. A shell-supplied `JEV_API_KEY`, `TYPESAFE_API_KEY`, or `AI_GATEWAY_API_KEY` overrides the saved credential. `HALLUCHECK_EXTERNAL_INFERENCE=0` explicitly disables ordinary inference, and `HALLUCHECK_OFFLINE=1` forces local-only checking.

## Automatic reviews for substantial work

The default installer activates this behavior. Manage it without reinstalling:

```sh
halluc-check auto-review status
halluc-check auto-review enable
halluc-check auto-review disable
```

Automatic reviews cover meaningful implementation, debugging, code reviews and extensive factual reports or explanations. Greetings, acknowledgements, brief follow-ups, simple answers, and trivial typo/formatting edits are skipped. Judge the work actually performed: “build an app” is a short prompt that can still produce a large task. Explicitly asking for HALLUCHECK runs a review even for a small task. A qualifying review requires an actual tool result with an `eventId` and findings; if checking fails, the agent must disclose that the affected work remains unverified.

`disable` removes only the managed policy block. Existing manual instructions and full-plugin hooks remain unchanged. Changes take effect in chats that load the updated instructions; start a new chat if needed. Enable is idempotent and keeps a private backup of existing instructions before a change.

The full plugin additionally compares source fingerprints at the start and end of a request. Old changes already present before a short follow-up do not trigger a new task-end review. Source changes during this request do. Without source changes, the hook checks extensive prompts/answers (at least 2,000 characters or 350 whitespace-separated words), as well as explicit review requests. Without a prompt baseline, or when discovery is incomplete, it conservatively checks instead of claiming it safely skipped. The size heuristic is approximate; a small source edit can still trigger the code check. Per-edit observations and mandatory tool authorization rules remain separate from the task-end size filter.

Standalone activation is an agent-followed workflow. Full plugin hooks require the host's trust review and depend on supported events; MCP alone does not intercept every action. General prose without specific independent evidence stays unverified. Jev percentages are uncalibrated estimates for a particular claim, not guarantees about the whole answer.

## Rotate or remove your key

Run `halluc-check auth login` again to replace saved settings. To remove them:

```sh
halluc-check auth logout
```

Logout removes the local provider file. It does not revoke the provider key, clear existing shell variables, or erase credentials already held by running processes. Revoke exposed keys in the [TypeSafe console](https://console.typesafe.ai), clear any exported credentials, and restart affected daemons/connections.
