import { type JevRequest, type JevResponse } from "./index.js";
/** Explicit deterministic test fixture. Never substituted for live Jev. */
export function mockResponse(
  request: JevRequest,
  options: {
    risk?: number;
    unsupported?: number;
    impact?: number;
    action?: string;
  } = {},
): JevResponse {
  const answers: JevResponse["answers"] = {};
  for (const [key, q] of Object.entries(request.questions)) {
    if (q.type === "noul")
      answers[key] = {
        type: "noul",
        noul: key.endsWith("incorrect")
          ? (options.risk ?? 0.2)
          : (options.unsupported ?? 0.8),
      };
    else if (q.type === "choice") {
      const choice = options.action ?? Object.keys(q.criteria)[0]!;
      answers[key] = {
        type: "choice",
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(q.criteria).map((k) => [k, k === choice ? 1 : 0]),
        ),
      };
    } else {
      const impact = options.impact ?? 2;
      answers[key] = {
        type: "score",
        score: impact,
        confidence: 1,
        legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
        probabilities: Object.fromEntries(
          q.criteria.map((_, i) => [String(i), i === impact ? 1 : 0]),
        ),
      };
    }
  }
  return {
    id: "mock-request",
    model: request.model,
    model_version: "mock-fixture-v1",
    answers,
    latency_ms: 0,
  };
}
