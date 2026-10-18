# HALLUCHECK

Evidence-grounded verification for AI coding agents. A local TypeScript/JavaScript verifier, optional Jev decision provider, persistent Unix-socket daemon, Claude Code and Codex hook plugins, and nine explicit MCP tools share one engine.

The system separates **VERIFIED**, **CONTRADICTED**, **UNSUPPORTED**, and **NOT_CHECKED**. Model predictions never verify facts. Missing test evidence is uncertainty, not a failed test. Source stays local by default; external inference and command execution require separate explicit opt-ins.

**Start here:** [Install the skill and securely configure your TypeSafe key](docs/SETUP.md). The [Codex skill](plugins/codex/skills/hallucheck/SKILL.md) and [Claude Code skill](plugins/claude-code/skills/hallucheck/SKILL.md) are included in this public repository.

When a material claim remains uncertain, the skill adds a short note at the end of its answer naming what to double-check. A percentage is shown only when a current real Jev risk estimate is available, and is labeled an uncalibrated model estimate. Without a score it says “unverified.” No score is invented, and successful work does not get a routine warning.

## Native findings and Fix with AI

Warnings and repair actions stay inside Claude Code, Codex, or an MCP client. After installing the plugin, send these ordinary messages in your current coding conversation:

```text
hallucheck findings
hallucheck evidence FINDING_ID
hallucheck fix FINDING_ID
hallucheck flag FINDING_ID
hallucheck accept-risk FINDING_ID optional reason
hallucheck settings AUTO_FIX
```

The default is **ASK_BEFORE_FIXING**. **AUTO_FIX** requests only eligible, bounded same-session investigations; **INDICATOR_ONLY** warns without automatic repair. The active agent receives actual evidence, investigates independently, and HALLUCHECK rechecks the result. Accepting risk records ACCEPTED_RISK, never VERIFIED.

Claude packages `/hallucheck:hallucheck`; Codex packages `$hallucheck`. MCP form choices are offered only when the connected client advertises support. Plain chat commands provide the hook fallback. No separate UI is required. See [native workflow and host limitations](docs/NATIVE_INTERACTION.md).

## Quick start

Requires Node >=22.13, pnpm 10, Git and ripgrep on macOS/Linux. Development validation was performed on macOS/Node 25; see limitations for release scope.

```sh
git clone https://github.com/Ajitesh-lab/hallucheck.git
cd hallucheck
pnpm install --frozen-lockfile
pnpm build
npm link
node bin/install-skill.mjs
halluc-check doctor
halluc-check scan --root /absolute/path/to/repository --file src/auth.ts
halluc-check scan --root /absolute/path/to/repository --changed
halluc-check report --root /absolute/path/to/repository --format json
```

