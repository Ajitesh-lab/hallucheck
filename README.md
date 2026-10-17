# HALLUCHECK

Evidence-grounded verification for AI coding agents. A local TypeScript/JavaScript verifier, optional Jev decision provider, persistent Unix-socket daemon, Claude Code and Codex hook plugins, and nine explicit MCP tools share one engine.

The system separates **VERIFIED**, **CONTRADICTED**, **UNSUPPORTED**, and **NOT_CHECKED**. Model predictions never verify facts. Missing test evidence is uncertainty, not a failed test. Source stays local by default; external inference and command execution require separate explicit opt-ins.

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
pnpm check
npm link
halluc-check doctor
halluc-check scan --root /absolute/path/to/repository --file src/auth.ts
halluc-check scan --root /absolute/path/to/repository --changed
halluc-check report --root /absolute/path/to/repository --format json
```

For a reproducible example that deliberately includes absent symbols and legitimate unusual APIs:

```sh
halluc-check scan --root "$PWD/evals/fixtures/repository"
pnpm eval
```

Initialize configuration in the repository being checked with `halluc-check init`. Start/reuse its persistent warm daemon with `halluc-check daemon start`. `halluc-check daemon stop` stops it. Hooks start the daemon at SessionStart automatically; manual CLI/MCP calls use an existing daemon or the shared engine directly.

## Enable Jev deliberately

```sh
export JEV_API_KEY='your-key-from-Jev'
export HALLUCHECK_EXTERNAL_INFERENCE=1
halluc-check daemon start
```

Restart an existing daemon to change environment or configuration. The default model is `jev-1.13`. Requests contain only redacted, bounded claims/evidence summaries; no repository upload occurs. Jev `noul`, `choice`, and `score` responses are validated separately and preserve their native distributions and model build. Outages are explicit. No key is required for objective local evidence, unit tests, evaluations, or mocks.

Run a real opt-in contract check with `pnpm test:live`. This is separate from the offline test suite and requires a valid key. The client follows the [official decision contract](https://jev-ai.org/docs/decisions/) and [typed question contract](https://jev-ai.org/docs/question-types/).

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
