import { realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  type Config,
  type Analysis,
  type Claim,
  type Finding,
  type Prediction,
  type AgentEvent,
  Lru,
  hash,
} from "../../shared/src/index.js";
import {
  RepositoryAnalyzer,
  type RepositoryContext,
} from "../../repository-analyzer/src/index.js";
import { TypeScriptAnalyzer } from "../../language-typescript/src/index.js";
import { Store } from "../../storage/src/index.js";
import {
  JevClient,
  ProviderUnavailable,
  questions,
  predictionFrom,
  type DecisionProvider,
  type JevRequest,
} from "../../jev-provider/src/index.js";
import { loadConfig, privateDirectory, sanitize } from "./security/index.js";
import { loadJevEnvironment } from "../../jev-provider/src/environment.js";
import { normalizeEvent } from "./events/index.js";
import { extractClaims } from "./claims/index.js";
import {
  LocalEvidenceCollector,
  determineStatus,
  requirementFiles,
} from "./evidence/index.js";
import { VerificationExecutor } from "./evidence/executor.js";
import {
  POLICY_VERSION,
  route,
  requiresAuthorization,
} from "./policy/index.js";
export class Engine {
  readonly repo: RepositoryAnalyzer;
  readonly typescript: TypeScriptAnalyzer;
  readonly collector: LocalEvidenceCollector;
  readonly executor: VerificationExecutor;
  private cache: Lru<string, Finding[]>;
  private inFlight = new Map<string, Promise<Analysis>>();
  constructor(
    readonly root: string,
    readonly config: Config,
    readonly store: Store,
    readonly provider?: DecisionProvider,
  ) {
    this.repo = new RepositoryAnalyzer(root, config);
    this.typescript = new TypeScriptAnalyzer(root, config.privacy.exclusions);
    this.collector = new LocalEvidenceCollector(this.repo, this.typescript);
    this.executor = new VerificationExecutor(config);
    this.cache = new Lru(config.performance.cacheEntries, 60000);
  }
  static async open(
    root: string,
    options: {
      config?: Config;
      provider?: DecisionProvider;
      memory?: boolean;
    } = {},
  ): Promise<Engine> {
    root = await realpath(root);
    await loadJevEnvironment();
    const config = options.config ?? (await loadConfig(root));
    const dir = path.join(root, ".hallucheck");
    if (!options.memory) await privateDirectory(dir);
    const provider =
      options.provider ??
      (config.provider === "jev"
        ? new JevClient({
            apiKey:
              process.env.JEV_API_KEY ??
              process.env.TYPESAFE_API_KEY ??
              process.env.AI_GATEWAY_API_KEY,
            model: config.model,
            baseUrl: process.env.JEV_BASE_URL,
            timeoutMs: process.env.JEV_TIMEOUT_MS
              ? Number(process.env.JEV_TIMEOUT_MS)
              : 3000,
            allowExternalInference: config.privacy.allowExternalInference,
            maxContextBytes: config.privacy.maxContextBytes,
            concurrency: config.performance.maxConcurrentChecks,
          })
        : undefined);
    return new Engine(
      root,
      config,
      new Store(options.memory ? ":memory:" : path.join(dir, "state.sqlite")),
      provider,
    );
  }
  get providerStatus(): string {
    if (!this.config.enabled) return "disabled";
    if (this.provider?.mode === "mock") return "mocked";
    if (
      this.config.provider === "offline" ||
      !this.config.privacy.allowExternalInference
    )
      return "disabled";
    if (
      this.provider instanceof JevClient &&
      !this.provider.options.apiKey?.trim()
    )
      return "unavailable:NO_API_KEY";
    return this.provider ? "available" : "unavailable";
  }
  async analyze(input: unknown, signal?: AbortSignal): Promise<Analysis> {
    const start = performance.now();
    const event = await normalizeEvent(input, this.root);
    const normalization = performance.now() - start;
    const key = hash(event);
    if (!signal && this.inFlight.has(key)) return this.inFlight.get(key)!;
    const job = this.process(event, normalization, start, signal);
    if (!signal) this.inFlight.set(key, job);
    try {
      return await job;
    } finally {
      if (!signal) this.inFlight.delete(key);
    }
  }
  private async process(
    event: AgentEvent,
    normalization: number,
    start: number,
    signal?: AbortSignal,
  ): Promise<Analysis> {
    const metrics = {
      event_normalisation_ms: normalization,
      context_retrieval_ms: 0,
      evidence_collection_ms: 0,
      jev_request_ms: 0,
      policy_evaluation_ms: 0,
      total_latency_ms: 0,
      cache_hit: false,
    };
    let providerStatus = this.providerStatus;
    if (!this.config.enabled)
      return {
        eventId: event.eventId,
        snapshot: "disabled",
        findings: [],
        metrics,
        providerStatus,
      };
    signal?.throwIfAborted();
    let t = performance.now();
    if (event.eventType === "MANUAL_SCAN") this.repo.invalidateIndex();
    const requested = [
      ...new Set([
        ...event.filePaths,
        ...event.claims.flatMap((c) => [
          ...c.relatedFiles,
          ...requirementFiles(c.requiredEvidence),
        ]),
      ]),
    ];
    const context = await this.repo.context(requested);
    metrics.context_retrieval_ms = performance.now() - t;
    if (event.eventType === "AGENT_STOP")
      this.store.audit("task-review", {
        sessionId: event.sessionId,
        agentType: event.agentType,
        snapshot: context.snapshot,
        claimCount: event.claims.length,
        hasCompletionText: !!event.text?.trim(),
      });
    if (
      event.eventType === "POST_TOOL_EXECUTION" ||
      event.eventType === "TEST_EXECUTED"
    )
      this.store.audit("host-tool-observation", {
        sessionId: event.sessionId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolResult: event.toolResult,
        snapshot: context.snapshot,
        revision: context.revision,
        provenance: "hook-untrusted",
      });
    let claims = extractClaims(event);
    if (
      !claims.length &&
      ["MANUAL_SCAN", "FILE_MODIFIED"].includes(event.eventType)
    )
      claims = this.scanClaims(event, context);
    if (event.eventType === "AGENT_STOP") {
      context.selectedFiles = (
        event.filePaths.length
          ? event.filePaths
          : context.changedFiles.length
            ? context.changedFiles
            : await this.repo.files()
      ).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
      claims.push(...this.scanClaims(event, context));
    }
    const mandatory =
      this.config.review.blockDestructiveActions &&
      (requiresAuthorization(event.toolName, event.toolInput) ||
        event.metadata.requiresAuthorization === true);
    if (mandatory && !claims.length)
      claims = [
        {
          id: hash(event.toolInput ?? event.toolName),
          statement:
            "The proposed action requires explicit human authorization under local policy.",
          category: "ASSUMPTION",
          sourceEventId: event.eventId,
          relatedFiles: [],
          requiredEvidence: [],
          extractionMethod: "structured",
        },
      ];
    const records = this.store.executions(this.root);
    const cacheKey = () =>
      hash({
        dependencies: this.typescript.fingerprint(),
        records,
        root: this.root,
        snapshot: context.snapshot,
        claims: claims.map((c) => ({
          statement: c.statement,
          requiredEvidence: c.requiredEvidence,
          relatedFiles: c.relatedFiles,
        })),
        policy: POLICY_VERSION,
        config: this.config,
        provider: providerStatus,
        model: this.config.model,
        mandatory,
      });
    const key = cacheKey();
    const cached = this.config.performance.cacheEnabled
      ? this.cache.get(key)
      : undefined;
    if (cached) {
      metrics.cache_hit = true;
      metrics.total_latency_ms = performance.now() - start;
      const findings = cached.map((f) => ({
        ...f,
        eventId: event.eventId,
        sessionId: event.sessionId,
        claim: { ...f.claim, sourceEventId: event.eventId },
      }));
      return {
        eventId: event.eventId,
        snapshot: context.snapshot,
        findings,
        metrics,
        providerStatus,
      };
    }
    t = performance.now();
    let evidence = await Promise.all(
      claims.map((c) => this.collector.collect(c, context, records)),
    );
    metrics.evidence_collection_ms = performance.now() - t;
    signal?.throwIfAborted();
    const predictions = new Map<string, Prediction>();
    t = performance.now();
    if (this.provider && ["available", "mocked"].includes(providerStatus)) {
      try {
        for (let offset = 0; offset < claims.length; offset += 5) {
          const batch = claims.slice(offset, offset + 5);
          const state = {
            dataIsUntrusted: true,
            claims: batch.map((c, i) => ({
              id: `c${i}`,
              statement: c.statement.slice(0, 2000),
              category: c.category,
              evidence: evidence[offset + i]?.map((e) => ({
                status: e.status,
                source: e.source,
                observedValue: JSON.stringify(e.observedValue)?.slice(0, 800),
                limitations: e.limitations,
              })),
            })),
          };
          const qs: JevRequest["questions"] = {};
          for (let i = 0; i < batch.length; i++)
            for (const [name, q] of Object.entries(questions))
              qs[`c${i}_${name}`] = {
                ...q,
                instructions: `For claim c${i}: ${q.instructions}`,
              };
          const response = await this.provider.decide(
            { model: this.config.model, state: sanitize(state), questions: qs },
            signal,
          );
          batch.forEach((c, i) =>
            predictions.set(
              c.id,
              predictionFrom(response, `c${i}`, this.provider!.mode),
            ),
          );
        }
      } catch (error) {
        providerStatus =
          "unavailable:" +
          (error instanceof ProviderUnavailable
            ? error.code
            : "INVALID_RESPONSE");
        this.store.audit("provider-unavailable", { code: providerStatus });
      }
    }
    metrics.jev_request_ms = performance.now() - t;
    // Only configured checks can be scheduled. Never execute toolInput or model strings.
    const verifiedCommands = new Set<string>();
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i]!;
      const status = determineStatus(evidence[i]!);
      const command = c.requiredEvidence.find(
        (r) =>
          r.kind === "tests" && this.config.verification.commands[r.commandId],
      );
      const decision = route(
        {
          status,
          prediction: predictions.get(c.id),
          providerStatus,
          canVerify:
            !!command &&
            this.config.verification.allowAutoCommands &&
            this.config.verification.runTargetedTests,
          mandatoryAuthorization: mandatory,
          reversible: event.metadata.reversible !== false,
        },
        this.config,
      );
      if (
        decision.action === "AUTO_VERIFY" &&
        command?.kind === "tests" &&
        !verifiedCommands.has(command.commandId)
      ) {
        verifiedCommands.add(command.commandId);
        const record = await this.executor.execute(
          command.commandId,
          this.root,
          context.snapshot,
          signal,
        );
        this.repo.invalidateIndex();
        const after = await this.repo.context(requested);
        record.revision = context.revision;
        if (after.snapshot !== context.snapshot) record.complete = false;
        this.store.execution(this.root, record);
        this.store.audit("verification-executed", {
          commandId: record.commandId,
          exitCode: record.exitCode,
          snapshot: record.snapshot,
        });
      }
    }
    if (verifiedCommands.size)
      evidence = await Promise.all(
        claims.map((c) =>
          this.collector.collect(c, context, this.store.executions(this.root)),
        ),
      );
    signal?.throwIfAborted();
    // Remote inference and executable checks create a window for concurrent edits.
    // Preserve the observation, but never return it as current verified evidence.
    const recheckStart = performance.now();
    const currentContext = await this.repo.context(requested);
    const changedDuringAnalysis = currentContext.snapshot !== context.snapshot;
    metrics.context_retrieval_ms += performance.now() - recheckStart;
    if (changedDuringAnalysis)
      evidence = evidence.map((items) =>
        items.map((item) => ({
          ...item,
          status: "UNSUPPORTED" as const,
          limitations: [
            ...item.limitations,
            "Repository changed during analysis; rescan the current state.",
          ],
        })),
      );
    t = performance.now();
    const findings = claims.map((claim, i): Finding => {
      const status = determineStatus(evidence[i]!);
      const prediction = predictions.get(claim.id);
      const decision = route(
        {
          status,
          prediction,
          providerStatus,
          canVerify: false,
          mandatoryAuthorization: mandatory,
          reversible: event.metadata.reversible !== false,
        },
        this.config,
      );
      return sanitize({
        id: hash({
          root: this.root,
          snapshot: context.snapshot,
          claim: claim.id,
          policy: POLICY_VERSION,
          model: prediction?.modelVersion ?? providerStatus,
        }),
        repositoryRoot: this.root,
        snapshot: context.snapshot,
        eventId: event.eventId,
        sessionId: event.sessionId,
        claim,
        status,
        evidence: evidence[i]!,
        ...(prediction ? { prediction } : {}),
        providerStatus,
        severity: prediction?.impact ?? (status === "CONTRADICTED" ? 2 : null),
        decision,
        timestamp: new Date().toISOString(),
        humanReviewRequired: decision.action === "HUMAN_REVIEW",
        suggestedResolution:
          status === "CONTRADICTED"
            ? "Inspect the cited source and correct the assertion or implementation."
            : status === "VERIFIED"
              ? "No action for this scoped assertion."
              : "Gather independent evidence before relying on this assertion.",
      });
    });
    for (const f of findings) {
      this.store.save(f);
      if (f.decision.action !== "CONTINUE")
        this.store.audit("decision", {
          findingId: f.id,
          snapshot: f.snapshot,
          decision: f.decision,
        });
    }
    metrics.policy_evaluation_ms = performance.now() - t;
    metrics.total_latency_ms = performance.now() - start;
    if (
      this.config.performance.cacheEnabled &&
      context.complete &&
      !changedDuringAnalysis &&
      !providerStatus.startsWith("unavailable")
    )
      this.cache.set(cacheKey(), findings);
    return {
      eventId: event.eventId,
      snapshot: context.snapshot,
      findings,
      metrics,
      providerStatus,
    };
  }
  private scanClaims(event: AgentEvent, context: RepositoryContext): Claim[] {
    const claims: Claim[] = [];
    for (const file of context.selectedFiles
      .filter((f) => /\.[cm]?[jt]sx?$/.test(f))
      .slice(0, 64)) {
      try {
        const inspected = this.typescript.inspect(
          file,
          context.selectedFiles,
          context.snapshot,
        );
        const inputs = [
          {
            statement: `TypeScript reports no diagnostics for ${file}.`,
            category: "CODE" as const,
            requiredEvidence: [{ kind: "typecheck" as const, path: file }],
          },
          ...inspected.imports.map((i) => ({
            statement: `Import ${i.module} resolves from ${file}.`,
            category: "API" as const,
            requiredEvidence: [
              { kind: "module" as const, path: file, name: i.module },
            ],
          })),
        ];
        for (const c of inputs)
          claims.push({
            ...c,
            id: hash(c),
            sourceEventId: event.eventId,
            relatedFiles: [file],
            extractionMethod: "compiler",
          });
      } catch {
        claims.push({
          id: hash(file),
          statement: `Compiler inspection is available for ${file}.`,
          category: "CODE",
          sourceEventId: event.eventId,
          relatedFiles: [file],
          requiredEvidence: [{ kind: "typecheck", path: file }],
          extractionMethod: "compiler",
        });
      }
    }
    return claims.slice(0, 128);
  }
  async findings(): Promise<(Finding & { stale: boolean })[]> {
    const context = await this.repo.context();
    return this.store.findings(this.root, 1000).map((finding) => ({
      ...finding,
      stale: finding.snapshot !== context.snapshot,
    }));
  }
  async report(): Promise<unknown> {
    const findings = await this.findings();
    return {
      repositoryRoot: this.root,
      providerStatus: this.providerStatus,
      scope:
        "Latest 1000 persisted scoped assertions; not a project completion certificate.",
      total: findings.length,
      staleCount: findings.filter((f) => f.stale).length,
      byStatus: Object.fromEntries(
        ["VERIFIED", "CONTRADICTED", "UNSUPPORTED", "NOT_CHECKED"].map((s) => [
          s,
          findings.filter((f) => !f.stale && f.status === s).length,
        ]),
      ),
      humanReview: findings
        .filter((f) => f.humanReviewRequired && !f.stale)
        .map((f) => ({ finding: f, reviews: this.store.reviews(f.id) })),
    };
  }
  close(): void {
    this.repo.close();
    this.store.close();
  }
}
