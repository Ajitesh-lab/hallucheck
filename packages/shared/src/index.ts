import { z } from "zod";
import { OperatingMode } from "./interactions.js";
export * from "./interactions.js";
import { createHash, randomUUID } from "node:crypto";
export const hash = (value: unknown): string =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const id = (): string => randomUUID();
export const Status = z.enum([
  "VERIFIED",
  "CONTRADICTED",
  "UNSUPPORTED",
  "NOT_CHECKED",
]);
export type EvidenceStatus = z.infer<typeof Status>;
export const RequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("symbol"), path: z.string(), name: z.string() }),
  z.object({ kind: z.literal("export"), path: z.string(), name: z.string() }),
  z.object({ kind: z.literal("module"), path: z.string(), name: z.string() }),
  z.object({
    kind: z.literal("dependency"),
    name: z.string(),
    version: z.string().optional(),
  }),
  z.object({ kind: z.literal("typecheck"), path: z.string() }),
  z.object({ kind: z.literal("tests"), commandId: z.string() }),
  z.object({ kind: z.literal("modified"), path: z.string() }),
  z.object({
    kind: z.literal("documentation"),
    path: z.string(),
    excerpt: z.string().min(1),
  }),
]);
export type Requirement = z.infer<typeof RequirementSchema>;
export const ClaimInputSchema = z.object({
  statement: z.string().min(1).max(8000),
  category: z
    .enum([
      "API",
      "SYMBOL",
      "TEST",
      "COMPLETION",
      "DEPENDENCY",
      "ASSUMPTION",
      "CODE",
      "UNKNOWN",
    ])
    .default("UNKNOWN"),
  requiredEvidence: z.array(RequirementSchema).max(32).default([]),
  relatedFiles: z.array(z.string()).max(64).default([]),
  sourceLocation: z.string().optional(),
});
export type ClaimInput = z.input<typeof ClaimInputSchema>;
export type Claim = z.output<typeof ClaimInputSchema> & {
  id: string;
  sourceEventId: string;
  extractionMethod: "structured" | "compiler" | "limited";
};
export const EventSchema = z.object({
  eventId: z.string().default(id),
  sessionId: z.string().default("manual"),
  agentType: z.enum(["claude-code", "codex", "mcp", "cli"]).default("cli"),
  eventType: z.enum([
    "SESSION_START",
    "PRE_TOOL_EXECUTION",
    "POST_TOOL_EXECUTION",
    "FILE_MODIFIED",
    "TEST_EXECUTED",
    "AGENT_CLAIM",
    "AGENT_STOP",
    "MANUAL_SCAN",
  ]),
  timestamp: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  repositoryRoot: z.string().min(1),
  filePaths: z.array(z.string()).max(128).default([]),
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  toolResult: z.unknown().optional(),
  gitCommit: z.string().optional(),
  claims: z.array(ClaimInputSchema).max(32).default([]),
  text: z.string().max(8000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AgentEvent = z.output<typeof EventSchema>;
export interface Evidence {
  id: string;
  source: string;
  claimId: string;
  status: EvidenceStatus;
  observedValue: unknown;
  sourceReference: string;
  timestamp: string;
  reliability: number;
  limitations: string[];
}
export interface TestRecord {
  revision?: string;
  commandId: string;
  command: string[];
  exitCode: number | null;
  timestamp: string;
  snapshot: string;
  skipped: boolean | null;
  complete: boolean;
  provenance: "executor" | "hook-untrusted";
  output: string;
}
export interface Metrics {
  event_normalisation_ms: number;
  context_retrieval_ms: number;
  evidence_collection_ms: number;
  jev_request_ms: number;
  policy_evaluation_ms: number;
  total_latency_ms: number;
  cache_hit: boolean;
}
export type Action =
  | "CONTINUE"
  | "AUTO_VERIFY"
  | "AGENT_REPAIR"
  | "HUMAN_REVIEW";
export interface Prediction {
  provider: "jev" | "mock";
  model: string;
  modelVersion: string;
  requestId: string;
  latencyMs: number;
  unsupported: number;
  incorrectRisk: number;
  impact: number;
  recommendedAction: "continue" | "verify" | "repair" | "human_review";
  answers: Record<string, unknown>;
}
export interface Decision {
  action: Action;
  reasons: string[];
  expectedErrorCost: number | null;
  policyVersion: string;
}
export interface Finding {
  id: string;
  repositoryRoot: string;
  snapshot: string;
  eventId: string;
  sessionId: string;
  claim: Claim;
  status: EvidenceStatus;
  evidence: Evidence[];
  prediction?: Prediction;
  providerStatus: string;
  severity: number | null;
  decision: Decision;
  timestamp: string;
  humanReviewRequired: boolean;
  suggestedResolution: string;
}
export interface Analysis {
  eventId: string;
  snapshot: string;
  findings: Finding[];
  metrics: Metrics;
  providerStatus: string;
}
export const ConfigSchema = z.object({
  interaction: z
    .object({
      mode: OperatingMode.default("ASK_BEFORE_FIXING"),
      maxRepairAttempts: z.number().int().min(1).max(5).default(2),
      repairTimeoutMs: z.number().int().min(100).max(3600000).default(300000),
    })
    .default(() => ({
      mode: "ASK_BEFORE_FIXING" as const,
      maxRepairAttempts: 2,
      repairTimeoutMs: 300000,
    })),
  enabled: z.boolean().default(true),
  provider: z.enum(["jev", "offline"]).default("jev"),
  model: z.string().default("jev-1.13.0"),
  privacy: z
    .object({
      allowExternalInference: z.boolean().default(false),
      redactSecrets: z.literal(true).default(true),
      exclusions: z
        .array(z.string())
        .default([".env", ".env.*", "**/*.pem", "**/*.key", "**/secrets/**"]),
      maxContextBytes: z.number().int().min(512).max(32000).default(12000),
    })
    .default(() => ({
      allowExternalInference: false,
      redactSecrets: true as const,
      exclusions: [".env", ".env.*", "**/*.pem", "**/*.key", "**/secrets/**"],
      maxContextBytes: 12000,
    })),
  verification: z
    .object({
      runTypecheck: z.boolean().default(true),
      runTargetedTests: z.boolean().default(true),
      allowAutoCommands: z.boolean().default(false),
      commands: z
        .record(
          z.string(),
          z.object({
            executable: z.string(),
            args: z.array(z.string()),
            timeoutMs: z.number().int().min(100).max(120000).default(10000),
            provesNoSkippedTests: z.boolean().default(false),
          }),
        )
        .default({}),
    })
    .default(() => ({
      runTypecheck: true,
      runTargetedTests: true,
      allowAutoCommands: false,
      commands: {},
    })),
  review: z
    .object({
      humanReviewEnabled: z.boolean().default(true),
      blockDestructiveActions: z.boolean().default(true),
      humanCost: z.number().positive().default(2),
      verificationCost: z.number().positive().default(0.05),
      riskThreshold: z.number().min(0).max(1).default(0.7),
    })
    .default(() => ({
      humanReviewEnabled: true,
      blockDestructiveActions: true,
      humanCost: 2,
      verificationCost: 0.05,
      riskThreshold: 0.7,
    })),
  performance: z
    .object({
      cacheEnabled: z.boolean().default(true),
      asyncVerification: z.boolean().default(true),
      maxConcurrentChecks: z.number().int().min(1).max(16).default(4),
      maxQueue: z.number().int().min(1).max(256).default(64),
      cacheEntries: z.number().int().min(1).max(4096).default(256),
    })
    .default(() => ({
      cacheEnabled: true,
      asyncVerification: true,
      maxConcurrentChecks: 4,
      maxQueue: 64,
      cacheEntries: 256,
    })),
});
export type Config = z.output<typeof ConfigSchema>;
export class Lru<K, V> {
  private map = new Map<K, { value: V; expires: number }>();
  constructor(
    readonly capacity = 256,
    readonly ttlMs = 300000,
  ) {}
  get(key: K): V | undefined {
    const item = this.map.get(key);
    if (!item) return;
    if (item.expires < Date.now()) {
      this.map.delete(key);
      return;
    }
    this.map.delete(key);
    this.map.set(key, item);
    return item.value;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.capacity)
      this.map.delete(this.map.keys().next().value!);
  }
  get size(): number {
    return this.map.size;
  }
}
export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(
    readonly limit: number,
    readonly maxPending = 128,
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxPending)
        throw new Error("Concurrency queue full");
      await new Promise<void>((r) => this.waiters.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
