# Measured benchmarks

Recorded 2026-10-17T17:22:47.080Z on macOS, Node v25.8.1. These are actual measurements, not targets.

Reproduce from the checkout:

```sh
pnpm build
node bin/halluc-check.mjs benchmark --root "$PWD/evals/fixtures/repository" --json
```

| Path                                | p50 (ms) | p95 (ms) | p99 (ms) |
| ----------------------------------- | -------: | -------: | -------: |
| Warm cached local evidence          |    7.684 |    8.223 |    8.543 |
| Deterministic mock decision path    |   18.451 |   18.768 |   28.995 |
| Repeated native warning suppression |    0.009 |    0.018 |    0.028 |

Local cached throughput: **129.3 events/second**, 100/100 cache hits in a sequential warm run.

The local path checks a file-existence assertion on the small six-file repository fixture. It uses a warm in-process engine, metadata/content-hash caching, and bounded Git queries. It excludes cold process startup, host scheduling/rendering, large-project compiler analysis, and network inference. The native interaction measurement is repeated unchanged-warning suppression with SQLite in memory; it excludes first presentation and evidence inspection. It does not measure user dialog response time.

The mock path uses an explicitly labelled deterministic provider and exercises the decision pipeline. It is **not live Jev latency**. Live Jev p50/p95/p99 and the remote subsecond objective remain unmeasured without an API key and explicit inference opt-in.

Full stage timings, timestamps and disclosures are in [benchmark-results.json](benchmark-results.json). Numbers will vary by repository, hardware, OS cache and load.
