import { performance } from "node:perf_hooks";
import { ConfigSchema, type Metrics } from "../../packages/shared/src/index.js";
import { Engine } from "../../packages/core/src/index.js";
import { MockProvider } from "../../packages/jev-provider/src/index.js";
import { mockResponse } from "../../packages/jev-provider/src/testing.js";
import { FindingInteractionService } from "../../packages/core/src/interactions/index.js";
import { NativeConversationAdapter } from "../../packages/core/src/interactions/hosts.js";
export function summarize(values: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    [50, 95, 99].map((p) => [
      `p${p}`,
      sorted[
        Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
      ] ?? 0,
    ]),
  ) as { p50: number; p95: number; p99: number };
}
export async function benchmark(
  root: string,
  iterations = 100,
): Promise<unknown> {
  const engine = await Engine.open(root, {
    memory: true,
    config: ConfigSchema.parse({
      provider: "offline",
      interaction: { mode: "INDICATOR_ONLY" },
    }),
  });
  const event = {
    eventType: "AGENT_CLAIM",
    repositoryRoot: root,
    claims: [
      {
        statement: "package.json exists.",
        requiredEvidence: [{ kind: "file", path: "package.json" }],
      },
    ],
  };
  try {
    await engine.analyze(event);
    const measurements: Metrics[] = [];
    const start = performance.now();
    for (let i = 0; i < iterations; i++)
      measurements.push((await engine.analyze(event)).metrics);
    const elapsed = performance.now() - start;
    const mock = await Engine.open(root, {
      memory: true,
      provider: new MockProvider(mockResponse),
    });
    const mockTimes = [];
    try {
      for (let i = 0; i < 20; i++) {
        const r = await mock.analyze({
          ...event,
          claims: [
            {
              statement: `package.json exists (fixture ${i}).`,
              requiredEvidence: [{ kind: "file", path: "package.json" }],
            },
          ],
        });
        mockTimes.push(r.metrics.total_latency_ms);
      }
    } finally {
      mock.close();
    }
    const interaction = new FindingInteractionService(engine);
    const adapter = new NativeConversationAdapter("codex");
    const finding = (
      await engine.analyze({
        ...event,
        claims: [
          {
            statement: "The benchmark missing-file fixture exists.",
            requiredEvidence: [
              {
                kind: "file",
                path: "hallucheck-benchmark-intentionally-missing.ts",
              },
            ],
          },
        ],
      })
    ).findings[0]!;
    await interaction.present([finding], adapter, "benchmark");
    const interactionTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const started = performance.now();
      await interaction.present([finding], adapter, "benchmark");
      interactionTimes.push(performance.now() - started);
    }
    return {
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      iterations,
      localCached: {
        latencyMs: summarize(measurements.map((m) => m.total_latency_ms)),
        throughputPerSecond: iterations / (elapsed / 1000),
        cacheHits: measurements.filter((m) => m.cache_hit).length,
        stages: Object.fromEntries(
          [
            "event_normalisation_ms",
            "context_retrieval_ms",
            "evidence_collection_ms",
            "jev_request_ms",
            "policy_evaluation_ms",
          ].map((key) => [
            key,
            summarize(
              measurements.map((m) => m[key as keyof typeof m] as number),
            ),
          ]),
        ),
      },
      mockDecisionPath: {
        latencyMs: summarize(mockTimes),
        disclosure:
          "Deterministic mock fixture. No live network or Jev latency measured.",
      },
      nativeInteraction: {
        latencyMs: summarize(interactionTimes),
        disclosure:
          "Warm unchanged-warning suppression through SQLite in memory; excludes host rendering and initial evidence inspection. No separate UI.",
      },
      remoteModelPath: {
        measured: false,
        reason:
          "Live Jev latency requires explicit external inference opt-in and JEV_API_KEY.",
      },
      scope:
        "Warm in-process engine, bounded repository metadata/content snapshots, one file-existence assertion. Not cold CLI startup or large-project compiler throughput.",
    };
  } finally {
    engine.close();
  }
}
