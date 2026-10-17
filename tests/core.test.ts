import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Engine } from "../packages/core/src/index.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import { normalizeEvent } from "../packages/core/src/events/index.js";
import { determineStatus } from "../packages/core/src/evidence/index.js";
import { extractClaims } from "../packages/core/src/claims/index.js";
import { safePath, sanitize } from "../packages/core/src/security/index.js";
import { route } from "../packages/core/src/policy/index.js";
const roots: string[] = [];
const engines: Engine[] = [];
export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "hallucheck-"));
  roots.push(root);
  await writeFile(
    path.join(root, "api.ts"),
    "export function createSession() { return 1; }\n",
  );
  await writeFile(path.join(root, "package.json"), "{}");
  return root;
}
afterEach(async () => {
  engines.splice(0).forEach((e) => e.close());
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
describe("functional core", () => {
  it("normalizes events and retains ambiguous assertions without inventing claims", async () => {
    const root = await fixture();
    const event = await normalizeEvent({
      repositoryRoot: root,
      eventType: "AGENT_CLAIM",
      text: "Everything is implemented.",
    });
    expect(extractClaims(event)[0]).toMatchObject({
      statement: "Everything is implemented.",
      extractionMethod: "limited",
      requiredEvidence: [],
    });
    await expect(
      normalizeEvent({ ...event, eventType: "fake" }),
    ).rejects.toThrow();
  });
  it("scans real TypeScript evidence and invalidates cached positive findings", async () => {
    const root = await fixture();
    const engine = await Engine.open(root, { memory: true });
    engines.push(engine);
    const input = {
      repositoryRoot: root,
      eventType: "MANUAL_SCAN",
      filePaths: ["api.ts"],
    };
    const first = await engine.analyze(input);
    expect(first.findings[0]?.status).toBe("VERIFIED");
    expect((await engine.analyze(input)).metrics.cache_hit).toBe(true);
    await writeFile(
      path.join(root, "api.ts"),
      'import { madeUp } from "nonexistent-pkg"; export const x:number="bad";',
    );
    const after = await engine.analyze(input);
    expect(after.snapshot).not.toBe(first.snapshot);
    expect(after.findings.some((f) => f.status === "CONTRADICTED")).toBe(true);
    expect(after.metrics.cache_hit).toBe(false);
  });
  it("verifies exports and legitimate unfamiliar names through compiler API", async () => {
    const root = await fixture();
    const engine = await Engine.open(root, { memory: true });
    engines.push(engine);
    for (const [name, status] of [
      ["createSession", "VERIFIED"],
      ["createImpossible", "CONTRADICTED"],
    ]) {
      const result = await engine.analyze({
        repositoryRoot: root,
        eventType: "AGENT_CLAIM",
        claims: [
          {
            statement: `api exports ${name}`,
            requiredEvidence: [{ kind: "export", path: "api.ts", name }],
          },
        ],
      });
      expect(result.findings[0]?.status).toBe(status);
    }
  });
  it("does not label missing test execution as failure or free text as verified", async () => {
    const root = await fixture();
    const engine = await Engine.open(root, { memory: true });
    engines.push(engine);
    const result = await engine.analyze({
      repositoryRoot: root,
      eventType: "AGENT_CLAIM",
      claims: [
        {
          statement: "Authentication tests pass.",
          requiredEvidence: [{ kind: "tests", commandId: "auth" }],
        },
      ],
    });
    expect(result.findings[0]?.status).toBe("UNSUPPORTED");
    expect(result.findings[0]?.decision.action).toBe("CONTINUE");
    expect(result.providerStatus).toBe("disabled");
  });
  it("enforces path/symlink boundaries and excludes secrets", async () => {
    const root = await fixture();
    await symlink("/etc", path.join(root, "escape"));
    await expect(safePath(root, "../outside")).rejects.toThrow();
    await expect(safePath(root, "escape/passwd")).rejects.toThrow();
    await writeFile(path.join(root, ".env"), "SECRET=value");
    await expect(safePath(root, ".env", [".env"])).rejects.toThrow();
    const value = sanitize({
      message: 'api_key="sk-secret123456"',
      secret: "value",
    });
    expect(JSON.stringify(value)).not.toContain("sk-secret");
    expect(value.secret).toBe("[REDACTED]");
  });
  it("a reliable contradiction wins over unsupported evidence", () => {
    expect(
      determineStatus([
        { status: "CONTRADICTED", reliability: 1 },
        { status: "VERIFIED", reliability: 1 },
      ] as never),
    ).toBe("CONTRADICTED");
  });
  it("mandatory authorization overrides all predictions", () => {
    const decision = route(
      {
        status: "VERIFIED",
        providerStatus: "disabled",
        canVerify: false,
        mandatoryAuthorization: true,
        reversible: true,
      },
      ConfigSchema.parse({}),
    );
    expect(decision.action).toBe("HUMAN_REVIEW");
  });
});
it("invalidates snapshots immediately for newly added and removed files", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "empty"));
  const engine = await Engine.open(root, { memory: true });
  engines.push(engine);
  const event = {
    repositoryRoot: root,
    eventType: "AGENT_CLAIM",
    claims: [
      {
        statement: "api exists",
        requiredEvidence: [{ kind: "file", path: "api.ts" }],
      },
    ],
  };
  const first = await engine.analyze(event);
  await writeFile(path.join(root, "empty", "new.ts"), "export const added=1;");
  const second = await engine.analyze(event);
  expect(second.snapshot).not.toBe(first.snapshot);
  await rm(path.join(root, "empty", "new.ts"));
  expect((await engine.analyze(event)).snapshot).toBe(first.snapshot);
});
it("invalidates compiler caches when installed declaration files change", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "node_modules", "local-api"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "node_modules", "local-api", "package.json"),
    '{"name":"local-api","types":"index.d.ts"}',
  );
  await writeFile(
    path.join(root, "node_modules", "local-api", "index.d.ts"),
    "export declare const present: number;",
  );
  await writeFile(
    path.join(root, "api.ts"),
    'import { present } from "local-api"; export const result:number=present;',
  );
  const engine = await Engine.open(root, { memory: true });
  engines.push(engine);
  const event = {
    repositoryRoot: root,
    eventType: "MANUAL_SCAN",
    filePaths: ["api.ts"],
  };
  expect((await engine.analyze(event)).findings[0]?.status).toBe("VERIFIED");
  await writeFile(
    path.join(root, "node_modules", "local-api", "index.d.ts"),
    "export declare const replacement: string;",
  );
  expect((await engine.analyze(event)).findings[0]?.status).toBe(
    "CONTRADICTED",
  );
});
it("invalidates a missing module result immediately after dependency installation", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "api.ts"),
    'import { present } from "newly-installed"; export const result=present;',
  );
  const engine = await Engine.open(root, { memory: true });
  engines.push(engine);
  const event = {
    repositoryRoot: root,
    eventType: "AGENT_CLAIM",
    claims: [
      {
        statement: "The import resolves.",
        requiredEvidence: [
          { kind: "module", path: "api.ts", name: "newly-installed" },
        ],
      },
    ],
  };
  expect((await engine.analyze(event)).findings[0]?.status).toBe(
    "CONTRADICTED",
  );
  await mkdir(path.join(root, "node_modules", "newly-installed"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "node_modules", "newly-installed", "package.json"),
    '{"name":"newly-installed","types":"index.d.ts"}',
  );
  await writeFile(
    path.join(root, "node_modules", "newly-installed", "index.d.ts"),
    "export declare const present: number;",
  );
  expect((await engine.analyze(event)).findings[0]?.status).toBe("VERIFIED");
});
