#!/usr/bin/env node
import { cp, mkdir, writeFile, realpath, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const host = process.argv[2];
if (!["claude-code", "codex"].includes(host))
  throw new Error(
    "Usage: node bin/install-plugin.mjs claude-code|codex [destination]",
  );
const source = fileURLToPath(new URL(`../plugins/${host}`, import.meta.url));
const dest = path.resolve(process.argv[3] ?? `.hallucheck/plugins/${host}`);
try {
  await access(dest);
  throw new Error(
    "Destination exists; choose a new directory or uninstall the existing copy",
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(path.dirname(dest), { recursive: true });
await cp(source, dest, { recursive: true, errorOnExist: true, force: false });
await writeFile(
  path.join(dest, ".hallucheck-install"),
  JSON.stringify({ host, version: "0.1.0" }),
);
console.log(
  `Installed ${host} plugin files at ${dest}. Ensure halluc-check is on PATH. ${host === "claude-code" ? `Launch: claude --plugin-dir ${JSON.stringify(dest)}` : "Manually add this directory as a local plugin in Codex, then review and trust its hooks in /hooks."}`,
);
