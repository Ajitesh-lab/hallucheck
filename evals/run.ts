import { readFile, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Engine } from "../packages/core/src/index.js";
import {
  ClaimInputSchema,
  Status,
  ConfigSchema,
} from "../packages/shared/src/index.js";
const base = path.dirname(fileURLToPath(import.meta.url));
const CaseSchema = z.object({
  id: z.string(),
  category: z.string(),
  repositoryFixture: z.string(),
  claim: ClaimInputSchema,
  expectedEvidenceStatus: Status,
  safeRouting: z.object({
    allowedActions: z.array(z.string()),
    forbidVerified: z.boolean(),
  }),
  groundTruth: z.enum(["HALLUCINATED", "CORRECT", "UNDETERMINED"]),
  explanation: z.string(),
});
const cases = z
  .array(CaseSchema)
  .min(30)
  .parse(
    JSON.parse(
      await readFile(path.join(base, "labelled-cases/cases.json"), "utf8"),
    ),
  );
const root = await mkdtemp(path.join(tmpdir(), "hc-eval-"));
await cp(path.join(base, "fixtures/repository"), root, { recursive: true });
const live = process.env.HALLUCHECK_LIVE_EVAL === "1";
if (
  live &&
  (!process.env.JEV_API_KEY ||
    process.env.HALLUCHECK_EXTERNAL_INFERENCE !== "1")
)
  throw new Error(
    "Live eval requires JEV_API_KEY and HALLUCHECK_EXTERNAL_INFERENCE=1",
  );
const engine = await Engine.open(root, {
  memory: true,
  config: ConfigSchema.parse({
    provider: live ? "jev" : "offline",
    privacy: { allowExternalInference: live },
  }),
});
const results = [];
try {
  for (const item of cases) {
    const result = await engine.analyze({
      repositoryRoot: root,
      eventType: "AGENT_CLAIM",
      claims: [item.claim],
    });
    const finding = result.findings[0]!;
    results.push({
      id: item.id,
      category: item.category,
      truth: item.groundTruth,
      status: finding.status,
      action: finding.decision.action,
      risk: finding.prediction?.incorrectRisk ?? null,
      provider: finding.prediction?.provider ?? "offline",
      pass:
        finding.status === item.expectedEvidenceStatus &&
        item.safeRouting.allowedActions.includes(finding.decision.action) &&
        (!item.safeRouting.forbidVerified || finding.status !== "VERIFIED"),
    });
  }
  const tp = results.filter(
      (r) => r.status === "CONTRADICTED" && r.truth === "HALLUCINATED",
    ).length,
    fp = results.filter(
      (r) => r.status === "CONTRADICTED" && r.truth === "CORRECT",
    ).length,
    positives = results.filter((r) => r.truth === "HALLUCINATED").length,
    negatives = results.filter((r) => r.truth === "CORRECT").length;
  const predicted = results.filter(
    (r) => r.risk !== null && r.truth !== "UNDETERMINED",
  );
  const output = {
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass),
    scope:
      "Evidence and policy fixture evaluation; not live model performance.",
    evidenceClassifier: {
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: positives ? tp / positives : null,
      falsePositiveRate: negatives ? fp / negatives : null,
      abstentionRate:
        results.filter(
          (r) => r.status === "UNSUPPORTED" || r.status === "NOT_CHECKED",
        ).length / results.length,
    },
    humanReviewRate:
      results.filter((r) => r.action === "HUMAN_REVIEW").length /
      results.length,
    calibration: {
      count: predicted.length,
      brier: predicted.length
        ? predicted.reduce(
            (sum, r) =>
              sum + (r.risk! - (r.truth === "HALLUCINATED" ? 1 : 0)) ** 2,
            0,
          ) / predicted.length
        : null,
    },
    results,
  };
  console.log(JSON.stringify(output, null, 2));
  if (output.failed.length) process.exitCode = 1;
} finally {
  engine.close();
  await rm(root, { recursive: true, force: true });
}
