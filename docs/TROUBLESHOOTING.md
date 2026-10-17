# Troubleshooting

- **Jev disabled:** defaults are private. Enable `privacy.allowExternalInference` or `HALLUCHECK_EXTERNAL_INFERENCE=1`, then restart the daemon. A key alone does not enable transmission.
- **NO_API_KEY / AUTH:** set `JEV_API_KEY` in the process starting the daemon. Never paste credentials into repository config or hook JSON. AUTH is not retried.
- **TIMEOUT / RATE_LIMIT / NETWORK:** findings retain objective evidence and explicitly disclose provider unavailability. Rate-limit Retry-After is bounded by the request deadline. No model clean bill of health is produced.
- **CONTEXT_LIMIT:** outbound statements/evidence plus fixed question instructions exceed the configured cap. Use fewer/smaller explicit claims or increase the bounded cap. Files are never uploaded wholesale.
- **Missing dependency / type information:** install the target repository's dependencies and check tsconfig. A module-resolution contradiction is scoped to the current local environment, not proof a package does not exist on a registry.
- **Test exit zero but UNSUPPORTED:** skip status may be unknown, or evidence may be stale, canceled, host-supplied, or outside complete discovery limits. Use an owner-reviewed wrapper with an actual no-skips guarantee before setting `provesNoSkippedTests`.
- **Daemon startup fails:** `halluc-check doctor`; inspect `.hallucheck/daemon.log`; ensure the repository path is short enough for a Unix socket. Do not share this directory across OS accounts. A live daemon will not be overwritten. A stale socket is removed only after a failed connection.
- **Configuration seems ignored:** `halluc-check daemon stop`, then `halluc-check daemon start` with the intended environment.
- **Host cannot find command:** add the installed CLI directory to the host's PATH or use an absolute executable path in both hook and MCP manifests. GUI PATH can differ from terminal PATH.
- **Codex hooks skipped:** trust the project and inspect `/hooks` to review the exact installed hook hash. Plugin installation is separate from hook trust. No trust bypass is performed by HALLUCHECK.
- **Approval refused:** run approve/reject from your own separate local interactive terminal. Findings must belong to the current repository snapshot. A human review records assessment, not permission to bypass the host or HALLUCHECK tool guard.
- **Native SQLite warning:** some Node versions print an experimental-feature warning to stderr. Protocol output remains clean JSON on stdout.
- **Source unchanged but finding reruns:** configuration, relevant dependency metadata, execution records, policy/model version, or TTL can invalidate caches. This is intentional.

Reproduce without credentials: `pnpm check`, `pnpm benchmark -- evals/fixtures/repository` (or `pnpm exec tsx evals/benchmarks/run.ts evals/fixtures/repository`). Tests never require a live key. `pnpm test:live` explicitly requires one and transmits a tiny synthetic assertion.
