import { realpath, lstat, mkdir, chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema, type Config } from "../../../shared/src/index.js";
const inside = (root: string, target: string): boolean =>
  target === root || target.startsWith(root + path.sep);
export function excluded(
  file: string,
  patterns: string[],
  allowDependencies = false,
): boolean {
  const normalized = file.split(path.sep).join("/");
  return (
    normalized
      .split("/")
      .some((p) =>
        [
          ".git",
          ...(allowDependencies ? [] : ["node_modules"]),
          ".hallucheck",
          "dist",
        ].includes(p),
      ) ||
    patterns.some(
      (p) =>
        path.matchesGlob(normalized, p) ||
        path.matchesGlob(path.basename(normalized), p),
    )
  );
}
export async function safePath(
  root: string,
  file: string,
  patterns: string[] = [],
): Promise<string> {
  const canonical = await realpath(root);
  const target = path.resolve(canonical, file);
  if (
    !inside(canonical, target) ||
    excluded(path.relative(canonical, target), patterns)
  )
    throw new Error("Path denied or excluded");
  let cursor = target;
  while (true) {
    try {
      const actual = await realpath(cursor);
      if (!inside(canonical, actual))
        throw new Error("Symlink escapes repository");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw e;
      cursor = parent;
    }
  }
  return target;
}
export function redact(text: string): string {
  let result = text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  for (const [key, value] of Object.entries(process.env))
    if (
      value &&
      value.length >= 6 &&
      /key|token|secret|password|credential|auth/i.test(key)
    )
      result = result.split(value).join("[REDACTED]");
  result = result
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED JWT]",
    );
  return result
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{10,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(
      /((?:[\w-]*(?:secret|token|password|api[_-]?key|credential)[\w-]*)\s*[=:]\s*)(["']?)[^\s,"';}\n]+\2/gi,
      "$1[REDACTED]",
    );
}
export function sanitize<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => sanitize(v)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /secret|token|password|credential|api[_-]?key/i.test(k)
          ? "[REDACTED]"
          : sanitize(v),
      ]),
    ) as T;
  return value;
}
export async function privateDirectory(dir: string): Promise<void> {
  try {
    if ((await lstat(dir)).isSymbolicLink())
      throw new Error("State directory must not be a symlink");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
export async function loadConfig(root: string): Promise<Config> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(
      await readFile(await safePath(root, "hallucheck.config.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const config = ConfigSchema.parse(raw);
  if (process.env.JEV_MODEL) config.model = process.env.JEV_MODEL;
  if (process.env.HALLUCHECK_EXTERNAL_INFERENCE !== undefined)
    config.privacy.allowExternalInference =
      process.env.HALLUCHECK_EXTERNAL_INFERENCE === "1";
  if (process.env.HALLUCHECK_OFFLINE === "1") config.provider = "offline";
  return config;
}
/** A stricter outbound-only pass: never includes nontrivial process environment values. */
export function sanitizeExternal<T>(value: T): T {
  const safe = sanitize(value);
  const strings = Object.values(process.env)
    .filter((v): v is string => !!v && v.length >= 4)
    .sort((a, b) => b.length - a.length);
  const visit = (item: unknown): unknown =>
    typeof item === "string"
      ? strings.reduce(
          (text, secret) => text.split(secret).join("[REDACTED ENV]"),
          item,
        )
      : Array.isArray(item)
        ? item.map(visit)
        : item && typeof item === "object"
          ? Object.fromEntries(
              Object.entries(item).map(([key, val]) => [key, visit(val)]),
            )
          : item;
  return visit(safe) as T;
}
