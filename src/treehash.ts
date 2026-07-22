// Responsibility: working-tree fingerprint for the attempts cache (ADR-0004). All git interaction lives here.
// Must NOT know about: workflow.yaml, state semantics, gate execution, routing.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function treeHash(cwd: string): string | null {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  // `git status --porcelain` paths are relative to the git top-level, not cwd. When
  // .headsign/ sits in a subdirectory of a larger repo (cwd != top-level), joining those
  // paths against cwd resolves to nonexistent files, so every entry hashes as
  // "unreadable" and content changes stop moving the hash. Resolve the real top-level
  // once, falling back to cwd on failure (matches the pre-fix behavior; correctness over
  // economy per ADR-0004).
  const gitRoot = tryOr(
    () => execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
    cwd,
  );
  return tryOr(() => sha256([revParseHead(cwd), ...statusEntries(cwd, gitRoot), ...headsignEntries(cwd)].join("\n")), null);
}

function revParseHead(cwd: string): string {
  // A repo with no commits yet is still a valid, hashable state.
  return tryOr(
    () => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
    "no-head",
  );
}

function statusEntries(cwd: string, gitRoot: string): string[] {
  // git's --show-toplevel prints the physical (symlink-resolved) path — e.g. macOS
  // resolves /var -> /private/var — while cwd as received may still spell the symlinked
  // form. Resolve cwd the same way so the exclusion check below reliably compares two
  // paths to the same file instead of two different spellings of it.
  const realCwd = tryOr(() => fs.realpathSync(cwd), cwd);
  const excluded = new Set([path.join(realCwd, ".headsign", "state.json"), path.join(realCwd, ".headsign", "lock")]);
  const lines = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.length > 0)
    .sort();
  const entries: string[] = [];
  for (const line of lines) {
    const arrow = line.indexOf(" -> ");
    const filePath = arrow >= 0 ? line.slice(arrow + 4) : line.slice(3);
    const absPath = path.join(gitRoot, filePath);
    // Exclude headsign's own transient files unconditionally, not just when .gitignore
    // happens to cover them: headsign rewrites state.json and locks/unlocks lock on every
    // evaluation, so including them would self-invalidate the cache.
    if (excluded.has(absPath)) continue;
    const deleted = line[0] === "D" || line[1] === "D";
    entries.push(deleted ? line : `${line}:${hashFile(absPath)}`);
  }
  return entries;
}

function headsignEntries(cwd: string): string[] {
  // .headsign/ is typically gitignored, yet gates legitimately read/write files there
  // (verdict, approved); state.json and lock are excluded because headsign itself
  // rewrites/holds them.
  const dir = path.join(cwd, ".headsign");
  return listFiles(dir)
    .filter((f) => !["state.json", "lock"].includes(path.relative(dir, f)))
    .sort()
    .map((f) => `${path.relative(cwd, f)}:${hashFile(f)}`);
}

function listFiles(dir: string): string[] {
  const entries = tryOr(() => fs.readdirSync(dir, { withFileTypes: true }), [] as fs.Dirent[]);
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : e.isFile() ? [full] : [];
  });
}

function hashFile(p: string): string {
  return tryOr(() => sha256(fs.readFileSync(p)), "unreadable");
}

function tryOr<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
