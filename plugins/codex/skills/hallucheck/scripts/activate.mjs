#!/usr/bin/env node
import { constants } from "node:fs";
import {
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const start = "<!-- hallucheck:large-review:start -->";
const end = "<!-- hallucheck:large-review:end -->";
const policy = `${start}
## HALLUCHECK: automatic reviews for substantial work

Automatically use the HALLUCHECK skill before finishing substantive coding work,
debugging, a meaningful code review, or an extensive factual answer, report or
explanation with material claims. Review major milestones on large tasks too.
Skip greetings, acknowledgements, short follow-ups, simple factual answers, and
trivial typo/formatting changes. An explicit user request for a HALLUCHECK review
still runs a check regardless of task size. Judge the work actually performed,
not just the length of the user's prompt.

For a qualifying task, run halluc-check review-task --root /absolute/active/project
--json with JSON on stdin containing truthful completion text, optional specific
claims with requiredEvidence, and relevant filePaths. Require an actual result
with eventId and findings; never say a check ran based only on your own assertion
or a previous task's result. Inspect contradictions within the authorized task.
If the check fails, disclose that the affected work remains unverified. Do not
silently skip it. UNSUPPORTED and NOT_CHECKED are not verified success.

For specific material unresolved claims, append the skill's brief HALLUCHECK note
at the end. Use a percentage only from a current real Jev incorrectRisk estimate,
labeled uncalibrated; otherwise say unverified. Never invent percentages or warn
about the whole task merely because its broad completion prose is NOT_CHECKED.
This is agent-followed guidance, not proof of full correctness or a trusted hook.
Preserve normal host permissions and existing repair settings.
${end}
`;

/** @param {unknown} error */
function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} file */
async function read(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (missing(error)) return { exists: false, text: "", mode: 0o600 };
    throw new Error(
      "Cannot safely open AGENTS.md; automatic review was not changed",
    );
  }
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > 1_000_000 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error("AGENTS.md must be a user-owned regular file under 1 MB");
    return {
      exists: true,
      text: await handle.readFile("utf8"),
      mode: info.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

/** @param {string} text @param {boolean} enabled */
function replaceBlock(text, enabled) {
  const starts = text.split(start).length - 1,
    ends = text.split(end).length - 1;
  if (
    starts !== ends ||
    starts > 1 ||
    (starts && text.indexOf(end) < text.indexOf(start))
  )
    throw new Error(
      "Malformed HALLUCHECK policy markers; existing instructions were not changed",
    );
  let original = text;
  if (starts) {
    let from = text.indexOf(start),
      to = text.indexOf(end) + end.length;
    if (text.slice(from - 2, from) === "\n\n") from -= 2;
    if (text[to] === "\n") to++;
    original = text.slice(0, from) + text.slice(to);
  }
  return enabled ? original + "\n\n" + policy : original;
}

/** @param {string} command @param {string} [directory] */
export async function configureAutoReview(
  command = "enable",
  directory = process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
) {
  if (!["enable", "status", "disable"].includes(command))
    throw new Error("Use auto-review enable | status | disable");
  const file = path.join(directory, "AGENTS.md");
  const old = await read(file);
  const next = replaceBlock(old.text, command === "enable");
  if (command !== "status" && next !== old.text) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (old.exists)
      await writeFile(`${file}.hallucheck-backup-${randomUUID()}`, old.text, {
        flag: "wx",
        mode: 0o600,
      });
    const temporary = `${file}.hallucheck-${randomUUID()}.tmp`;
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      old.mode,
    );
    try {
      await handle.writeFile(next, "utf8");
      await handle.sync();
      await handle.close();
      const current = await read(file);
      if (current.exists !== old.exists || current.text !== old.text)
        throw new Error(
          "AGENTS.md changed concurrently; automatic review was not changed",
        );
      await rename(temporary, file);
    } finally {
      await handle.close();
      await unlink(temporary).catch((error) => {
        if (!missing(error)) throw error;
      });
    }
  }
  const current = await read(file);
  const enabled = current.text.includes(start);
  return {
    enabled,
    scope: "substantial-tasks",
    agentsFile: file,
    enforcement: "agent-instructions",
    hooksInstalled: false,
    message: enabled
      ? "Substantial coding work and extensive answers are reviewed automatically by agent instructions; brief replies and trivial edits are skipped. No hook trust or API access was granted. Start a new chat to load changed instructions."
      : "The managed substantial-task policy is disabled. Existing manual instructions and plugin hooks are unchanged. Enabling grants neither hook trust nor API access.",
  };
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(
        await configureAutoReview(process.argv[2] ?? "enable"),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Automatic review setup failed",
    );
    process.exitCode = 1;
  }
}
