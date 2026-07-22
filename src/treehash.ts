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
  return tryOr(() => sha256([revParseHead(cwd), ...statusEntries(cwd), ...headsignEntries(cwd)].join("\n")), null);
}

function revParseHead(cwd: string): string {
  // A repo with no commits yet is still a valid, hashable state.
  return tryOr(() => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), "no-head");
}

function statusEntries(cwd: string): string[] {
  const lines = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.length > 0)
    .sort();
  const entries: string[] = [];
  for (const line of lines) {
    const arrow = line.indexOf(" -> ");
    const filePath = arrow >= 0 ? line.slice(arrow + 4) : line.slice(3);
    // Exclude state.json unconditionally, not just when .gitignore happens to cover it:
    // headsign rewrites it on every evaluation, so including it self-invalidates the cache.
    if (filePath === ".headsign/state.json") continue;
    const deleted = line[0] === "D" || line[1] === "D";
    entries.push(deleted ? line : `${line}:${hashFile(path.join(cwd, filePath))}`);
  }
  return entries;
}

function headsignEntries(cwd: string): string[] {
  // .headsign/ is typically gitignored, yet gates legitimately read/write files there
  // (verdict, approved); state.json is excluded because headsign itself rewrites it.
  const dir = path.join(cwd, ".headsign");
  return listFiles(dir)
    .filter((f) => path.relative(dir, f) !== "state.json")
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
