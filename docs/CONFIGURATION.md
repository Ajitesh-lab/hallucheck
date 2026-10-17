# Configuration

Run `halluc-check init` in the target repository. The generated `hallucheck.config.json` is the complete Zod-validated configuration with defaults. Unknown fields are ignored; invalid field types fail closed with an error. Secrets belong in environment variables, never this file. Review repository configuration before enabling external inference or command execution.

| Setting                         | Default                                              | Meaning                                                                                       |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| interaction.mode                | ASK_BEFORE_FIXING                                    | ASK_BEFORE_FIXING, AUTO_FIX, or INDICATOR_ONLY; native preference overrides persist in SQLite |
| interaction.maxRepairAttempts   | 2                                                    | Maximum attempts per claim lineage since last independently verified resolution               |
| interaction.repairTimeoutMs     | 300000                                               | Abandoned-repair expiry, checked lazily on interaction/event                                  |
| enabled                         | true                                                 | Analyze events; false returns an explicit disabled result                                     |
| provider                        | jev                                                  | `jev` or explicit `offline`                                                                   |
| model                           | jev-1.13                                             | Requested model, actual model_version retained                                                |
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

- `JEV_API_KEY`: required credential for live Jev requests.
- `JEV_MODEL`: overrides requested model.
- `JEV_BASE_URL`: origin override, HTTPS required except loopback; endpoint remains `/api/v1/systemone/`.
- `JEV_TIMEOUT_MS`: total HTTP budget including bounded retries; default 3000 ms.
- `HALLUCHECK_EXTERNAL_INFERENCE=1`: enables minimized external inference; `0` disables it.
- `HALLUCHECK_OFFLINE=1`: forces offline objective evidence.

Restart the daemon after changing the project configuration or environment. Native mode preferences are stored separately and apply immediately. Its environment is inherited at startup. A key alone does not enable external inference.

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
