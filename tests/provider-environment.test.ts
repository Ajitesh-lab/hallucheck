import { it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadJevEnvironment } from "../packages/jev-provider/src/environment.js";
import { redact } from "../packages/core/src/security/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(mode = 0o600) {
  const root = await mkdtemp(path.join(tmpdir(), "hc-provider-env-"));
  roots.push(root);
  const file = path.join(root, "jev.env");
  await writeFile(
    file,
    "AI_GATEWAY_API_KEY=vck_test_private_key\nJEV_MODEL=typesafe-ai/jev\nHALLUCHECK_EXTERNAL_INFERENCE=1\nNODE_OPTIONS=--inspect\n",
    { mode },
  );
  return file;
}
it("loads only provider settings from a private file for GUI processes", async () => {
  const env: NodeJS.ProcessEnv = {};
  await loadJevEnvironment(await fixture(), env);
  expect(env.AI_GATEWAY_API_KEY).toBe("vck_test_private_key");
  expect(env.HALLUCHECK_EXTERNAL_INFERENCE).toBe("1");
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(redact("token vck_test_private_key")).not.toContain(
    "vck_test_private_key",
  );
});
it("preserves shell credentials, model and explicit privacy opt-out", async () => {
  const env: NodeJS.ProcessEnv = {
    TYPESAFE_API_KEY: "direct-test-key",
    HALLUCHECK_EXTERNAL_INFERENCE: "0",
    JEV_MODEL: "jev-latest",
  };
  await loadJevEnvironment(await fixture(), env);
  expect(env.AI_GATEWAY_API_KEY).toBeUndefined();
  expect(env.JEV_MODEL).toBe("jev-latest");
  expect(env.HALLUCHECK_EXTERNAL_INFERENCE).toBe("0");
});
it("rejects shared files and symlinks and tolerates an absent config", async () => {
  const file = await fixture(0o644);
  await expect(loadJevEnvironment(file, {})).rejects.toThrow("owner-only");
  const link = file + ".link";
  await symlink(file, link);
  await expect(loadJevEnvironment(link, {})).rejects.toThrow("Cannot open");
  await expect(
    loadJevEnvironment(file + ".missing", {}),
  ).resolves.toBeUndefined();
});
