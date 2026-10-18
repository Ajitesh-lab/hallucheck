# Configuration

For guided setup, use `halluc-check auth login` in your own terminal. It hides key entry, asks for inference consent (default No), and saves a direct TypeSafe key outside Git with private file/directory permissions. `auth status` reports saved settings without printing secrets; `auth logout` removes them. See [setup, storage details and rotation](SETUP.md). Never pass keys as command arguments or paste them into a chat. Saved keys are owner-only plaintext, not encrypted.

Run `halluc-check init` in the target repository. The generated `hallucheck.config.json` is the complete Zod-validated configuration with defaults. Unknown fields are ignored; invalid field types fail closed with an error. Secrets belong in environment variables, never this file. Review repository configuration before enabling external inference or command execution.

| Setting                         | Default                                              | Meaning                                                                                       |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| interaction.mode                | ASK_BEFORE_FIXING                                    | ASK_BEFORE_FIXING, AUTO_FIX, or INDICATOR_ONLY; native preference overrides persist in SQLite |
| interaction.maxRepairAttempts   | 2                                                    | Maximum attempts per claim lineage since last independently verified resolution               |
| interaction.repairTimeoutMs     | 300000                                               | Abandoned-repair expiry, checked lazily on interaction/event                                  |
| enabled                         | true                                                 | Analyze events; false returns an explicit disabled result                                     |
| provider                        | jev                                                  | `jev` or explicit `offline`                                                                   |
| model                           | jev-1.13.0                                           | Requested model; provider-reported version retained when available                            |
| privacy.allowExternalInference  | false                                                | Required before any Jev inference                                                             |
| privacy.redactSecrets           | true                                                 | Cannot be disabled                                                                            |
| privacy.exclusions              | .env, .env._, \*\*/_.pem, **/\*.key, **/secrets/\*\* | Glob paths excluded from project context                                                      |
| privacy.maxContextBytes         | 12000                                                | Maximum outbound request bytes, including questions                                           |
| verification.runTypecheck       | true                                                 | Gather compiler diagnostics                                                                   |
| verification.runTargetedTests   | true                                                 | Permit configured targeted checks when command execution is opted in                          |
| verification.allowAutoCommands  | false                                                | Separate explicit command execution opt-in                                                    |
| verification.commands           | {}                                                   | Named executable/argv allowlist                                                               |
| review.humanReviewEnabled       | true                                                 | Queue high-consequence unresolved claims                                                      |
| review.blockDestructiveActions  | true                                                 | Apply conservative mandatory authorization rules                                              |
| review.riskThreshold            | 0.7                                                  | Provisional model-risk threshold                                                              |
| review.humanCost                | 2                                                    | Provisional interruption cost units                                                           |
| review.verificationCost         | 0.05                                                 | Provisional safe-check cost units                                                             |
| performance.cacheEnabled        | true                                                 | Enable final finding cache; bounded compiler/context caches remain active                     |
| performance.asyncVerification   | true                                                 | Integration scheduling preference; shipped PostToolUse hooks run asynchronously               |
| performance.maxConcurrentChecks | 4                                                    | Check/provider/daemon queue concurrency bound                                                 |
| performance.maxQueue            | 64                                                   | Pending verification/job bound                                                                |
| performance.cacheEntries        | 256                                                  | Finding cache capacity                                                                        |

Built-in exclusions also cover `.git`, `node_modules`, `.hallucheck`, and `dist` for source snapshots. TypeScript may read local dependency definitions under node_modules through its separate safe host. Globs use Node's path matcher. Source snapshots use at most 5000 files, 5000 directories, and 1 MB per file. Exceeding discovery limits prevents test verification from claiming a complete snapshot. Manual scan analyzes at most 64 source roots and emits at most 128 scoped assertions.

Environment overrides:

- `JEV_API_KEY` or `TYPESAFE_API_KEY`: direct TypeSafe credential. `JEV_API_KEY` takes precedence.
- `AI_GATEWAY_API_KEY`: Vercel AI Gateway credential; used when neither direct credential is set. A `vck_` credential in `JEV_API_KEY` also selects Gateway automatically.
- `JEV_MODEL`: overrides requested model.
- `JEV_BASE_URL`: API base override, HTTPS required except loopback. Path prefixes are preserved: `https://ai-gateway.vercel.sh/typesafe` becomes `/typesafe/v1/systemone`. Default: `https://api.typesafe.ai`, or `https://ai-gateway.vercel.sh/typesafe` for a `vck_` key.
- `JEV_TIMEOUT_MS`: total HTTP budget including bounded retries; default 3000 ms.
- `HALLUCHECK_EXTERNAL_INFERENCE=1`: enables minimized external inference; `0` disables it.
- `HALLUCHECK_OFFLINE=1`: forces offline objective evidence.

Restart the daemon after changing the project configuration or environment. Native mode preferences are stored separately and apply immediately. Its environment is inherited at startup. A key alone does not enable external inference.

GUI processes can read `~/.config/hallucheck/jev.env` automatically, or an absolute file selected by `HALLUCHECK_PROVIDER_ENV_FILE`. The file must be owned by the current user, have mode `600`, and be a regular file rather than a symlink. Only the provider variables above are loaded; shell values win. If a credential is already supplied by the shell, saved credentials, route and model settings are ignored. Repository `.env` files are never loaded automatically.

Example private environment file (replace the placeholder locally):

```dotenv
AI_GATEWAY_API_KEY=your-vercel-gateway-key
HALLUCHECK_EXTERNAL_INFERENCE=1
JEV_TIMEOUT_MS=10000
```

`halluc-check doctor --jev` performs one synthetic decision without repository content. A successful diagnostic may spend provider credits. `AUTH` means invalid credentials; `ACCESS_DENIED` means model access was refused (including Vercel free-tier restrictions); `BILLING` means credits are required. Authentication and access failures are not retried. An ordinary status/doctor reports configuration availability without making a live request.

Native TypeSafe responses do not require `id`, `model_version`, or `latency_ms`. HALLUCHECK retains a server request ID when present, otherwise labels a locally generated correlation ID with `local-`; it measures latency locally when absent. A resolved versioned model ID is retained as the model version, while an alias without a provider-reported version is marked `not-reported`.

Example owner-configured check (merge into the generated configuration):

```json
{
  "verification": {
    "allowAutoCommands": true,
    "commands": {
      "auth": {
        "executable": "pnpm",
        "args": ["exec", "vitest", "run", "src/auth.test.ts"],
        "timeoutMs": 10000,
        "provesNoSkippedTests": false
      }
    }
  }
}
```

A zero exit status alone will stay UNSUPPORTED for a no-skips assertion unless the owner supplies a command with an explicit no-skips guarantee. Commands execute repository code and therefore require the same trust as running tests yourself.
