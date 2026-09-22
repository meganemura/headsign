import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as antigravityhook from "../src/antigravityhook.ts";
import * as state from "../src/state.ts";

const NOW = "2026-09-22T12:00:00+09:00";
const NO_ENV: NodeJS.ProcessEnv = {};
const CLI_PATH = path.resolve("src/cli.ts");

function tmpdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-agyhook-"));
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

function fromDirectory<T>(dir: string, evaluate: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return evaluate();
  } finally {
    process.chdir(previous);
  }
}

function writeRunningWorkflow(dir: string): void {
  const headsignDir = path.join(dir, ".headsign");
  fs.mkdirSync(headsignDir, { recursive: true });
  fs.writeFileSync(
    path.join(headsignDir, "workflow.yaml"),
    `version: 0.1
name: testflow
entry: step1
phases:
  step1:
    description: Step 1
    checks:
      - name: check1
        run: "true"
    on_pass: done
`,
  );
  state.writeState(dir, {
    workflow: "testflow",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "step1",
    attempts: {},
    total_iterations: 0,
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    driver_agent: null,
    phase_entered_at: NOW,
    phase_entered_from: null,
    last_stop: null,
    last_drive: null,
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
  });
}

// --- evaluateStop tests ---

test("evaluateStop: unparseable or non-object JSON allows stop", () => {
  const dir = tmpdir();
  assert.deepEqual(antigravityhook.evaluateStop("{invalid", NOW, NO_ENV), { decision: "allow" });
  assert.deepEqual(antigravityhook.evaluateStop("null", NOW, NO_ENV), { decision: "allow" });
  assert.deepEqual(antigravityhook.evaluateStop("123", NOW, NO_ENV), { decision: "allow" });
});

test("evaluateStop: error termination or present error fails open and allows stop", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  const byReason = antigravityhook.evaluateStop(
    JSON.stringify({ workspacePaths: [dir], terminationReason: "error" }),
    NOW,
    NO_ENV,
  );
  assert.deepEqual(byReason, { decision: "allow" });

  const byError = antigravityhook.evaluateStop(
    JSON.stringify({ workspacePaths: [dir], error: "fatal command timeout" }),
    NOW,
    NO_ENV,
  );
  assert.deepEqual(byError, { decision: "allow" });
});

test("evaluateStop: no run in workspace allows stop", () => {
  const dir = tmpdir();
  const res = antigravityhook.evaluateStop(
    JSON.stringify({ workspacePaths: [dir], conversationId: "conv-1", executionNum: 1 }),
    NOW,
    NO_ENV,
  );
  assert.deepEqual(res, { decision: "allow" });
});

test("evaluateStop: running workflow blocks stop with decision continue and reason", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  const res = antigravityhook.evaluateStop(
    JSON.stringify({ workspacePaths: [dir], conversationId: "conv-1", executionNum: 1 }),
    NOW,
    NO_ENV,
  );
  assert.equal(res.decision, "continue");
  assert.match(res.reason ?? "", /headsign workflow 'testflow' is still running/);
});

test("evaluateStop: missing or empty workspacePaths allows stop", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  fromDirectory(dir, () => {
    const missing = antigravityhook.evaluateStop(JSON.stringify({ conversationId: "conv-1" }), NOW, NO_ENV);
    const empty = antigravityhook.evaluateStop(
      JSON.stringify({ workspacePaths: [""], conversationId: "conv-1" }),
      NOW,
      NO_ENV,
    );
    assert.deepEqual(missing, { decision: "allow" });
    assert.deepEqual(empty, { decision: "allow" });
  });
});

test("evaluateStop: pause note consumption allows stop", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  const tmpSub = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(tmpSub, { recursive: true });
  fs.writeFileSync(path.join(tmpSub, "stop-note"), "waiting on reviewer\n");

  const res = antigravityhook.evaluateStop(
    JSON.stringify({ workspacePaths: [dir] }),
    NOW,
    NO_ENV,
  );
  assert.deepEqual(res, { decision: "allow" });
  assert.equal(fs.existsSync(path.join(tmpSub, "stop-note")), false);
});

