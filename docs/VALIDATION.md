# Validation record

Validated 2026-10-17. All work extends the original repository and shared engine; no separate UI or coding session was introduced.

| Check               | Actual result                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript   | pnpm typecheck passed                                                                                                                               |
| Vitest              | 62 passed, 0 failed, 1 opt-in live test skipped                                                                                                     |
| Bundled runtime     | CLI, daemon and MCP bundles built with esbuild                                                                                                      |
| Labelled evaluation | 32/32 cases met evidence and routing expectations                                                                                                   |
| Claude plugin       | Installed Claude Code 2.1.273 validator accepted the current manifest                                                                               |
| Codex plugin        | Codex CLI 0.154.0 installed the updated local marketplace plugin into isolated .hallucheck/codex-install-test; no user-global host settings changed |
| Plugin skills       | Both SKILL.md files passed the bundled skill-creator quick validator via uv with PyYAML                                                             |
| Node minimum        | Actual Node 22.13.1 fixture scan and native UserPromptSubmit settings hook passed                                                                   |
| Packaging           | npm tarball created; clean-prefix dependency installation and runtime scan tested; final artifact is rebuilt after documentation                    |

## Original milestones

1. Functional core: real CLI scan, Zod schemas, canonical event normalization, TypeScript compiler API, safe source selection, scoped evidence and SQLite findings. Real fixture scans include verified legitimate imports and contradicted fabricated APIs/diagnostics.
2. Jev intelligence: documented noul/choice/score contract, request/response validation, Unicode streaming, timeouts, bounded retries, rate-limit scheduling, batching, in-flight dedup, caching and explicit offline mode. HTTP mock tests exercise auth, malformed responses, network failure, deadlines, rate limits and cache behavior. No live inference was claimed.
3. Agent integrations: installed-format manifests, native hook payloads and mappings, actual Unix-socket ingestion, official SDK in-memory MCP transport and packaged stdio MCP JSON-RPC. Host trust is left to the developer.
4. Reliability/performance: bounded jobs and cancellation, metadata/content invalidation including new files/dependency definitions, stale test protection, command allowlists/deadlines/output bounds, redaction and traversal/symlink tests. Reproducible measured latency is recorded separately.
5. Packaging/docs: install/uninstall scripts, runtime bundles and tarball, architecture, configuration, threat model, troubleshooting, benchmark report, limitations and native workflow guide.

## Native interaction acceptance paths

Tests run actual Claude/Codex-shaped JSON through the shared hook handler and packaged CLI. They exercise default warning-only behavior, exact native user commands, same-session evidence-bearing repair instructions, independent post-edit verification, indicator-only behavior and persistent flags/settings. MCP tests initialize real SDK client/server transports, negotiate form elicitation, select Fix with AI / Accept Risk, cancel choices, and verify unsupported-capability fallbacks. The source modification during repair is performed by the test harness, representing the active agent; a live logged-in agent was not prompted to rewrite a project during this validation.

Shared interaction tests additionally cover a false positive with valid unchanged source, claimed success without actual correction, automatic low-impact eligibility with an explicitly mocked Jev provider, bounded repeated failures across snapshots, cancellation/abandonment, durable duplicate suppression, and accepted risk retaining mandatory destructive-operation review. The service never marks an issue resolved solely from an agent summary.

## Evaluation interpretation

The corpus contains 32 small synthetic labelled cases across the eight requested categories. Evidence-classifier fixture precision is 1.00, recall 0.80, and false-positive rate 0.00. These are deterministic fixture results, **not production detection estimates or live Jev performance**. Missing test execution intentionally remains unsupported, even in labelled false-test cases. Model calibration has 0 observations and no computed Brier score. The harness can compute calibration when separately enabled for live evaluation.

## Deliberately untested or limited

No live Jev credential/request, live model latency, authenticated human dialog in an actual interactive logged-in host, Linux runtime run, large-monorepo benchmark, cryptographic human identity, complete shell sandbox, arbitrary idle-session wakeup, or in-process Claude mod was asserted. Claude async hook context requires agent relay; synchronous Stop/UserPromptSubmit are the supported visible fallback. Codex form support is negotiated, not assumed. See [native limitations](NATIVE_INTERACTION.md) and [general limitations](LIMITATIONS.md).
