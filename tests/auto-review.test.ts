import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleHook } from "../packages/integrations/claude-code/src/index.js";
import { Engine } from "../packages/core/src/index.js";
const exec = promisify(execFile);
const activation = path.resolve(
  "plugins/codex/skills/hallucheck/scripts/activate.mjs",
);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "hc-auto-"));
  roots.push(root);
  return root;
}
async function configure(root: string, mode: string) {
  return JSON.parse(
    (
      await exec(process.execPath, [activation, mode], {
        env: { ...process.env, CODEX_HOME: root },
      })
    ).stdout,
  );
}

it("activates large-task reviews idempotently, preserves existing instructions, and can remove only its block", async () => {
  const root = await fixture(),
    file = path.join(root, "AGENTS.md");
  const original = "# My instructions\nKeep my existing preferences.\n";
  await writeFile(file, original);
  expect((await configure(root, "status")).enabled).toBe(false);
  expect((await configure(root, "enable")).enabled).toBe(true);
  const installed = await readFile(file, "utf8");
  expect(installed.startsWith(original)).toBe(true);
  expect(installed).toContain("Skip greetings");
  await configure(root, "enable");
  expect(await readFile(file, "utf8")).toBe(installed);
  expect((await readdir(root)).filter((f) => f.includes("backup")).length).toBe(
    1,
  );
  expect((await configure(root, "disable")).enabled).toBe(false);
  expect(await readFile(file, "utf8")).toBe(original);
});
it("does not create config while reading status and refuses symlinks or malformed managed blocks", async () => {
  const root = await fixture();
  await configure(root, "status");
  expect(await readdir(root)).toEqual([]);
  const target = path.join(root, "other");
  await writeFile(target, "original");
  await symlink(target, path.join(root, "AGENTS.md"));
  await expect(configure(root, "enable")).rejects.toThrow("Cannot safely open");
  expect(await readFile(target, "utf8")).toBe("original");
  await rm(path.join(root, "AGENTS.md"));
  const invalid = "<!-- hallucheck:large-review:start -->\nunfinished";
  await writeFile(path.join(root, "AGENTS.md"), invalid);
  await expect(configure(root, "enable")).rejects.toThrow("Malformed");
  expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(invalid);
});
it("supports manual-only installation and activating a downloaded skill without copying it again", async () => {
  const root = await fixture(),
    home = path.join(root, "config"),
    dest = path.join(root, "skill");
  const env = { ...process.env, CODEX_HOME: home };
  await exec(process.execPath, ["bin/install-skill.mjs", dest, "--manual"], {
    env,
  });
  await expect(readFile(path.join(home, "AGENTS.md"))).rejects.toThrow();
  await exec(
    process.execPath,
    [path.join(dest, "scripts", "activate.mjs"), "enable"],
    { env },
  );
  expect(await readFile(path.join(home, "AGENTS.md"), "utf8")).toContain(
    "substantive coding work",
  );
});

async function begin(root: string, session: string, prompt: string) {
  await handleHook(
    "codex",
    {
      session_id: session,
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      prompt,
    },
    root,
  );
}
async function stop(root: string, session: string, text: string) {
  return handleHook(
    "codex",
    {
      session_id: session,
      cwd: root,
      hook_event_name: "Stop",
      last_assistant_message: text,
      stop_hook_active: false,
    },
    root,
  );
}
async function auditCount(root: string, kind: string) {
  const engine = await Engine.open(root);
  try {
    return Number(
      (
        engine.store.db
          .prepare("SELECT count(*) AS total FROM audit WHERE kind=?")
          .get(kind) as { total: number }
      ).total,
    );
  } finally {
    engine.close();
  }
}
it("skips short follow-ups even when source was already dirty before this task", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "api.ts"),
    'export const value:number="old error";',
  );
  await begin(root, "short", "Thanks, what is its name?");
  expect(await stop(root, "short", "It is HALLUCHECK.")).toEqual({});
  expect(await auditCount(root, "task-review")).toBe(0);
  expect(await auditCount(root, "auto-review-skipped")).toBe(1);
});
it("automatically reviews actual source changes and resets the baseline for the next small request", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "api.ts"), "export const value=1;");
  await begin(root, "code", "Implement the change.");
  await writeFile(
    path.join(root, "api.ts"),
    'export const value:number="broken";',
  );
  expect(JSON.stringify(await stop(root, "code", "Implemented."))).toContain(
    "CONTRADICTED",
  );
  expect(await auditCount(root, "task-review")).toBe(1);
  await begin(root, "code", "ok thanks");
  expect(await stop(root, "code", "You're welcome.")).toEqual({});
  expect(await auditCount(root, "task-review")).toBe(1);
});
it("reviews extensive answers and large requests without code changes, while trivial README edits stay quiet", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "README.md"), "original");
  await begin(root, "info", "Explain the approach.");
  await stop(root, "info", "Detailed factual explanation. ".repeat(100));
  expect(await auditCount(root, "task-review")).toBe(1);
  await begin(root, "info", "Detailed request. ".repeat(150));
  await stop(root, "info", "Completed the report.");
  expect(await auditCount(root, "task-review")).toBe(2);
  await begin(root, "info", "Fix one typo.");
  await writeFile(path.join(root, "README.md"), "fixed typo");
  expect(await stop(root, "info", "Fixed.")).toEqual({});
  expect(await auditCount(root, "task-review")).toBe(2);
});
it("honors an explicit review request for a small task", async () => {
  const root = await fixture();
  await begin(root, "explicit", "hallucheck review this answer");
  await stop(root, "explicit", "The answer is correct.");
  expect(await auditCount(root, "task-review")).toBe(1);
});
