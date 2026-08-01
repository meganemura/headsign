import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// This suite drives the SHIPPED bundle (plugin/dist/headsign.mjs), not src/ directly —
// it exists to catch anything the build step itself could break that src-level tests
// (which run under Node's native TS stripping) would never see. One test below builds its own
// bundle from src/ instead, with a deliberately broken --define: the failure it pins can only
// exist in a built artifact and cannot be produced by building normally.
const BUNDLE = path.join(import.meta.dirname, "..", "plugin", "dist", "headsign.mjs");
if (!fs.existsSync(BUNDLE)) {
  throw new Error(`${BUNDLE} does not exist — run npm run build first`);
}

// This suite spawns with no explicit `env`, inheriting `process.env` — including, if this test
// runner itself happens to be running inside a Claude Code session, CLAUDE_CODE_SESSION_ID.
// Stripped here (ADR-0027) so `start`/`next` below never stamp `last_drive` on an ambient
// session none of these tests asked for; a run's shape here must not depend on whether the
// suite happens to run inside such a session.
function runEnv(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  delete e["CLAUDE_CODE_SESSION_ID"];
  return e;
}

function run(args: string[], opts: { cwd: string; input?: string }): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [BUNDLE, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: runEnv() });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-acceptance-"));
}

function initRepo(): string {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init", "--allow-empty"], { cwd: dir });
  return dir;
}

function writeWorkflow(dir: string, yaml: string): void {
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "workflow.yaml"), yaml);
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function readState(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".headsign", "state.json"), "utf8"));
}

// --- 1 (plan-gate loop) + 6 (stop-hook end-to-end, running/complete legs) ---

test("plan-gate loop: RETRY names the failing check, ADVANCE once it's fixed; stop-hook tracks running -> complete", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: plan-gate
entry: plan
phases:
  plan:
    description: "Write the spec."
    gate:
      checks:
        - name: "spec exists"
          run: "test -s docs/spec.md"
    on_pass: implement
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );

  assert.equal(run(["start"], { cwd: dir }).status, 0);

  const retryResult = run(["next"], { cwd: dir });
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stdout, /^RETRY 1 plan\n/);
  assert.ok(retryResult.stdout.includes("spec exists"), "RETRY output should name the failing check");

  // Scenario 6: the run is still in progress here — the hook must block.
  const midRunHook = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(midRunHook.status, 2);
  assert.match(midRunHook.stderr, /headsign next/);

  writeFile(dir, "docs/spec.md", "# Spec\n\nSomething real.\n");
  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.match(advanceResult.stdout, /^ADVANCE implement\n/);

  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);

  // Scenario 6: a correct ending — the hook must let this stop pass.
  const postCompleteHook = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(postCompleteHook.status, 0);
});

// --- 2. exhaustion -> ESCALATE, then stop-hook lets the (correct) ending pass ---

test("exhaustion: max_attempts reached escalates; stop-hook then allows the stop regardless of stdin", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: exhaustion
entry: implement
phases:
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
    max_attempts: 2
`,
  );
  run(["start"], { cwd: dir });

  const first = run(["next"], { cwd: dir });
  assert.equal(first.status, 1);
  assert.match(first.stdout, /^RETRY 1\/2 implement\n/);

  // Nothing is touched between the two calls: asking a second time is a second judgment,
  // which is what carries this run into exhaustion rather than leaving it stuck.
  const second = run(["next"], { cwd: dir });
  assert.equal(second.status, 2);
  assert.match(second.stdout, /^ESCALATE/);
  assert.ok(second.stdout.includes("max_attempts (2) exhausted"));

  // A "running-style" stdin payload: the hook must key off our own state.json status
  // (escalated), not stdin content — escalated is a correct, human-facing ending.
  const hookResult = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "s1", stop_hook_active: false }) });
  assert.equal(hookResult.status, 0);
});

// --- 3. review bounce (attempts retained across the bounce) + 5. cross-process resume ---

test("review bounce: rejection routes back with attempts retained; approval completes; a fresh process resumes correctly mid-run", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: review-bounce
entry: plan
phases:
  plan:
    description: "Plan."
    gate:
      checks:
        - run: "true"
    on_pass: implement
  implement:
    description: "Implement."
    gate:
      checks:
        - run: "test -f done"
    on_pass: review
  review:
    description: "Review."
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/verdict"
    on_pass: "$end"
    on_fail: implement
    max_attempts: 3
`,
  );
  run(["start"], { cwd: dir });

  assert.match(run(["next"], { cwd: dir }).stdout, /^ADVANCE implement\n/); // plan passes

  writeFile(dir, "done", "");
  assert.match(run(["next"], { cwd: dir }).stdout, /^ADVANCE review\n/); // implement passes

  writeFile(dir, ".headsign/verdict", "REJECTED\n");
  const rejected = run(["next"], { cwd: dir }); // review fails -> routed back to implement
  assert.equal(rejected.status, 0);
  assert.match(rejected.stdout, /^ADVANCE implement\n/);
  assert.ok(rejected.stdout.includes("gate failed"));
  assert.ok(rejected.stdout.includes("routed to implement"));
  assert.equal((readState(dir).attempts as Record<string, number>).review, 1);

  // Checkpoint 5 (cross-process resume / "compaction" stand-in): this `next` is a brand new
  // node process sharing no JS state with anything above — it must resume purely from
  // state.json, which says phase=implement. "done" is still on disk, so implement passes.
  const backToReview = run(["next"], { cwd: dir });
  assert.equal(backToReview.status, 0);
  assert.match(backToReview.stdout, /^ADVANCE review\n/);

  writeFile(dir, ".headsign/verdict", "APPROVED\n");
  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);

  assert.equal(run(["stop-hook"], { cwd: dir, input: "{}" }).status, 0);
});

