import { it, expect } from "vitest";
import { JevClient } from "../packages/jev-provider/src/index.js";
it.skipIf(process.env.HALLUCHECK_LIVE_JEV !== "1")(
  "opt-in live Jev contract",
  async () => {
    if (!process.env.JEV_API_KEY)
      throw new Error("Set JEV_API_KEY to run live test");
    const response = await new JevClient({
      apiKey: process.env.JEV_API_KEY,
      allowExternalInference: true,
      timeoutMs: 10000,
    }).decide({
      model: process.env.JEV_MODEL ?? "jev-1.13",
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
