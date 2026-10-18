import { readFile, writeFile, realpath, access, open } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Engine } from "../../../packages/core/src/index.js";
import {
  ConfigSchema,
  type Analysis,
  type Finding,
} from "../../../packages/shared/src/index.js";
import { redact } from "../../../packages/core/src/security/index.js";
import { rpc } from "../../daemon/src/index.js";
import { handleHook } from "../../../packages/integrations/claude-code/src/index.js";
import {
  JevClient,
  ProviderUnavailable,
  jevEndpoint,
} from "../../../packages/jev-provider/src/index.js";
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
// Auth rejects all key/path arguments before touching a supplied path.
let root =
  args[0] === "auth"
    ? process.cwd()
    : await realpath(value("--root") ?? process.cwd());
const json = args.includes("--json") || value("--format") === "json";
function print(data: unknown): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (
    data &&
    typeof data === "object" &&
    "findings" in data &&
    Array.isArray((data as Analysis).findings)
  ) {
    const result = data as Analysis;
    console.log(
      `HALLUCHECK · Jev ${result.providerStatus} · ${result.findings.length} scoped assertions`,
    );
    for (const f of result.findings)
      console.log(
        `${f.status.padEnd(13)} ${f.decision.action.padEnd(13)} ${f.claim.statement}\n  ${f.id.slice(0, 12)} · ${f.decision.reasons.join(" ")}`,
      );
    console.log(
      `Latency ${result.metrics.total_latency_ms.toFixed(2)} ms · cache ${result.metrics.cache_hit ? "hit" : "miss"}`,
    );
  } else if (Array.isArray(data)) {
    for (const f of data as (Finding & { stale?: boolean })[])
      console.log(
        `${f.id} ${f.stale ? "STALE " : ""}${f.status} ${f.decision.action}\n  ${f.claim.statement}`,
      );
  } else
    console.log(
      typeof data === "string" ? data : JSON.stringify(data, null, 2),
    );
}
async function readInput(): Promise<unknown> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 1_000_000)
      throw new Error("Input too large");
  }
  return JSON.parse(input);
}
async function engineRead<T>(
  fn: (engine: Engine) => Promise<T> | T,
): Promise<T> {
  const engine = await Engine.open(root);
  try {
    return await fn(engine);
  } finally {
    engine.close();
  }
}
async function viaDaemon(
  request: unknown,
  fallback: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await rpc(root, request);
  } catch (error) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    return fallback();
  }
}
async function humanReview(
  decision: "approve" | "reject",
  findingId: string | undefined,
): Promise<void> {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.env.CI ||
    process.env.CODEX_THREAD_ID ||
    process.env.CLAUDECODE
  )
    throw new Error(
      "Human review requires a separate interactive local terminal, outside agent/CI sessions. MCP and daemon cannot approve.",
    );
  if (!findingId) throw new Error("Provide a full finding ID");
  await engineRead(async (engine) => {
    const finding = engine.store.get(findingId);
    if (!finding || finding.repositoryRoot !== root)
      throw new Error("Finding not found in this repository");
    const context = await engine.repo.context();
    if (context.snapshot !== finding.snapshot)
      throw new Error("Finding is stale; scan the current repository first");
    console.log(
      `${decision.toUpperCase()} ${finding.id}\n${finding.claim.statement}\nSnapshot ${finding.snapshot}`,
    );
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await rl.question(
        `Type ${decision} ${finding.id.slice(0, 12)} to record your decision: `,
      );
      if (answer !== `${decision} ${finding.id.slice(0, 12)}`)
        throw new Error("Review canceled");
      engine.store.review(
        finding.id,
        finding.snapshot,
        decision,
        process.env.USER ?? "local-user",
      );
      engine.store.audit("human-review", {
        findingId: finding.id,
        snapshot: finding.snapshot,
        decision,
      });
      print("Review recorded for this finding and repository state only.");
    } finally {
      rl.close();
    }
  });
}
try {
  switch (args[0] ?? "help") {
    case "auto-review": {
      const command = args[1] ?? "status";
      if (!["enable", "status", "disable"].includes(command))
        throw new Error("Use auto-review enable | status | disable");
      const activation = fileURLToPath(
        new URL(
          "../plugins/codex/skills/hallucheck/scripts/activate.mjs",
          import.meta.url,
        ),
      );
      const output = await promisify(execFile)(
        process.execPath,
        [activation, command],
        { maxBuffer: 1_000_000 },
      );
      print(JSON.parse(output.stdout));
      break;
    }
    case "auth": {
      if (args.slice(2).some((arg) => !["--json"].includes(arg)))
        throw new Error(
          "Auth accepts no key arguments. Use halluc-check auth login in your terminal; input is hidden.",
        );
      const { auth } = await import("./auth.js");
      print(await auth(args[1]));
      break;
    }
    case "init": {
      const file = path.join(root, "hallucheck.config.json");
      await writeFile(
        file,
        JSON.stringify(ConfigSchema.parse({}), null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      print(
        `Created ${file}. External inference and commands are disabled by default.`,
      );
      break;
    }
    case "scan": {
      const result = await engineRead(async (engine) => {
        const file = value("--file");
        const files = file
          ? [file]
          : args.includes("--changed")
            ? await engine.repo.files(true)
            : [];
        if (args.includes("--changed") && !files.length)
          return {
            eventId: "no-changes",
            snapshot: (await engine.repo.context()).snapshot,
            findings: [],
            providerStatus: engine.providerStatus,
            metrics: { total_latency_ms: 0, cache_hit: false },
          };
        const event = {
          eventType: "MANUAL_SCAN",
          repositoryRoot: root,
          filePaths: files,
        };
        return viaDaemon({ op: "analyze", event }, () => engine.analyze(event));
      });
      print(result);
      break;
    }
    case "review-task": {
      const { EventSchema } = await import(
        "../../../packages/shared/src/index.js"
      );
      const input = await readInput();
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error(
          "Provide JSON with text and optional claims/filePaths on stdin",
        );
      const data = input as Record<string, unknown>;
      const event = EventSchema.parse({
        text: data.text,
        claims: data.claims,
        filePaths: data.filePaths,
        repositoryRoot: root,
        agentType: "cli",
        sessionId: process.env.CODEX_THREAD_ID ?? "task-review",
        eventType: "AGENT_STOP",
      });
      if (!event.text?.trim() && !event.claims.length)
        throw new Error(
          "Task review requires completion text or explicit claims",
        );
      print(
        await viaDaemon({ op: "analyze", event }, () =>
          engineRead((engine) => engine.analyze(event)),
        ),
      );
      break;
    }
    case "status":
      print(
        await viaDaemon({ op: "status" }, () =>
          engineRead((engine) => ({
            running: false,
            providerStatus: engine.providerStatus,
            repositoryRoot: root,
          })),
        ),
      );
      break;
    case "findings":
      print(
        await viaDaemon({ op: "findings" }, () =>
          engineRead((engine) => engine.findings()),
        ),
      );
      break;
    case "report":
      print(
        await viaDaemon({ op: "report" }, () =>
          engineRead((engine) => engine.report()),
        ),
      );
      break;
    case "review":
      print(
        await engineRead(async (engine) =>
          (await engine.findings())
            .filter((f) => f.humanReviewRequired && !f.stale)
            .map((f) => ({ ...f, reviews: engine.store.reviews(f.id) })),
        ),
      );
      break;
    case "approve":
    case "reject":
      await humanReview(args[0] as "approve" | "reject", args[1]);
      break;
    case "doctor": {
      const checks: Record<string, unknown> = {
        node: process.version,
        supportedNode: Number(process.versions.node.split(".")[0]) >= 22,
        platform: process.platform,
        sqlite: "available",
        externalInference: "disabled unless explicitly configured",
      };
      for (const command of ["git", "rg"])
        try {
          checks[command] = (
            await promisify(execFile)(command, ["--version"], { timeout: 2000 })
          ).stdout
            .trim()
            .split("\n")[0];
        } catch {
          checks[command] = "missing";
        }
      checks.provider = await engineRead((engine) => engine.providerStatus);
      if (args.includes("--jev")) {
        // An explicit diagnostic sends only this synthetic assertion, never repository data.
        const apiKey =
          process.env.JEV_API_KEY ??
          process.env.TYPESAFE_API_KEY ??
          process.env.AI_GATEWAY_API_KEY;
        try {
          const endpoint = jevEndpoint(apiKey, process.env.JEV_BASE_URL);
          const response = await new JevClient({
            apiKey,
            baseUrl: process.env.JEV_BASE_URL,
            allowExternalInference: true,
            timeoutMs: 10000,
            retries: 0,
          }).decide({
            model: process.env.JEV_MODEL ?? "jev-latest",
            state: "The number is 2.",
            questions: {
              even: { type: "noul", instructions: "Is the number even?" },
            },
          });
          checks.jev = {
            ok: true,
            endpoint: endpoint.href,
            model: response.model,
            modelVersion: response.model_version,
          };
        } catch (error) {
          checks.jev = {
            ok: false,
            code:
              error instanceof ProviderUnavailable ? error.code : "UNAVAILABLE",
            message: redact((error as Error).message),
          };
          process.exitCode = 1;
        }
      }
      print(checks);
      break;
    }
    case "daemon":
      if (args[1] === "stop") {
        print(await rpc(root, { op: "stop" }));
      } else if (args[1] === "start") {
        try {
          print(await rpc(root, { op: "status" }, 300));
        } catch (error) {
          if (
            !["ENOENT", "ECONNREFUSED"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
          await engineRead(() => {});
          const log = await open(
            path.join(root, ".hallucheck", "daemon.log"),
            constants.O_WRONLY |
              constants.O_APPEND |
              constants.O_CREAT |
              constants.O_NOFOLLOW,
            0o600,
          );
          try {
            const child = spawn(
              process.execPath,
              [fileURLToPath(new URL("./daemon.mjs", import.meta.url)), root],
              { detached: true, stdio: ["ignore", log.fd, log.fd] },
            );
            child.unref();
          } finally {
            await log.close();
          }
          let ready = false;
          for (let i = 0; i < 50; i++) {
            await new Promise((r) => setTimeout(r, 100));
            try {
              const status = await rpc(root, { op: "status" }, 300);
              print(status);
              ready = true;
              break;
            } catch {}
          }
          if (!ready)
            throw new Error(
              "Daemon did not start; inspect .hallucheck/daemon.log",
            );
        }
      } else throw new Error("Use daemon start or daemon stop");
      break;
    case "hook": {
      const host = args[1];
      if (host !== "claude-code" && host !== "codex")
        throw new Error("Unknown hook host");
      const input = await readInput();
      // Hook cwd is supplied by the host. A plugin may launch from its cache.
      const { hookInput } = await import(
        "../../../packages/integrations/claude-code/src/index.js"
      );
      if (!value("--root")) root = await realpath(hookInput.parse(input).cwd);
      const output = await handleHook(host, input, root);
      console.log(JSON.stringify(output));
      break;
    }
    case "mcp":
      await import("../../mcp-server/src/index.js").then((m) =>
        m.startMcp(value("--root")),
      );
      break;
    case "benchmark": {
      const { benchmark } = await import(
        "../../../evals/benchmarks/benchmark.js"
      );
      print(await benchmark(root));
      break;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(
        "halluc-check auto-review enable/status/disable | auth login/status/logout | init | scan [--changed | --file PATH] | review-task (JSON stdin: text, claims?, filePaths?) | daemon start/stop | status | findings | review | approve ID | reject ID | report | benchmark | doctor [--jev] | mcp\nOptions: --root PATH --json --format json\nJev: auth login stores your TypeSafe key with hidden input and explicit inference consent. doctor --jev sends one synthetic model request.",
      );
      break;
    default:
      throw new Error(`Unknown command: ${args[0]}`);
  }
} catch (error) {
  console.error(redact((error as Error).message));
  process.exitCode = 1;
}
