import { realpath } from "node:fs/promises";
import path from "node:path";
import { EventSchema, type AgentEvent } from "../../../shared/src/index.js";
export async function normalizeEvent(
  input: unknown,
  root?: string,
): Promise<AgentEvent> {
  const event = EventSchema.parse(input);
  const originalRoot = path.resolve(event.repositoryRoot);
  const relative = (file: string): string =>
    path.isAbsolute(file) ? path.relative(originalRoot, file) : file;
  event.filePaths = event.filePaths.map(relative);
  for (const claim of event.claims) {
    claim.relatedFiles = claim.relatedFiles.map(relative);
    claim.requiredEvidence = claim.requiredEvidence.map((requirement) =>
      "path" in requirement
        ? { ...requirement, path: relative(requirement.path) }
        : requirement,
    );
  }
  event.repositoryRoot = await realpath(event.repositoryRoot);
  if (root && event.repositoryRoot !== (await realpath(root)))
    throw new Error("Repository identity mismatch");
  return event;
}
