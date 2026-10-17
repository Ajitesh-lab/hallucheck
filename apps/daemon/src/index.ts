import net from "node:net";
import { chmod, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Engine } from "../../../packages/core/src/index.js";
import { id } from "../../../packages/shared/src/index.js";
import { redact } from "../../../packages/core/src/security/index.js";
export const Request = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("findings") }),
  z.object({ op: z.literal("report") }),
  z.object({ op: z.literal("analyze"), event: z.unknown() }),
  z.object({
    op: z.literal("enqueue"),
    event: z.unknown(),
    key: z.string().max(256),
  }),
  z.object({ op: z.literal("job"), id: z.string() }),
]);
export const socketPath = (root: string): string =>
  path.join(root, ".hallucheck", "daemon.sock");
export class JobQueue {
  private pending: {
    id: string;
    key: string;
    run: (signal: AbortSignal) => Promise<unknown>;
    controller: AbortController;
  }[] = [];
  private running = new Map<
    string,
    { key: string; controller: AbortController }
  >();
  private results = new Map<
    string,
    { status: string; result?: unknown; error?: string }
  >();
  private closed = false;
  constructor(
    readonly concurrency: number,
    readonly capacity: number,
  ) {}
  enqueue(key: string, run: (signal: AbortSignal) => Promise<unknown>): string {
    if (this.closed) throw new Error("Queue closed");
    for (const job of this.pending.filter((j) => j.key === key)) {
      job.controller.abort();
      this.results.set(job.id, { status: "canceled" });
    }
    this.pending = this.pending.filter((j) => j.key !== key);
    for (const [, job] of this.running)
      if (job.key === key) job.controller.abort();
    if (this.pending.length >= this.capacity) throw new Error("Queue full");
    const job = { id: id(), key, run, controller: new AbortController() };
    this.pending.push(job);
    this.results.set(job.id, { status: "queued" });
    this.pump();
    return job.id;
  }
  get(jobId: string): unknown {
    return this.results.get(jobId) ?? { status: "unknown" };
  }
  get size(): number {
    return this.pending.length + this.running.size;
  }
  close(): void {
    this.closed = true;
    for (const job of this.pending) job.controller.abort();
    this.pending = [];
    for (const job of this.running.values()) job.controller.abort();
  }
  private pump(): void {
    while (
      !this.closed &&
      this.running.size < this.concurrency &&
      this.pending.length
    ) {
      const job = this.pending.shift()!;
      this.running.set(job.id, { key: job.key, controller: job.controller });
      this.results.set(job.id, { status: "running" });
      void job
        .run(job.controller.signal)
        .then((result) =>
          this.results.set(
            job.id,
            job.controller.signal.aborted
              ? { status: "canceled" }
              : { status: "complete", result },
          ),
        )
        .catch((error: Error) =>
          this.results.set(job.id, {
            status: job.controller.signal.aborted ? "canceled" : "failed",
            error: redact(error.message),
          }),
        )
        .finally(() => {
          this.running.delete(job.id);
          while (this.results.size > 256)
            this.results.delete(this.results.keys().next().value!);
          this.pump();
        });
    }
  }
}
export async function serve(
  engine: Engine,
): Promise<{ close: () => Promise<void> }> {
  const socket = socketPath(engine.root);
  if (Buffer.byteLength(socket) > 100)
    throw new Error(
      "Repository socket path exceeds Unix limit; use a shorter repository path",
    );
  try {
    await lstat(socket);
    try {
      await rpc(engine.root, { op: "status" }, 300);
      throw new Error("Daemon already running");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ECONNREFUSED" &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    await unlink(socket);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const queue = new JobQueue(
    engine.config.performance.maxConcurrentChecks,
    engine.config.performance.maxQueue,
  );
  const clients = new Set<net.Socket>();
  let active = 0,
    closing = false;
  let closed: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closed ??= new Promise<void>((resolve) => {
      closing = true;
      queue.close();
      for (const client of clients) client.destroy();
      server.close(() => {
        const finish = () => {
          if (active || queue.size) {
            setTimeout(finish, 10);
            return;
          }
          engine.close();
          void unlink(socket)
            .catch(() => {})
            .then(() => resolve());
        };
        finish();
      });
    }));
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    if (clients.size >= 32) {
      client.destroy();
      return;
    }
    clients.add(client);
    let buffer = "",
      handled = false;
    client.setTimeout(15000, () => client.destroy());
    client.on("close", () => clients.delete(client));
    client.on("error", () => {});
    client.on("data", (chunk) => {
      if (handled) return;
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 1_000_000) {
        client.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      active++;
      void (async () => {
        try {
          if (closing) throw new Error("Daemon shutting down");
          const req = Request.parse(JSON.parse(buffer.slice(0, newline)));
          let result: unknown;
          switch (req.op) {
            case "status":
              result = {
                running: true,
                providerStatus: engine.providerStatus,
                queuedJobs: queue.size,
                repositoryRoot: engine.root,
              };
              break;
            case "findings":
              result = await engine.findings();
              break;
            case "report":
              result = await engine.report();
              break;
            case "job":
              result = queue.get(req.id);
              break;
            case "enqueue":
              result = {
                jobId: queue.enqueue(req.key, (signal) =>
                  engine.analyze(req.event, signal),
                ),
                status: "queued",
              };
              break;
            case "analyze":
              result = await engine.analyze(req.event);
              break;
            case "stop":
              result = { stopped: true };
              setTimeout(() => void close(), 25);
              break;
          }
          client.end(JSON.stringify({ ok: true, result }) + "\n");
        } catch (error) {
          client.end(
            JSON.stringify({
              ok: false,
              error: redact((error as Error).message),
            }) + "\n",
          );
        } finally {
          active--;
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => resolve());
  });
  await chmod(socket, 0o600);
  return { close };
}
export async function rpc(
  root: string,
  request: unknown,
  timeout = 15000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath(root));
    let data = "";
    client.setTimeout(timeout, () =>
      client.destroy(new Error("Daemon request timeout")),
    );
    client.on("connect", () => client.end(JSON.stringify(request) + "\n"));
    client.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (Buffer.byteLength(data) > 4_000_000)
        client.destroy(new Error("Daemon output too large"));
    });
    client.on("error", reject);
    client.on("end", () => {
      try {
        const response = JSON.parse(data) as {
          ok: boolean;
          result?: unknown;
          error?: string;
        };
        if (!response.ok) reject(new Error(response.error));
        else resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
