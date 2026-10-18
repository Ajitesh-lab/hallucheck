import { it, expect } from "vitest";
import { JevClient } from "../packages/jev-provider/src/index.js";
import { loadJevEnvironment } from "../packages/jev-provider/src/environment.js";
it.skipIf(process.env.HALLUCHECK_LIVE_JEV !== "1")(
  "opt-in live Jev contract",
  async () => {
    await loadJevEnvironment();
    const apiKey =
      process.env.JEV_API_KEY ??
      process.env.TYPESAFE_API_KEY ??
      process.env.AI_GATEWAY_API_KEY;
    if (!apiKey)
      throw new Error("Set a Jev or AI Gateway API key to run live test");
    const response = await new JevClient({
      apiKey,
      baseUrl: process.env.JEV_BASE_URL,
      allowExternalInference: true,
      timeoutMs: 10000,
    }).decide({
      model: process.env.JEV_MODEL ?? "jev-1.13.0",
      state: "A local file was independently observed to exist.",
      questions: {
        supported: {
          type: "noul",
          instructions:
            "Does independent observation support the file existence assertion?",
        },
      },
    });
    expect(response.answers.supported?.type).toBe("noul");
    expect(response.model_version).not.toContain("mock");
  },
  15000,
);
