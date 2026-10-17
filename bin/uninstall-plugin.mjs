#!/usr/bin/env node
import { readFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
const dest = path.resolve(process.argv[2] ?? "");
if (
  !process.argv[2] ||
  dest === path.parse(dest).root ||
  dest === process.cwd()
)
  throw new Error("Provide the exact installed plugin directory");
if ((await lstat(dest)).isSymbolicLink())
  throw new Error("Symlink destination denied");
const marker = JSON.parse(
  await readFile(path.join(dest, ".hallucheck-install"), "utf8"),
);
if (
  !["claude-code", "codex"].includes(marker.host) ||
  marker.version !== "0.1.0"
)
  throw new Error("Not a HALLUCHECK installed plugin");
await rm(dest, { recursive: true });
console.log(
  `Removed ${dest}. Remove/disable this plugin in the host and restart its session.`,
);
