import { spawn } from "node:child_process";
import {
  type Config,
  type TestRecord,
  Semaphore,
} from "../../../shared/src/index.js";
import { redact } from "../security/index.js";
export class VerificationExecutor {
  private slots: Semaphore;
  constructor(readonly config: Config) {
    this.slots = new Semaphore(
      config.performance.maxConcurrentChecks,
      config.performance.maxQueue,
    );
  }
  async execute(
    commandId: string,
    root: string,
    snapshot: string,
    signal?: AbortSignal,
  ): Promise<TestRecord> {
    const command = this.config.verification.commands[commandId];
    if (!this.config.verification.allowAutoCommands || !command)
      throw new Error(
        "Verification command not authorized in local configuration",
      );
    return this.slots.run(
      () =>
        new Promise<TestRecord>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("Verification canceled"));
            return;
          }
          let output = "",
            complete = true,
            settled = false;
          const child = spawn(command.executable, command.args, {
            cwd: root,
            shell: false,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              TMPDIR: process.env.TMPDIR,
              CI: "1",
            },
          });
          const kill = () => {
            complete = false;
            try {
              if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          };
          const timer = setTimeout(kill, command.timeoutMs);
          signal?.addEventListener("abort", kill, { once: true });
          const collect = (chunk: Buffer) => {
            const remaining = 64000 - Buffer.byteLength(output);
            if (remaining > 0)
              output += chunk.subarray(0, remaining).toString("utf8");
            else kill();
          };
          child.stdout.on("data", collect);
          child.stderr.on("data", collect);
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", kill);
          };
          child.on("error", (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          });
          child.on("close", (exitCode) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              commandId,
              command: [command.executable, ...command.args],
              exitCode,
              timestamp: new Date().toISOString(),
              snapshot,
              skipped: command.provesNoSkippedTests ? false : null,
              complete,
              provenance: "executor",
              output: redact(output),
            });
          });
        }),
    );
  }
}
