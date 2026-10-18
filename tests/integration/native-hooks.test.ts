import { it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { handleHook } from "../../packages/integrations/claude-code/src/index.js";
import { Engine } from "../../packages/core/src/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it.each(["codex", "claude-code"] as const)(
  "instructs the agent to review every ordinary %s task against the actual project",
  async (host) => {
    const root = await mkdtemp(path.join(tmpdir(), "hc-prompt-"));
    roots.push(root);
    const output = await handleHook(
      host,
      {
        session_id: "ordinary",
        cwd: root,
        hook_event_name: "UserPromptSubmit",
        prompt: "Please update the readme.",
      },
      root,
    );
    expect(output).not.toHaveProperty("decision");
    const text = JSON.stringify(output);
    expect(text).toContain("Before the final response");
    expect(text).toContain(root);
    expect(text).toContain("review-task");
    expect(text).toContain("UNSUPPORTED");
  },
);
it.each(["codex", "claude-code"] as const)(
  "runs %s warning -> user fix -> same-session edit -> automatic verification through real hook formats",
  async (host) => {
    const root = await mkdtemp(path.join(tmpdir(), "hc-hooks-"));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(
      path.join(root, "api.ts"),
      'export const value:number="bad";',
    );
    const session = { session_id: "same-session", cwd: root };
    const warning = await handleHook(
      host,
      {
        ...session,
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(root, "api.ts") },
        tool_response: {},
      },
      root,
    );
    expect(JSON.stringify(warning)).toContain("hallucheck fix");
    expect(warning).not.toHaveProperty("decision");
    let engine = await Engine.open(root);
    const finding = engine.store
      .findings(engine.root)
      .find((f) => f.status === "CONTRADICTED")!;
    engine.close();
    const choice = await handleHook(
      host,
      {
        ...session,
        hook_event_name: "UserPromptSubmit",
        prompt: `hallucheck fix ${finding.id}`,
      },
      root,
    );
    expect(JSON.stringify(choice)).toContain("Independent evidence");
    expect(JSON.stringify(choice)).toContain("same-session");
    await writeFile(path.join(root, "api.ts"), "export const value:number=1;");
    const recheck = await handleHook(
      host,
      {
        ...session,
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: path.join(root, "api.ts") },
        tool_response: {},
      },
      root,
    );
    expect(JSON.stringify(recheck)).toContain("VERIFIED");
    engine = await Engine.open(root);
    expect(engine.store.lifecycle(finding.id)?.state).toBe("VERIFIED");
    engine.close();
  },
);
it("indicator-only warnings never return a blocking or repair instruction, and native flags persist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hc-indicator-"));
  roots.push(root);
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(
    path.join(root, "api.ts"),
    'export const value:number="bad";',
  );
  const input = { session_id: "same", cwd: root };
  await handleHook(
    "codex",
    {
      ...input,
      hook_event_name: "UserPromptSubmit",
      prompt: "hallucheck settings INDICATOR_ONLY",
    },
    root,
  );
  const output = await handleHook(
    "codex",
    {
      ...input,
      hook_event_name: "Stop",
      last_assistant_message: "Done.",
      stop_hook_active: false,
    },
    root,
  );
  expect(output).not.toHaveProperty("decision");
  expect(JSON.stringify(output)).toContain("Indicator only");
  const engine = await Engine.open(root);
  const finding = engine.store
    .findings(engine.root)
    .find((f) => f.status === "CONTRADICTED")!;
  engine.close();
  await handleHook(
    "codex",
    {
      ...input,
      hook_event_name: "UserPromptSubmit",
      prompt: `hallucheck flag ${finding.id}`,
    },
    root,
  );
  const listing = await handleHook(
    "codex",
    {
      ...input,
      hook_event_name: "UserPromptSubmit",
      prompt: "hallucheck findings",
    },
    root,
  );
  expect(JSON.stringify(listing)).toContain("FLAGGED");
});
