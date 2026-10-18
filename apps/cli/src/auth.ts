import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  credentialStatus,
  removeSavedCredential,
  saveTypesafeCredential,
  validateTypesafeKey,
} from "../../../packages/jev-provider/src/credentials.js";

/** Readline handles editing/paste; its entire terminal output is discarded. */
async function prompt(message: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error(
      "Run halluc-check auth login in your own interactive terminal. Never paste your API key into a chat, command argument, or piped input.",
    );
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output: hidden ? sink : process.stderr,
    terminal: true,
  });
  process.stderr.write(message);
  try {
    return await new Promise<string>((resolve, reject) => {
      let answered = false;
      rl.once("SIGINT", () =>
        reject(new Error("Key setup cancelled; nothing saved")),
      );
      rl.once("close", () => {
        if (!answered) reject(new Error("Key setup cancelled; nothing saved"));
      });
      rl.question("", (answer) => {
        answered = true;
        resolve(answer);
      });
    });
  } finally {
    rl.close();
    sink.end();
    if (hidden) process.stderr.write("\n");
  }
}

export async function auth(command: string | undefined): Promise<unknown> {
  if (command === "status") return credentialStatus();
  if (command === "logout")
    return {
      removed: await removeSavedCredential(),
      message:
        "Saved provider settings removed. This does not revoke the key at TypeSafe or clear shell variables. Restart running daemons and agent connections.",
    };
  if (command !== "login")
    throw new Error("Use halluc-check auth login | status | logout");
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error(
      "Run halluc-check auth login in your own interactive terminal. Never paste your API key into a chat, command argument, or piped input.",
    );
  const existing = await credentialStatus();
  if (
    existing.saved &&
    !/^y(es)?$/i.test(
      (await prompt("Replace the saved provider settings? [y/N] ")).trim(),
    )
  )
    return { saved: false, message: "Existing settings kept." };
  process.stderr.write(
    "Get your direct TypeSafe key at https://console.typesafe.ai. Entry is hidden. No API request is sent by setup.\n",
  );
  const key = validateTypesafeKey(
    await prompt("TypeSafe / Jev API key (hidden): ", true),
  );
  const consent = await prompt(
    "Allow HALLUCHECK to send redacted, bounded claim/evidence summaries to TypeSafe for Jev inference? Provider charges may apply. [y/N] ",
  );
  const enabled = /^y(es)?$/i.test(consent.trim());
  await saveTypesafeCredential(key, enabled);
  return {
    saved: true,
    provider: "TypeSafe",
    file: existing.file,
    externalInference: enabled,
    liveConnectionTested: false,
    message:
      "Saved in an owner-only local file (not encrypted). Restart running daemons and agent connections. To send one synthetic connection test, run halluc-check doctor --jev.",
  };
}
