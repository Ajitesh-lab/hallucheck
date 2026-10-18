import type { TaskBaseline } from "../../../storage/src/index.js";
import type { RepositoryContext } from "../../../repository-analyzer/src/index.js";

export function sourceFile(file: string): boolean {
  return (
    /\.(?:[cm]?[jt]sx?|py|go|rs|swift|kt|java|c|cpp|h|cs|rb|php|css|scss|html|sql|sh)$/i.test(
      file,
    ) ||
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|Cargo\.toml|go\.mod|pyproject\.toml)$/.test(
      file,
    )
  );
}
export function extensiveText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= 2000 || trimmed.split(/\s+/).filter(Boolean).length >= 350
  );
}
export function taskBaseline(
  context: RepositoryContext,
  prompt: string,
): TaskBaseline {
  return {
    fileHashes: Object.fromEntries(
      Object.entries(context.fileHashes).filter(([file]) => sourceFile(file)),
    ),
    extensiveRequest: extensiveText(prompt),
    explicitReview:
      /\bhallucheck\b|\bhallucination\s+(?:check|review)\b|\bcode review\b|\breview\b.{0,80}\b(?:code|changes|implementation|diff)\b/i.test(
        prompt,
      ),
    timestamp: new Date().toISOString(),
  };
}
export function shouldReviewTask(
  context: RepositoryContext,
  text: string,
  baseline?: TaskBaseline,
): boolean {
  if (
    extensiveText(text) ||
    baseline?.extensiveRequest ||
    baseline?.explicitReview
  )
    return true;
  if (!baseline || !context.complete)
    return context.selectedFiles.some(sourceFile) || !context.complete;
  const current = Object.fromEntries(
    Object.entries(context.fileHashes).filter(([file]) => sourceFile(file)),
  );
  return Object.keys({ ...baseline.fileHashes, ...current }).some(
    (file) => current[file] !== baseline.fileHashes[file],
  );
}
