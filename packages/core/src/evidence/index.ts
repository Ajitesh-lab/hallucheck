import { stat } from "node:fs/promises";
import {
  type Claim,
  type Evidence,
  type EvidenceStatus,
  type TestRecord,
  type Requirement,
  id,
} from "../../../shared/src/index.js";
import {
  RepositoryAnalyzer,
  type RepositoryContext,
} from "../../../repository-analyzer/src/index.js";
import { TypeScriptAnalyzer } from "../../../language-typescript/src/index.js";
import { safePath } from "../security/index.js";
export interface EvidenceCollector {
  collect(
    claim: Claim,
    context: RepositoryContext,
    records: TestRecord[],
  ): Promise<Evidence[]>;
}
export function determineStatus(evidence: Evidence[]): EvidenceStatus {
  if (evidence.some((e) => e.status === "CONTRADICTED" && e.reliability >= 0.9))
    return "CONTRADICTED";
  if (
    evidence.length &&
    evidence.every((e) => e.status === "VERIFIED" && e.reliability >= 0.9)
  )
    return "VERIFIED";
  if (!evidence.length || evidence.every((e) => e.status === "NOT_CHECKED"))
    return "NOT_CHECKED";
  return "UNSUPPORTED";
}
export class LocalEvidenceCollector implements EvidenceCollector {
  constructor(
    readonly repo: RepositoryAnalyzer,
    readonly typescript: TypeScriptAnalyzer,
  ) {}
  async collect(
    claim: Claim,
    context: RepositoryContext,
    records: TestRecord[],
  ): Promise<Evidence[]> {
    return Promise.all(
      claim.requiredEvidence.map(async (requirement) => {
        let status: EvidenceStatus = "UNSUPPORTED",
          value: unknown = null;
        const limitations: string[] = [];
        let source = "repository";
        try {
          if ("path" in requirement)
            await safePath(
              context.root,
              requirement.path,
              this.repo.config.privacy.exclusions,
            );
          switch (requirement.kind) {
            case "file":
              try {
                value = (
                  await stat(await safePath(context.root, requirement.path))
                ).isFile();
                status = value ? "VERIFIED" : "CONTRADICTED";
              } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
                value = false;
                status = "CONTRADICTED";
              }
              break;
            case "symbol":
            case "export":
            case "module":
            case "typecheck": {
              source = "typescript";
              const inspected = this.typescript.inspect(
                requirement.path,
                context.selectedFiles,
                context.snapshot,
              );
              if (requirement.kind === "typecheck") {
                if (!this.repo.config.verification.runTypecheck) {
                  status = "NOT_CHECKED";
                  break;
                }
                value = inspected.diagnostics;
                status = inspected.diagnostics.length
                  ? "CONTRADICTED"
                  : "VERIFIED";
                limitations.push(
                  "Diagnostics cover this file and reachable imports, not runtime behavior.",
                );
              } else if (requirement.kind === "module") {
                value =
                  inspected.imports.find((i) => i.module === requirement.name)
                    ?.resolved ?? false;
                status = value ? "VERIFIED" : "CONTRADICTED";
                limitations.push(
                  "Resolution uses local compiler settings; an absent installation can cause failure.",
                );
              } else {
                value = (
                  requirement.kind === "export"
                    ? inspected.exports
                    : inspected.symbols
                ).includes(requirement.name);
                status = value ? "VERIFIED" : "CONTRADICTED";
                limitations.push("Symbol presence does not prove semantics.");
              }
              break;
            }
            case "dependency": {
              const pkg = JSON.parse(
                await this.repo.text("package.json"),
              ) as Record<string, Record<string, string>>;
              value =
                pkg.dependencies?.[requirement.name] ??
                pkg.devDependencies?.[requirement.name] ??
                pkg.peerDependencies?.[requirement.name] ??
                null;
              status =
                value !== null &&
                (!requirement.version || value === requirement.version)
                  ? "VERIFIED"
                  : "CONTRADICTED";
              limitations.push(
                "Checks declared specifier, not registry existence or semver compatibility.",
              );
              break;
            }
            case "modified":
              value = context.changedFiles.includes(requirement.path);
              status = value ? "VERIFIED" : "UNSUPPORTED";
              limitations.push(
                "Tracked changes relative to HEAD only; absence is not proof of missing implementation.",
              );
              break;
            case "tests": {
              source = "test-execution";
              const record = records.find(
                (r) => r.commandId === requirement.commandId,
              );
              value = record ?? "No matching execution";
              if (!record) {
                status = "UNSUPPORTED";
                break;
              }
              if (record.provenance !== "executor") {
                limitations.push(
                  "Host or agent supplied result is not independently authenticated.",
                );
                break;
              }
              if (
                record.snapshot !== context.snapshot ||
                !context.complete ||
                !record.complete
              ) {
                limitations.push(
                  "Stale, incomplete, canceled, or bounded repository snapshot.",
                );
                break;
              }
              if (record.exitCode !== null && record.exitCode !== 0)
                status = "CONTRADICTED";
              else if (record.exitCode === 0 && record.skipped === false)
                status = "VERIFIED";
              else
                limitations.push(
                  "Skip status or command completion is unknown.",
                );
              break;
            }
            case "documentation":
              source = "local-documentation";
              value = (await this.repo.text(requirement.path)).includes(
                requirement.excerpt,
              );
              status = value ? "VERIFIED" : "UNSUPPORTED";
              limitations.push(
                "Confirms a literal local documentation excerpt, not its factual correctness.",
              );
              break;
          }
        } catch (e) {
          value = (e as Error).message;
          limitations.push("Collector could not safely establish the fact.");
        }
        return {
          id: id(),
          claimId: claim.id,
          source,
          status,
          observedValue: value,
          sourceReference: JSON.stringify(requirement),
          timestamp: new Date().toISOString(),
          reliability:
            status === "VERIFIED" || status === "CONTRADICTED" ? 1 : 0.5,
          limitations,
        };
      }),
    );
  }
}
export function requirementFiles(requirements: Requirement[]): string[] {
  return requirements.flatMap((r) => ("path" in r ? [r.path] : []));
}
