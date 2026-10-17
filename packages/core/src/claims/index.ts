import {
  type AgentEvent,
  type Claim,
  hash,
} from "../../../shared/src/index.js";
export function extractClaims(event: AgentEvent): Claim[] {
  const inputs = event.claims.length
    ? event.claims
    : event.text
      ? [
          {
            statement: event.text,
            category: "UNKNOWN" as const,
            relatedFiles: event.filePaths,
            requiredEvidence: [],
          },
        ]
      : [];
  const unique = new Map<string, Claim>();
  for (const input of inputs) {
    const key = hash({
      statement: input.statement,
      requiredEvidence: input.requiredEvidence,
      relatedFiles: input.relatedFiles,
    });
    unique.set(key, {
      ...input,
      id: key,
      sourceEventId: event.eventId,
      extractionMethod: input.requiredEvidence.length
        ? "structured"
        : "limited",
    });
  }
  return [...unique.values()];
}
