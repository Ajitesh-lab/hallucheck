import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { providerEnvironmentFile, readJevEnvironment } from "./environment.js";

export function validateTypesafeKey(input: string): string {
  const key = input.trim();
  if (key.length < 8 || key.length > 4096 || /[^\x21-\x7e]|["'\\#]/.test(key))
    throw new Error(
      "Enter the complete, single-line TypeSafe API key without quotes",
    );
  if (key.startsWith("vck_"))
    throw new Error(
      "This is a Vercel Gateway key. Use a TypeSafe-issued key from console.typesafe.ai; Gateway keys use AI_GATEWAY_API_KEY instead.",
    );
  return key;
}

async function privateParent(file: string): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error(
      "Credential directory must be an owner-only directory (chmod 700), not a symlink",
    );
  let ancestor = await realpath(dir);
  while (true) {
    let repository = false;
    try {
      await lstat(path.join(ancestor, ".git"));
      repository = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (repository)
      throw new Error(
        "Credential file must be outside a Git worktree. Unset HALLUCHECK_PROVIDER_ENV_FILE to use the private user configuration directory.",
      );
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
}

/** Write only a direct TypeSafe credential, atomically, without touching project files. */
export async function saveTypesafeCredential(
  input: string,
  allowExternalInference: boolean,
  file = providerEnvironmentFile(),
): Promise<void> {
  const key = validateTypesafeKey(input);
  await privateParent(file);
  await readJevEnvironment(file); // Refuse an unsafe existing target before replacing it.
  const temporary = path.join(path.dirname(file), `.jev-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(
      `TYPESAFE_API_KEY=${key}\nHALLUCHECK_EXTERNAL_INFERENCE=${allowExternalInference ? "1" : "0"}\n`,
      "utf8",
    );
    await handle.sync();
    await handle.close();
    // Recheck to avoid replacing a symlink introduced while input was being saved.
    await readJevEnvironment(file);
    await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function credentialStatus(file = providerEnvironmentFile()) {
  const values = await readJevEnvironment(file);
  const direct = !!(values?.JEV_API_KEY || values?.TYPESAFE_API_KEY);
  return {
    saved: direct || !!values?.AI_GATEWAY_API_KEY,
    provider: direct
      ? "TypeSafe"
      : values?.AI_GATEWAY_API_KEY
        ? "Vercel AI Gateway"
        : "none",
    file,
    externalInference: values?.HALLUCHECK_EXTERNAL_INFERENCE === "1",
    environmentOverrides: [
      "JEV_API_KEY",
      "TYPESAFE_API_KEY",
      "AI_GATEWAY_API_KEY",
    ].some((name) => process.env[name] !== undefined),
    liveConnectionTested: false,
  };
}

export async function removeSavedCredential(
  file = providerEnvironmentFile(),
): Promise<boolean> {
  const values = await readJevEnvironment(file);
  if (!values) return false;
  await unlink(file);
  return true;
}
