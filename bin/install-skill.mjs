#!/usr/bin/env node
import { cp, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureAutoReview } from "../plugins/codex/skills/hallucheck/scripts/activate.mjs";

const args = process.argv.slice(2);
if (
  args.filter((arg) => arg !== "--manual").length > 1 ||
  args.some((arg) => arg.startsWith("--") && arg !== "--manual")
)
  throw new Error("Usage: node bin/install-skill.mjs [destination] [--manual]");
const automatic = !args.includes("--manual");
if (automatic) await configureAutoReview("status");

const destination = path.resolve(
  args.find((arg) => arg !== "--manual") ??
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
if (automatic) await configureAutoReview("enable");
console.log(
  `Installed HALLUCHECK skill at ${destination}. ${automatic ? "Enabled automatic reviews for substantial coding work and extensive answers; short replies and trivial edits are skipped." : "Manual invocation only; use $hallucheck."} Keep halluc-check on PATH and start a new Codex chat. To configure Jev, run halluc-check auth login in your own terminal.`,
);
