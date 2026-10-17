import { readFile, stat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hash, type Config, Lru } from "../../shared/src/index.js";
import { safePath, excluded } from "../../core/src/security/index.js";
const exec = promisify(execFile);
export async function git(root: string, args: string[]): Promise<string> {
  try {
    return (
      await exec("git", ["-C", root, ...args], {
        timeout: 3000,
        maxBuffer: 2_000_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      })
    ).stdout;
  } catch {
    return "";
  }
}
export interface RepositoryContext {
  root: string;
  snapshot: string;
  revision: string;
  changedFiles: string[];
  selectedFiles: string[];
  fileHashes: Record<string, string>;
  complete: boolean;
}
export class RepositoryAnalyzer {
  private fileIndex:
    | { files: string[]; at: number; directories: Map<string, string> }
    | undefined;
  private content = new Lru<string, { identity: string; digest: string }>(
    5000,
    3600000,
  );
  private discoveryComplete = true;
  invalidateIndex(): void {
    this.fileIndex = undefined;
  }
  close(): void {
    this.fileIndex = undefined;
  }
  constructor(
    readonly root: string,
    readonly config: Config,
  ) {}
  private async directoryIdentity(dir: string): Promise<string> {
    try {
      const s = await stat(dir, { bigint: true });
      return [s.ino, s.mtimeNs, s.ctimeNs].join(":");
    } catch {
      return "missing";
    }
  }
  private async directories(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const pending = [this.root];
    while (pending.length && result.size < 5000) {
      const dir = pending.pop()!;
      result.set(dir, await this.directoryIdentity(dir));
      try {
        for (const entry of await readdir(dir, { withFileTypes: true }))
          if (entry.isDirectory()) {
            const target = path.join(dir, entry.name);
            if (
              !excluded(
                path.relative(this.root, target),
                this.config.privacy.exclusions,
              )
            )
              pending.push(target);
          }
      } catch {
        this.discoveryComplete = false;
      }
    }
    if (pending.length) this.discoveryComplete = false;
    return result;
  }
  async files(changed = false): Promise<string[]> {
    if (!changed && this.fileIndex && Date.now() - this.fileIndex.at < 30000) {
      let valid = true;
      for (const [dir, identity] of this.fileIndex.directories)
        if ((await this.directoryIdentity(dir)) !== identity) {
          valid = false;
          break;
        }
      if (valid) return this.fileIndex.files;
    }
    let files: string[];
    if (changed) {
      const output = await git(this.root, [
        "diff",
        "--name-only",
        "-z",
        "HEAD",
      ]);
      const untracked = await git(this.root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
      files = (output + untracked).split("\0");
    } else {
      this.discoveryComplete = true;
      try {
        files = (
          await exec(
            "rg",
            [
              "--files",
              "--hidden",
              "--no-ignore",
              "-0",
              "-g",
              "!.git",
              "-g",
              "!node_modules",
              "-g",
              "!.hallucheck",
              "-g",
              "!dist",
            ],
            { cwd: this.root, timeout: 3000, maxBuffer: 2_000_000 },
          )
        ).stdout.split("\0");
      } catch (error) {
        if ((error as { code?: number }).code !== 1)
          this.discoveryComplete = false;
        files = [];
      }
    }
    const selected = [
      ...new Set(
        files.filter((f) => f && !excluded(f, this.config.privacy.exclusions)),
      ),
    ].sort();
    if (!changed)
      this.fileIndex = {
        files: selected,
        at: Date.now(),
        directories: await this.directories(),
      };
    return selected;
  }
  async context(selected: string[] = []): Promise<RepositoryContext> {
    const root = await realpath(this.root);
    const files = await this.files();
    let complete = this.discoveryComplete && files.length <= 5000;
    const hashes: Record<string, string> = {};
    for (const file of files.slice(0, 5000)) {
      try {
        const target = await safePath(
          root,
          file,
          this.config.privacy.exclusions,
        );
        const info = await stat(target, { bigint: true });
        if (info.size > 1_000_000n) {
          complete = false;
          continue;
        }
        const identity = [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(
          ":",
        );
        const previous = this.content.get(file);
        const digest =
          previous?.identity === identity
            ? previous.digest
            : hash(await readFile(target));
        this.content.set(file, { identity, digest });
        hashes[file] = digest;
      } catch {
        complete = false;
      }
    }
    const revision = (await git(root, ["rev-parse", "HEAD"])).trim();
    const changedFiles = (await git(root, ["diff", "--name-only", "HEAD"]))
      .trim()
      .split("\n")
      .filter(Boolean);
    const selectedFiles = selected.length
      ? selected
      : files.filter((f) => /\.[cm]?[jt]sx?$/.test(f)).slice(0, 64);
    return {
      root,
      snapshot: hash({ root, revision, hashes, complete }),
      revision,
      changedFiles,
      selectedFiles,
      fileHashes: hashes,
      complete,
    };
  }
  async text(file: string, maxBytes = 32000): Promise<string> {
    const target = await safePath(
      this.root,
      file,
      this.config.privacy.exclusions,
    );
    if ((await stat(target)).size > maxBytes)
      throw new Error("Context file too large");
    return readFile(target, "utf8");
  }
}
