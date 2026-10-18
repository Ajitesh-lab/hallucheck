import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  credentialStatus,
  removeSavedCredential,
  saveTypesafeCredential,
  validateTypesafeKey,
} from "../packages/jev-provider/src/credentials.js";
import { loadJevEnvironment } from "../packages/jev-provider/src/environment.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "hc-auth-"));
  roots.push(root);
  return { root, file: path.join(root, "private", "jev.env") };
}
it("saves a loadable key with private permissions, defaults to inference off and never includes it in status", async () => {
  const { file } = await fixture();
  const key = "test-typesafe-private-key";
  await saveTypesafeCredential(key, false, file);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  const env: NodeJS.ProcessEnv = {};
  await loadJevEnvironment(file, env);
  expect(env.TYPESAFE_API_KEY).toBe(key);
  expect(env.HALLUCHECK_EXTERNAL_INFERENCE).toBe("0");
  const status = await credentialStatus(file);
  expect(status).toMatchObject({
    saved: true,
    provider: "TypeSafe",
    externalInference: false,
    liveConnectionTested: false,
  });
  expect(JSON.stringify(status)).not.toContain(key);
  expect(await readdir(path.dirname(file))).toEqual(["jev.env"]);
});
it("replaces previous provider routing atomically and persists an explicit inference opt-in", async () => {
  const { file } = await fixture();
  await mkdir(path.dirname(file), { mode: 0o700 });
  await writeFile(
    file,
    "AI_GATEWAY_API_KEY=vck_test_old\nJEV_BASE_URL=https://example.invalid\nJEV_MODEL=old\n",
    { mode: 0o600 },
  );
  await saveTypesafeCredential("test-typesafe-new-key", true, file);
  const env: NodeJS.ProcessEnv = {};
  await loadJevEnvironment(file, env);
  expect(env).toEqual({
    TYPESAFE_API_KEY: "test-typesafe-new-key",
    HALLUCHECK_EXTERNAL_INFERENCE: "1",
  });
});
it("refuses symlink targets and shared files without modifying their contents", async () => {
  const { root, file } = await fixture();
  await mkdir(path.dirname(file), { mode: 0o700 });
  const target = path.join(root, "target");
  await writeFile(target, "original", { mode: 0o600 });
  await symlink(target, file);
  await expect(
    saveTypesafeCredential("test-typesafe-key", true, file),
  ).rejects.toThrow("Cannot open");
  await expect(removeSavedCredential(file)).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe("original");
  await rm(file);
  await writeFile(file, "original", { mode: 0o644 });
  await expect(
    saveTypesafeCredential("test-typesafe-key", true, file),
  ).rejects.toThrow("owner-only");
  expect(await readFile(file, "utf8")).toBe("original");
});
it("refuses a shared or symlinked credential directory", async () => {
  const { root, file } = await fixture();
  await mkdir(path.dirname(file), { mode: 0o755 });
  await expect(
    saveTypesafeCredential("test-typesafe-key", false, file),
  ).rejects.toThrow("directory");
  await rm(path.dirname(file), { recursive: true });
  const target = path.join(root, "target");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, path.dirname(file));
  await expect(
    saveTypesafeCredential("test-typesafe-key", false, file),
  ).rejects.toThrow("symlink");
});
it("refuses credentials inside a Git worktree even when a custom file was requested", async () => {
  const { root, file } = await fixture();
  await writeFile(path.join(root, ".git"), "gitdir: somewhere\n");
  await expect(
    saveTypesafeCredential("test-typesafe-key", false, file),
  ).rejects.toThrow("outside a Git worktree");
  await expect(stat(file)).rejects.toThrow();
});
it("removes only the saved config and handles an absent config", async () => {
  const { file } = await fixture();
  expect(await removeSavedCredential(file)).toBe(false);
  await saveTypesafeCredential("test-typesafe-key", false, file);
  expect(await removeSavedCredential(file)).toBe(true);
  expect(await credentialStatus(file)).toMatchObject({
    saved: false,
    provider: "none",
  });
});
it.each([
  "tiny",
  "test-key\nINJECTED=1",
  'test-key"bad',
  "test-key#bad",
  "vck_wrong_provider",
])("rejects unsafe or wrong-provider key input without echoing it", (key) => {
  try {
    validateTypesafeKey(key);
    throw new Error("Expected key rejection");
  } catch (error) {
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).not.toBe("Expected key rejection");
  }
});
