#!/usr/bin/env node
import { cp, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const destination = path.resolve(
  process.argv[2] ??
    path.join(
      process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
      "skills",
      "hallucheck",
    ),
);
try {
  await lstat(destination);
  throw new Error(
    "Skill destination already exists; choose a new directory or review the existing skill before replacing it",
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
await mkdir(path.dirname(destination), { recursive: true });
await cp(
  fileURLToPath(new URL("../plugins/codex/skills/hallucheck", import.meta.url)),
  destination,
  { recursive: true, errorOnExist: true, force: false },
);
console.log(
  `Installed HALLUCHECK skill at ${destination}. Keep halluc-check on PATH. Start a new Codex chat and invoke $hallucheck. To configure Jev, run halluc-check auth login in your own terminal.`,
);
