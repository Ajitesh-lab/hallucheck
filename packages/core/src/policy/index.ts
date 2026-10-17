import {
  type Config,
  type Decision,
  type EvidenceStatus,
  type Prediction,
} from "../../../shared/src/index.js";
export const POLICY_VERSION = "0.1-provisional";
export function route(
  input: {
    status: EvidenceStatus;
    prediction?: Prediction;
    providerStatus: string;
    canVerify: boolean;
    mandatoryAuthorization: boolean;
    reversible: boolean;
  },
  config: Config,
): Decision {
  const p = input.prediction;
  const cost = p ? p.incorrectRisk * (1 + p.impact) ** 2 : null;
  const result = (action: Decision["action"], reason: string): Decision => ({
    action,
    reasons: [
      reason,
      ...(input.providerStatus === "available"
        ? []
        : [
            `Model predictions ${input.providerStatus}; no model-based clean bill of health.`,
          ]),
    ],
    expectedErrorCost: cost,
    policyVersion: POLICY_VERSION,
  });
  if (input.mandatoryAuthorization)
    return result(
      "HUMAN_REVIEW",
      "Mandatory authorization takes precedence over model predictions.",
    );
  if (input.status === "CONTRADICTED")
    return result(
      "AGENT_REPAIR",
      "Reliable independent evidence contradicts this exact assertion; inspect cited evidence and repair or correct the claim.",
    );
  if (input.status === "VERIFIED")
    return result(
      "CONTINUE",
      "Independent evidence directly supports the scoped assertion.",
    );
  if (
    input.canVerify &&
    (!p ||
      cost! >= config.review.verificationCost ||
      p.recommendedAction === "verify")
  )
    return result(
      "AUTO_VERIFY",
      "Missing evidence can be gathered with a configured safe check.",
    );
  if (
    p &&
    ((p.incorrectRisk >= config.review.riskThreshold && p.impact >= 3) ||
      (cost! >= config.review.humanCost && !input.reversible))
  )
    return result(
      config.review.humanReviewEnabled ? "HUMAN_REVIEW" : "CONTINUE",
      "High-consequence unresolved uncertainty; review is " +
        (config.review.humanReviewEnabled
          ? "required."
          : "disabled in local policy."),
    );
  return result(
    "CONTINUE",
    "Assertion remains unsupported; absence of evidence is not proof of hallucination.",
  );
}
/** Conservative authorization guard, not a hallucination classifier or complete shell sandbox. */
export function requiresAuthorization(
  toolName: string | undefined,
  input: unknown,
): boolean {
  if (["Delete", "delete_file", "remove_directory"].includes(toolName ?? ""))
    return true;
  if (!input || typeof input !== "object") return false;
  const data = input as Record<string, unknown>;
  const command =
    typeof data.command === "string"
      ? data.command
      : typeof data.cmd === "string"
        ? data.cmd
        : "";
  const tokens = command
    .split(/[\s;&|()]+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ""));
  return (
    tokens.some((t) =>
      ["rm", "rmdir", "dd", "mkfs", "shred"].includes(t.split("/").pop() ?? ""),
    ) ||
    (tokens.includes("git") &&
      ((tokens.includes("reset") && tokens.includes("--hard")) ||
        (tokens.includes("clean") &&
          tokens.some((t) => t.startsWith("-") && t.includes("f"))) ||
        (tokens.includes("push") &&
          tokens.some((t) => t === "--force" || t === "-f"))))
  );
}
