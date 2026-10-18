import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Engine } from "../../../packages/core/src/index.js";

// A plugin's working directory is its installation, not the user's workspace.
export function workspaceEngines(server: McpServer, pinnedRoot?: string) {
  const engines = new Map<string, Promise<Engine>>();
  async function resolve(requestedRoot?: string): Promise<string> {
    if (requestedRoot && !path.isAbsolute(requestedRoot))
      throw new Error("repositoryRoot must be an absolute workspace path");
    const pinned = pinnedRoot ? await realpath(pinnedRoot) : undefined;
    let root = requestedRoot ? await realpath(requestedRoot) : pinned;
    if (pinned && root !== pinned)
      throw new Error(
        "Repository identity mismatch: server is pinned with --root",
      );
    if (!pinned && server.server.getClientCapabilities()?.roots) {
      const response = await server.server.listRoots({}, { timeout: 5000 });
      const roots = await Promise.all(
        response.roots.map(async (entry) =>
          entry.uri.startsWith("file:")
            ? realpath(fileURLToPath(entry.uri))
            : undefined,
        ),
      );
      const local = [...new Set(roots.filter((r): r is string => !!r))];
      if (root && !local.includes(root))
        throw new Error(
          "repositoryRoot is outside the client's advertised workspace roots",
        );
      if (!root && local.length === 1) root = local[0];
      if (!root)
        throw new Error(
          "Pass repositoryRoot to select one of the client's workspace roots",
        );
    }
    if (!root) {
      const cwd = await realpath(process.cwd());
      let plugin = false;
      for (const manifest of [
        "plugin.json",
        ".codex-plugin/plugin.json",
        ".claude-plugin/plugin.json",
      ]) {
        try {
          plugin ||=
            JSON.parse(await readFile(path.join(cwd, manifest), "utf8"))
              .name === "hallucheck";
        } catch {}
      }
      if (plugin)
        throw new Error(
          "No workspace selected. Pass repositoryRoot with the active project's absolute path; the plugin installation is not a project.",
        );
      root = cwd;
    }
    if (!(await stat(root)).isDirectory())
      throw new Error("repositoryRoot must be a directory");
    return root;
  }
  return {
    async get(requestedRoot?: string): Promise<Engine> {
      const root = await resolve(requestedRoot);
      let engine = engines.get(root);
      if (!engine) {
        if (engines.size >= 16)
          throw new Error("Workspace limit reached; reconnect the MCP server");
        engine = Engine.open(root);
        engines.set(root, engine);
        engine.catch(() => engines.delete(root));
      }
      return engine;
    },
    close() {
      for (const engine of engines.values())
        void engine.then(
          (e) => e.close(),
          () => {},
        );
      engines.clear();
    },
  };
}
