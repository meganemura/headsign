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
