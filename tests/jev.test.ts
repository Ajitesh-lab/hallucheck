import { describe, it, expect, vi } from "vitest";
import {
  JevClient,
  MockProvider,
  questions,
  validateResponse,
  RequestSchema,
  type JevRequest,
} from "../packages/jev-provider/src/index.js";
import { mockResponse } from "../packages/jev-provider/src/testing.js";
const request: JevRequest = {
  model: "jev-1.13",
  state: { claim: "All tests pass", evidence: [] },
  questions,
};
const ok = () =>
  new Response(JSON.stringify(mockResponse(request)), { status: 200 });
const client = (fetcher: typeof fetch, extra: Record<string, unknown> = {}) =>
  new JevClient({
    apiKey: "test-only-key",
    allowExternalInference: true,
    fetch: fetcher,
    timeoutMs: 500,
    retries: 1,
    ...extra,
  });
describe("Jev typed client", () => {
  it("validates all answer types and preserves decimal scores, distributions and versions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ok());
    const response = await client(fetcher).decide(request);
    expect(response.model_version).toBe("mock-fixture-v1");
    const decimal = mockResponse(request);
    decimal.answers.impact = {
      type: "score",
      score: 1.89,
      legend: {
        0: "Negligible",
        1: "Minor",
        2: "Moderate",
        3: "High",
        4: "Critical",
      },
      probabilities: { 0: 0, 1: 0.11, 2: 0.89, 3: 0, 4: 0 },
      confidence: 0.89,
    };
    expect(validateResponse(decimal, request).answers.impact).toMatchObject({
      score: 1.89,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      JSON.parse(fetcher.mock.calls[0]![1]!.body as string).questions,
    ).toEqual(questions);
  });
  it("caches and deduplicates identical batched requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ok());
    const c = client(fetcher);
    await Promise.all([c.decide(request), c.decide(request)]);
    await c.decide(request);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("fails explicitly without credentials or privacy opt-in", async () => {
    await expect(
      new JevClient({ allowExternalInference: true }).decide(request),
    ).rejects.toMatchObject({ code: "NO_API_KEY" });
    await expect(
      new JevClient({ apiKey: "x", allowExternalInference: false }).decide(
        request,
      ),
    ).rejects.toMatchObject({ code: "DISABLED" });
  });
  it("rejects malformed provider responses and mismatched question types", async () => {
    await expect(
      client(vi.fn().mockResolvedValue(new Response("{}"))).decide(request),
    ).rejects.toMatchObject({ code: "MALFORMED" });
    const response = mockResponse(request);
    response.answers.unsupported = {
      type: "choice",
      choice: "a",
      probabilities: { a: 1 },
      confidence: 1,
    };
    expect(() => validateResponse(response, request)).toThrow();
    expect(() =>
      RequestSchema.parse({
        ...request,
        questions: {
          bad: { type: "choice", instructions: "x", criteria: ["a", "b"] },
        },
      }),
    ).toThrow();
  });
  it("does not retry authentication errors", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(client(f).decide(request)).rejects.toMatchObject({
      code: "AUTH",
    });
    expect(f).toHaveBeenCalledOnce();
  });
  it("honors bounded rate-limit retries", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "0.01" } }),
      )
      .mockImplementation(async () => ok());
    await client(f).decide(request);
    expect(f).toHaveBeenCalledTimes(2);
    const failing = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response("", { status: 429, headers: { "Retry-After": "0.01" } }),
      );
    await expect(client(failing).decide(request)).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });
  it("retries transient server and network failures within its budget", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 503, headers: { "Retry-After": "0" } }),
      )
      .mockImplementation(async () => ok());
    await client(f).decide(request);
    expect(f).toHaveBeenCalledTimes(2);
    await expect(
      client(vi.fn().mockRejectedValue(new Error("down"))).decide(request),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
  it("times out and cancels actual fetch transport", async () => {
    const f: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    await expect(
      client(f, { timeoutMs: 20 }).decide(request),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("enforces context limits and HTTPS", async () => {
    await expect(
      client(vi.fn(), { maxContextBytes: 20 }).decide(request),
    ).rejects.toMatchObject({ code: "CONTEXT_LIMIT" });
    await expect(
      client(vi.fn(), { baseUrl: "http://external.example" }).decide(request),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });
  it("mock providers are explicitly labelled", async () => {
    const mock = new MockProvider(mockResponse);
    expect(mock.mode).toBe("mock");
    expect((await mock.decide(request)).model_version).toBe("mock-fixture-v1");
  });
});
it("decodes Unicode answer tiers split across HTTP chunks", async () => {
  const input: JevRequest = {
    model: "jev-1.13",
    state: "A Unicode fixture",
    questions: {
      tier: {
        type: "score",
        instructions: "Estimate impact",
        criteria: ["Calmé", "Élevé"],
      },
    },
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify(mockResponse(input, { impact: 1 })),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const response = await client(
    vi.fn().mockResolvedValue(new Response(stream)),
  ).decide(input);
  expect(response.answers.tier).toMatchObject({
    type: "score",
    legend: { "1": "Élevé" },
  });
});
