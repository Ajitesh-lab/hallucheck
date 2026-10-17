# HALLUCHECK implementation plan

Build a small end-to-end verifier, preserving the distinction between objective evidence and model predictions.

1. **Functional core:** strict TypeScript workspace; validated events and explicit claims; safe repository context; compiler API evidence; SQLite findings; runnable CLI and fixture scan. Check with Vitest and TypeScript.
2. **Jev intelligence:** implement the documented noul/choice/score contracts, batched questions, bounded retries/concurrency/cache, explicit external-inference opt-in, and evidence-aware policy. Test with deterministic HTTP mocks; live requests only by opt-in.
3. **Integrations:** separate Claude/Codex adapters, hook JSON harness, installable local plugin packages, official SDK MCP tools sharing the engine. Check host contracts and actual MCP transport.
4. **Reliability/performance:** warm Unix-socket daemon, bounded cancelable queue, content-based invalidation, redaction and execution controls, at least 30 labelled fixture cases, measured benchmarks.
5. **Packaging:** distributable CLI bundle, reproducible install/uninstall scripts, architecture/configuration/threat-model/limitations documentation, final test/typecheck/build/evaluation/benchmark run.

## Environment and verified contracts

2026-10-17: empty repository; Node v25.8.1, pnpm 10.32.1, ripgrep 15.2.0, Codex CLI 0.154.0, Claude Code 2.1.273. Target Node >=22.13 (native SQLite).

Official sources consulted before implementation:

- https://jev-ai.org/docs/decisions/ and https://jev-ai.org/docs/question-types/ — up to 20 questions, separate typed answers, score is decimal, probability distributions and model_version preserved.
- https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/plugins-reference — PreToolUse supports ask; Stop loop guard; standard plugin layout.
- https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks) — PreToolUse ask is unsupported, deny supported; hooks require explicit user trust; async PostToolUse is informational.
- https://developers.openai.com/plugins/build/plugins — root portable manifest and com.openai extension; manual lifecycle-hook plugins supported, public-directory lifecycle hooks ineligible.
- https://modelcontextprotocol.io/docs/develop/build-server — official TypeScript SDK stdio server.

## Deliberate MVP boundaries

No natural-language assertion invention, arbitrary shell-command verification, external documentation search, automatic source edits, or model-based factual verification. Ambiguous free text stays one limited-quality unsupported claim. Human review is a local interactive terminal workflow; it is not exposed over MCP or daemon. Same-user hostile processes remain outside that identity boundary and are documented. Shell destructive-action detection is conservative authorization policy, never a hallucination classifier.

## Additional native interaction requirement (2026-10-17)

Extend the current engine rather than create a UI. Add durable finding lifecycle and mode preferences, a shared interaction service, native hook warnings and explicit user commands, capability-negotiated MCP form choices, evidence-bearing same-session repair instructions, bounded repair attempts, and independent post-repair verification. Acceptance tests use real hook JSON and SDK elicitation transport. No arbitrary host button or idle-turn resume API is assumed. Claude async hook output is model context rather than a directly visible notification; synchronous Stop/UserPromptSubmit feedback and native skills provide the reliable user-visible path.