// --- 4. two `next` calls with nothing changed between them ---

test("asked twice with nothing changed: the second next is a second real verdict, and the gate ran both times", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: judge-every-time
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "echo run >> gate-runs.txt; false"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir });

  const first = run(["next"], { cwd: dir });
  assert.equal(first.status, 1);
  assert.match(first.stdout, /^RETRY 1 build\n/);

  const second = run(["next"], { cwd: dir }); // no filesystem change since `first`
  assert.equal(second.status, 1);
  assert.match(second.stdout, /^RETRY 2 build\n/);
  assert.equal((readState(dir).attempts as Record<string, number>).build, 2);
  assert.equal(fs.readFileSync(path.join(dir, "gate-runs.txt"), "utf8"), "run\nrun\n");
});

// --- 6 (remainder): stop-hook with no .headsign/ at all ---

test("stop-hook: a directory that has never used headsign exits 0", () => {
  const result = run(["stop-hook"], { cwd: tmpdir(), input: "{}" });
  assert.equal(result.status, 0);
});

// --- 7 (pending-and-log): ready:/PENDING and .headsign/log, through the shipped bundle ---

test("ready:/PENDING: an early next is PENDING (not counted, no state write) until the probe passes, and .headsign/log records only real transitions", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: review-async
entry: review
phases:
  review:
    description: "Review."
    ready: "test -f .headsign/tmp/verdict"
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir });
  const logAfterStart = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8").trim().split("\n");
  assert.equal(logAfterStart.length, 1);
  assert.match(logAfterStart[0], /start review a=0 i=0 workflow=review-async$/);

  const beforeBytes = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const pending = run(["next"], { cwd: dir });
  assert.equal(pending.status, 1);
  assert.match(pending.stdout, /^PENDING review\n/);
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "state.json")), beforeBytes, "PENDING must not write state.json");
  assert.equal(fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8").trim().split("\n").length, 1, "PENDING must not append to the log");

  writeFile(dir, ".headsign/tmp/verdict", "APPROVED\n");
  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);
  const finalLog = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8").trim().split("\n");
  assert.equal(finalLog.length, 2);
  assert.match(finalLog[1], /complete review a=0 i=1$/);
});

// --- 8 (shipped examples): every workflow in example.headsign/ is valid against the bundle ---

test("every example workflow validates through the shipped bundle", () => {
  const examplesDir = path.join(import.meta.dirname, "..", "example.headsign");
  const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  assert.ok(files.length > 0, "example.headsign/ must contain at least one workflow");
  const cwd = tmpdir(); // validate --workflow takes an explicit path, so no run is needed here
  for (const file of files) {
    const result = run(["validate", "--workflow", path.join(examplesDir, file)], { cwd });
    assert.equal(result.status, 0, `${file} failed to validate:\n${result.stderr}`);
    assert.match(result.stdout, /^OK: workflow /);
    assert.equal(result.stderr, "", `${file} validates with warnings:\n${result.stderr}`);
  }
});

// --- 9 (k-way on_pass): the branch is taken by the shipped bundle, not just by src ---

