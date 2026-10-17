import { build } from "esbuild";
import { mkdir, chmod } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    cli: "apps/cli/src/index.ts",
    daemon: "apps/daemon/src/main.ts",
    mcp: "apps/mcp-server/src/main.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
await chmod("bin/halluc-check.mjs", 0o755);