test("evaluateStop: internal exception fails open", () => {
  const dir = tmpdir();
  // Pass an object as env that throws when property is accessed
  const badEnv = new Proxy({}, {
    get() {
      throw new Error("simulated env failure");
    },
  }) as NodeJS.ProcessEnv;
  const res = antigravityhook.evaluateStop(JSON.stringify({ workspacePaths: [dir] }), NOW, badEnv);
  assert.deepEqual(res, { decision: "allow" });
});

// --- evaluatePreInvocation tests ---

test("evaluatePreInvocation: unparseable or non-object JSON returns empty injectSteps", () => {
  assert.deepEqual(antigravityhook.evaluatePreInvocation("invalid"), { injectSteps: [] });
  assert.deepEqual(antigravityhook.evaluatePreInvocation("null"), { injectSteps: [] });
  assert.deepEqual(antigravityhook.evaluatePreInvocation("42"), { injectSteps: [] });
});

test("evaluatePreInvocation: invocationNum > 1 returns empty injectSteps", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  const res = antigravityhook.evaluatePreInvocation(
    JSON.stringify({ workspacePaths: [dir], invocationNum: 2 }),
  );
  assert.deepEqual(res, { injectSteps: [] });
});

test("evaluatePreInvocation: invocationNum 1 with running workflow injects ephemeral message", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  const res = antigravityhook.evaluatePreInvocation(
    JSON.stringify({ workspacePaths: [dir], invocationNum: 1 }),
  );
  assert.equal(res.injectSteps.length, 1);
  assert.match(res.injectSteps[0].ephemeralMessage, /headsign found persisted state for an unfinished workflow/);
  assert.match(res.injectSteps[0].ephemeralMessage, /testflow/);
});

test("evaluatePreInvocation: missing or empty workspacePaths returns empty injectSteps", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);
  fromDirectory(dir, () => {
    const missing = antigravityhook.evaluatePreInvocation(
      JSON.stringify({ invocationNum: 1 }),
    );
    const empty = antigravityhook.evaluatePreInvocation(
      JSON.stringify({ workspacePaths: [""], invocationNum: 1 }),
    );
    assert.deepEqual(missing, { injectSteps: [] });
    assert.deepEqual(empty, { injectSteps: [] });
  });
});

test("evaluatePreInvocation: invocationNum 1 with no run returns empty injectSteps", () => {
  const dir = tmpdir();
  const res = antigravityhook.evaluatePreInvocation(
    JSON.stringify({ workspacePaths: [dir], invocationNum: 1 }),
  );
  assert.deepEqual(res, { injectSteps: [] });
});

test("evaluatePreInvocation: exception returns empty injectSteps", () => {
  // Pass an invalid path that triggers an error
  const res = antigravityhook.evaluatePreInvocation(JSON.stringify({ workspacePaths: ["\0invalid"], invocationNum: 1 }));
  assert.deepEqual(res, { injectSteps: [] });
});

// --- CLI end-to-end integration tests ---

test("CLI agy-stop-hook and agy-pre-invocation-hook work via subprocess", () => {
  const dir = tmpdir();
  writeRunningWorkflow(dir);

  // agy-pre-invocation-hook
  const preOut = execFileSync(
    process.execPath,
    [CLI_PATH, "agy-pre-invocation-hook"],
    {
      cwd: dir,
      input: JSON.stringify({ workspacePaths: [dir], invocationNum: 1 }),
      encoding: "utf8",
    },
  );
  const preParsed = JSON.parse(preOut.trim());
  assert.equal(preParsed.injectSteps.length, 1);

  // agy-stop-hook
  const stopOut = execFileSync(
    process.execPath,
    [CLI_PATH, "agy-stop-hook"],
    {
      cwd: dir,
      input: JSON.stringify({ workspacePaths: [dir], executionNum: 1 }),
      encoding: "utf8",
    },
  );
  const stopParsed = JSON.parse(stopOut.trim());
  assert.equal(stopParsed.decision, "continue");
});