The installer adds the standalone skill to `~/.codex/skills/hallucheck` (or `$CODEX_HOME/skills/hallucheck`) and **enables automatic reviews for substantial coding work and extensive answers by default**. It preserves existing user instructions, adds a managed policy block, and refuses to overwrite an existing skill. Short replies and trivial edits are skipped. Start a new local Codex chat and work normally; explicitly invoke `$hallucheck` to force a review of any size. Use `--manual` to install without activation, or manage an existing installation with `halluc-check auto-review enable|status|disable`. See [automatic setup](docs/SETUP.md#automatic-reviews-for-substantial-work), including the prompt to give an installing agent. The skill requires the installed CLI; it is not a standalone ChatGPT app or a guarantee that every sentence is checked. The full plugin is under [Agent installation](#agent-installation).

For a reproducible example that deliberately includes absent symbols and legitimate unusual APIs:

```sh
halluc-check scan --root "$PWD/evals/fixtures/repository"
pnpm eval
```

Initialize configuration in the repository being checked with `halluc-check init`. Start/reuse its persistent warm daemon with `halluc-check daemon start`. `halluc-check daemon stop` stops it. Hooks start the daemon at SessionStart automatically; manual CLI/MCP calls use an existing daemon or the shared engine directly.

Normal prompts instruct the agent to review substantive coding tasks and extensive answers before its final response, while skipping brief replies. Stop hooks compare source changes against the current request's baseline and review extensive prompts/answers; old, already-dirty source does not trigger a review on a small follow-up. Scans are bounded and include untracked files. A review can also run explicitly, regardless of size:

```sh
halluc-check review-task --root /absolute/path/to/project --json <<'JSON'
{"text":"Added the session API.","claims":[{"statement":"src/auth.ts exports createSession.","requiredEvidence":[{"kind":"export","path":"src/auth.ts","name":"createSession"}]}]}
JSON
```

`review-task` accepts JSON on stdin (`text`, optional `claims` and `filePaths`), reviews completion claims and source, and persists its evidence. General prose without independent evidence remains NOT_CHECKED. Checks do not prove every factual statement or full task completion.

## Enable Jev deliberately

Get a direct Jev API key from the official [TypeSafe console](https://console.typesafe.ai), as described in [TypeSafe's quick start](https://docs.typesafe.ai/introduction/quickstart). Then run this yourself in a terminal:

```sh
halluc-check auth login
halluc-check auth status
```

The key prompt is hidden. Setup asks separately whether to enable sending redacted, bounded claim/evidence summaries to TypeSafe; the default is **No**. It makes no API request. The key is stored in `~/.config/hallucheck/jev.env`, outside the repo, with file permissions `600` and directory permissions `700`. This is an owner-only plaintext file, not encrypted storage. Setup refuses symlink targets, shared directories/files, and credential files inside a Git worktree. Do not paste keys into chat, command arguments, screenshots, issues, or project files.

To test the saved key, send one synthetic request (provider charges may apply):

```sh
halluc-check doctor --jev
```

Restart an already-running project daemon after changing keys or privacy settings, and reconnect an existing agent/MCP session:

```sh
halluc-check daemon stop # only if already running
halluc-check daemon start
```

Use `halluc-check auth login` again to rotate the saved key. Use `halluc-check auth logout` to remove saved provider settings; this does not revoke the key at TypeSafe or clear exported shell variables. `auth status` never displays the key and does not test live access. Shell credentials override saved credentials; see [configuration](docs/CONFIGURATION.md) for environment-based setup.

The default direct model is `jev-1.13.0`. Requests contain redacted, bounded claims/evidence summaries, which may include small source-derived excerpts; there is no whole-repository upload. Jev `noul`, `choice`, and `score` responses are validated separately and preserve their native distributions and any reported model version. Outages are explicit. No key is required for objective local evidence, unit tests, evaluations, or mocks. Percentage notes require actual Jev scores.

For a Vercel AI Gateway key (`vck_…`), set `AI_GATEWAY_API_KEY` instead. The client selects Vercel's TypeSafe-compatible endpoint and `typesafe-ai/jev`; direct TypeSafe keys use `JEV_API_KEY` or `TYPESAFE_API_KEY` and `https://api.typesafe.ai/v1/systemone`. Credentials belong to their issuing provider and are not interchangeable. Gateway model access may require paid credits.

Run `halluc-check doctor --jev` to send one tiny synthetic decision and distinguish invalid credentials (`AUTH`), model access restrictions (`ACCESS_DENIED`), billing (`BILLING`), and transport failures. This diagnostic can use provider credits when successful and never sends repository content. GUI hosts can load provider settings from an owner-only `~/.config/hallucheck/jev.env`; see [configuration](docs/CONFIGURATION.md).

Run a real opt-in contract check with `pnpm test:live`. This is separate from the offline test suite and requires a valid key with model access. The client follows [TypeSafe's API contract](https://docs.typesafe.ai/api) and [Vercel's TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).

## Agent installation

After installing the CLI on the host PATH:

```sh
node bin/install-plugin.mjs claude-code /absolute/path/hallucheck-claude
claude --plugin-dir /absolute/path/hallucheck-claude
```

For Codex, this checkout contains a local marketplace:

```sh
codex plugin marketplace add /absolute/path/to/Halluchecker
codex plugin add hallucheck@hallucheck-local
```

Review and trust Codex's hook definitions in `/hooks`. Installation alone does not grant trust. Manual lifecycle-hook plugins are supported; they are not eligible for the public plugin directory. See [integration instructions](docs/INTEGRATIONS.md) for another target repository, MCP configuration, host semantics, hook harnesses, and uninstallation.

## Explicit verification and human review

The original MCP tools are `halluc_check_analyze`, `halluc_check_verify`, `halluc_check_get_findings`, `halluc_check_get_report`, and `halluc_check_get_status`. The native interaction tools are `halluc_check_action`, `halluc_check_complete_repair`, `halluc_check_settings`, and `halluc_check_list_open`. MCP alone does not intercept agent tools. Send exact evidence requirements, for example an `export` named `createSession` in `src/auth.ts`, to verify a narrow assertion. Ambiguous completion prose remains one limited-quality unverified claim.

```sh
halluc-check findings
halluc-check review
halluc-check approve FULL_FINDING_ID
halluc-check reject FULL_FINDING_ID
```

The original advanced security-review CLI remains available. Approval/rejection through that CLI requires a separate interactive local terminal and is attached to the exact finding/source snapshot. It is not a security approval available through MCP, hooks, or daemon RPC and never bypasses mandatory tool authorization. Same-UID hostile processes are outside this identity boundary; see the threat model.

Only exact owner-configured executable/argv checks can run automatically. Arbitrary event commands and model recommendations are never executed. Unknown test skip status and stale results cannot verify current source. The guard never edits project source files.

## Validation and benchmarks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm eval
pnpm exec tsx evals/benchmarks/run.ts evals/fixtures/repository
npm pack
```

The evaluation corpus contains 32 labelled cases across eight requested categories. It checks evidence and safe routing, including legitimate unfamiliar APIs, unavailable test evidence, and unsupported completion. It is not a live model-accuracy benchmark. The test suite exercises real compiler analysis, HTTP mock failures/retries, safety, socket daemon calls, host mappings, packaged CLI and stdio MCP.

See [measured benchmark results](docs/BENCHMARKS.md), [validation record](docs/VALIDATION.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [configuration](docs/CONFIGURATION.md), [threat model](docs/THREAT_MODEL.md), [troubleshooting](docs/TROUBLESHOOTING.md), and [known limitations](docs/LIMITATIONS.md).

This MVP cannot prove full feature completion, semantic migration compatibility, or production readiness. It offers scoped independent evidence plus optional probabilistic routing. Risk thresholds remain provisional until calibrated on representative data.
