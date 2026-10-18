import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const providerVariables = [
  "JEV_API_KEY",
  "TYPESAFE_API_KEY",
  "AI_GATEWAY_API_KEY",
  "JEV_BASE_URL",
  "JEV_MODEL",
  "JEV_TIMEOUT_MS",
  "HALLUCHECK_EXTERNAL_INFERENCE",
];

export function providerEnvironmentFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.HALLUCHECK_PROVIDER_ENV_FILE ??
    path.join(homedir(), ".config", "hallucheck", "jev.env")
  );
}

export async function readJevEnvironment(
  file = providerEnvironmentFile(),
): Promise<NodeJS.ProcessEnv | undefined> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Cannot open private Hallucheck provider environment file");
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > 16384 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error(
        "Hallucheck provider environment must be an owner-only regular file (chmod 600)",
      );
    return parseEnv(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

/** Owner-managed config for GUI hosts that don't inherit a terminal environment. */
export async function loadJevEnvironment(
  file = providerEnvironmentFile(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const values = await readJevEnvironment(file);
  if (!values) return;
  const hasEnvironmentKey = [
    "JEV_API_KEY",
    "TYPESAFE_API_KEY",
    "AI_GATEWAY_API_KEY",
  ].some((key) => env[key] !== undefined);
  for (const key of providerVariables) {
    // A shell-selected credential must not inherit a different credential's route/model.
    if (hasEnvironmentKey && key !== "HALLUCHECK_EXTERNAL_INFERENCE") continue;
    if (env[key] === undefined && values[key] !== undefined)
      env[key] = values[key];
  }
}