test("k-way on_pass: the bundle routes a pass by its when: predicates and names the branch it took", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: router
entry: classify
phases:
  classify:
    description: "Classify."
    ready: "test -s .headsign/tmp/route"
    gate:
      checks:
        - run: "grep -qx -e docs -e code .headsign/tmp/route"
    on_pass:
      - when: "grep -qx docs .headsign/tmp/route"
        to: write-docs
      - to: implement
  write-docs:
    description: "Write the docs."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir });

  writeFile(dir, ".headsign/tmp/route", "docs\n");
  const routed = run(["next"], { cwd: dir });
  assert.equal(routed.status, 0);
  assert.equal(
    routed.stdout,
    `ADVANCE write-docs\n--- routed: when "grep -qx docs .headsign/tmp/route" → write-docs ---\n--- phase: write-docs ---\nWrite the docs.\n`,
  );
  assert.equal(readState(dir).phase, "write-docs");

  const log = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8").trim().split("\n");
  assert.match(log.at(-1)!, /advance write-docs a=0 i=1 from=classify routed-when="grep -qx docs \.headsign\/tmp\/route"$/);

  const done = run(["next"], { cwd: dir });
  assert.equal(done.status, 0);
  assert.match(done.stdout, /^COMPLETE\n/);
});

// --- version: the number is baked into the bundle at build time ---
//
// These belong in this suite and nowhere else: the version is substituted by esbuild's
// --define, so it exists only in the shipped bundle. Run against src/ under Node's type
// stripping there is no substitution at all, which is a different (and deliberately failing)
// path, covered in cli.test.ts.

const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
).version;

// The test that matters. --define wiring is the part that can rot silently — drop the flag, or
// bump package.json without rebuilding, and the CLI keeps happily reporting a stale number.
// The version is read out of package.json rather than written here on purpose: hard-coding it
// would freeze this test at today's number and it would pass forever after the next release.
test("the version baked into the bundle is the package's own version", () => {
  const result = run(["version"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${PACKAGE_VERSION}\n`);
});

// The case that got through review the first time, pinned by behaviour rather than by
// spelling. `--define` with an EMPTY value is not the same as no `--define`: the identifier is
// substituted, so a `typeof` guard folds to `if (false)` and `version` prints a blank line with
// exit 0 — a silent wrong answer from the one command that exists to refuse them.
//
// This builds a bundle with exactly that define and runs it. esbuild is a devDependency and is
// present wherever `npm test` runs, so the behavioural test is available and the earlier
// text-matching version of this test was pinning a spelling: rewriting the guard as
// `!HEADSIGN_VERSION` would have failed it while behaving identically.
test("a bundle built with an empty version refuses instead of printing a blank line", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "headsign-emptyver-")), "cli.mjs");
  // esbuild's bin is a platform-specific native executable rather than a JS entry point, so it
  // is spawned directly instead of through `process.execPath`. Do not "fix" this to go through
  // Node: it would try to parse a Mach-O/ELF binary and throw a SyntaxError. The reverse edit is
  // harmless — if esbuild ever ships a JS shim here instead, its shebang makes a direct spawn
  // keep working.
  const build = spawnSync(
    path.join(import.meta.dirname, "..", "node_modules", "esbuild", "bin", "esbuild"),
    [
      path.join(import.meta.dirname, "..", "src", "cli.ts"),
      "--bundle", "--platform=node", "--target=node20", "--format=esm",
      `--outfile=${out}`,
      // The empty string literal, which is what the shell produces outside npm's lifecycle.
      `--define:HEADSIGN_VERSION=""`,
      "--banner:js=import { createRequire } from \"node:module\";\nconst require = createRequire(import.meta.url);",
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, `esbuild failed: ${build.stderr}`);

  const result = spawnSync(process.execPath, [out, "version"], { encoding: "utf8" });
  assert.equal(result.status, 3, "an empty version must refuse, not succeed");
  assert.equal(result.stdout, "", "nothing may be printed on stdout — a blank line is the bug");
  assert.match(result.stderr, /carries no version/);
});

// The other half, which no bundle can express: the build script itself refuses to run without a
// version, so the empty define above cannot come from `npm run build` in the first place.
test("the build script refuses to bake an unset version", () => {
  const buildScript: string = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
  ).scripts.build;
  // `:?` — the parameter expansion that aborts on unset AND on empty, rather than substituting
  // nothing. `:-` or a bare `$npm_package_version` would both bake in the empty string.
  assert.match(buildScript, /\$\{npm_package_version:\?/);
});

test("version and --version print the bare version and a newline, byte-identically, and exit 0", () => {
  const word = run(["version"], { cwd: tmpdir() });
  const flag = run(["--version"], { cwd: tmpdir() });
  assert.equal(word.status, 0);
  assert.equal(flag.status, 0);
  // Bare value, not "headsign 0.4.0": the command name already said which tool, and this is
  // the form that composes into `v=$(headsign version)`.
  assert.equal(word.stdout, `${PACKAGE_VERSION}\n`);
  assert.equal(flag.stdout, word.stdout);
  assert.equal(word.stderr, "");
  assert.equal(flag.stderr, "");
});
