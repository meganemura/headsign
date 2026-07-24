import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as treehash from "../src/treehash.ts";

function tmpdir(prefix = "headsign-th-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function commit(dir: string, message: string, args: string[] = []): void {
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", message, ...args], { cwd: dir });
}

function initRepo(): string {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  commit(dir, "init", ["--allow-empty"]);
  return dir;
}

test("returns null outside a git repo", () => {
  assert.equal(treehash.treeHash(tmpdir("headsign-nogit-")), null);
});

test("creating an untracked file changes the hash", () => {
  const dir = initRepo();
  const h1 = treehash.treeHash(dir);
  fs.writeFileSync(path.join(dir, "new.txt"), "hello");
  assert.notEqual(treehash.treeHash(dir), h1);
});

test("committing changes the hash", () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, "a.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd: dir });
  const beforeCommit = treehash.treeHash(dir);
  commit(dir, "add a");
  assert.notEqual(treehash.treeHash(dir), beforeCommit);
});

test("writing .headsign/verdict changes the hash even when .headsign/ is gitignored", () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, ".gitignore"), ".headsign/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: dir });
  commit(dir, "gitignore .headsign/");
  fs.mkdirSync(path.join(dir, ".headsign"));
  const h1 = treehash.treeHash(dir);
  fs.writeFileSync(path.join(dir, ".headsign", "verdict"), "approved");
  assert.notEqual(treehash.treeHash(dir), h1);
});

test("writing .headsign/state.json does not change the hash", () => {
  const dir = initRepo();
  fs.mkdirSync(path.join(dir, ".headsign"));
  const h1 = treehash.treeHash(dir);
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify({ a: 1 }));
  assert.equal(treehash.treeHash(dir), h1);
});

test("writing .headsign/lock does not change the hash", () => {
  const dir = initRepo();
  fs.mkdirSync(path.join(dir, ".headsign"));
  const h1 = treehash.treeHash(dir);
  fs.writeFileSync(path.join(dir, ".headsign", "lock"), "12345");
  assert.equal(treehash.treeHash(dir), h1);
});

test("writing .headsign/log does not change the hash", () => {
  const dir = initRepo();
  fs.mkdirSync(path.join(dir, ".headsign"));
  const h1 = treehash.treeHash(dir);
  fs.writeFileSync(path.join(dir, ".headsign", "log"), "2026-07-23T00:00:00.000Z start build a=0 i=0 workflow=demo\n");
  assert.equal(treehash.treeHash(dir), h1);
});

test("appending more lines to an already-excluded .headsign/log still does not change the hash", () => {
  const dir = initRepo();
  fs.mkdirSync(path.join(dir, ".headsign"));
  fs.writeFileSync(path.join(dir, ".headsign", "log"), "line 1\n");
  const h1 = treehash.treeHash(dir);
  fs.appendFileSync(path.join(dir, ".headsign", "log"), "line 2\n");
  assert.equal(treehash.treeHash(dir), h1);
});

test("nested project (cwd inside a larger git repo): tree-hash changes when a tracked file's CONTENT changes, not just its status line", () => {
  // Regression test: `git status --porcelain` paths are relative to the git top-level,
  // not cwd. Before the fix, joining those paths against cwd (here, the subdirectory)
  // resolved to nonexistent files, so every entry hashed as the constant "unreadable" —
  // the hash only moved when the SET of status lines changed, never when a tracked
  // file's content changed while remaining "M".
  const outer = tmpdir("headsign-nested-");
  execFileSync("git", ["init", "-q"], { cwd: outer });
  fs.mkdirSync(path.join(outer, "sub", ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(outer, "sub", "tracked.txt"), "v1");
  execFileSync("git", ["add", "."], { cwd: outer });
  commit(outer, "init");

  const cwd = path.join(outer, "sub");
  fs.writeFileSync(path.join(cwd, "tracked.txt"), "v2"); // dirty: status line "M"
  const h1 = treehash.treeHash(cwd);

  fs.writeFileSync(path.join(cwd, "tracked.txt"), "v3"); // still "M", content differs
  const h2 = treehash.treeHash(cwd);
  assert.notEqual(h1, h2, "a content change while the status line stays 'M' must still change the hash");
});

test("nested project: writing .headsign/state.json (resolved against cwd) still does not change the hash", () => {
  const outer = tmpdir("headsign-nested-");
  execFileSync("git", ["init", "-q"], { cwd: outer });
  const cwd = path.join(outer, "sub");
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(outer, "root.txt"), "hello");
  execFileSync("git", ["add", "root.txt"], { cwd: outer });
  commit(outer, "init");

  const h1 = treehash.treeHash(cwd);
  fs.writeFileSync(path.join(cwd, ".headsign", "state.json"), JSON.stringify({ a: 1 }));
  assert.equal(treehash.treeHash(cwd), h1);
});

test("a non-git directory returns null", () => {
  assert.equal(treehash.treeHash(tmpdir("headsign-plain-")), null);
});

test("a repo with no commits yet still produces a hashable string (git rev-parse HEAD fails but is caught)", () => {
  // Note: deliberately not using initRepo() here, which does an initial --allow-empty
  // commit — this test needs a repo with genuinely zero commits.
  const dir = tmpdir("headsign-nocommit-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const hash = treehash.treeHash(dir);
  assert.equal(typeof hash, "string");
});
