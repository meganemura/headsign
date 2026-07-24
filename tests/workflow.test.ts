import { test } from "node:test";
import assert from "node:assert/strict";
import * as workflow from "../src/workflow.ts";

function validWorkflow(): Record<string, unknown> {
  return {
    version: 1,
    name: "demo",
    entry: "plan",
    phases: {
      plan: { description: "plan", gate: { checks: [{ run: "true" }] }, on_pass: "build" },
      build: { description: "build", gate: { checks: [{ run: "true" }] }, on_pass: "$end" },
    },
  };
}

function phases(doc: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return doc.phases as Record<string, Record<string, unknown>>;
}

test("a well-formed workflow validates with no errors", () => {
  assert.deepEqual(workflow.validate(validWorkflow()), []);
});

test("bad version is rejected", () => {
  const doc = validWorkflow();
  doc.version = 2;
  assert.ok(workflow.validate(doc).some((e) => e.includes("version")));
});

test("missing entry is rejected", () => {
  const doc = validWorkflow();
  delete doc.entry;
  assert.ok(workflow.validate(doc).some((e) => e.includes("entry")));
});

test("entry naming an unknown phase is rejected", () => {
  const doc = validWorkflow();
  doc.entry = "nope";
  assert.ok(workflow.validate(doc).some((e) => e.includes("entry")));
});

test("missing on_pass is rejected", () => {
  const doc = validWorkflow();
  delete phases(doc).build.on_pass;
  assert.ok(workflow.validate(doc).some((e) => e.includes("on_pass")));
});

test("on_pass: retry is rejected", () => {
  const doc = validWorkflow();
  phases(doc).build.on_pass = "retry";
  assert.ok(workflow.validate(doc).some((e) => e.includes("on_pass")));
});

test("unknown route target is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "does-not-exist";
  assert.ok(workflow.validate(doc).some((e) => e.includes("on_fail")));
});

test("empty checks is rejected", () => {
  const doc = validWorkflow();
  (phases(doc).plan.gate as Record<string, unknown>).checks = [];
  assert.ok(workflow.validate(doc).some((e) => e.includes("gate.checks")));
});

test("on_exhausted naming a phase is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.max_attempts = 3;
  phases(doc).plan.on_exhausted = "build";
  assert.ok(workflow.validate(doc).some((e) => e.includes("on_exhausted")));
});

test("unreachable phase is rejected", () => {
  const doc = validWorkflow();
  phases(doc).orphan = { description: "orphan", gate: { checks: [{ run: "true" }] }, on_pass: "$end" };
  assert.ok(workflow.validate(doc).some((e) => e.includes("unreachable")));
});

test("non-positive max_attempts is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.max_attempts = 0;
  assert.ok(workflow.validate(doc).some((e) => e.includes("max_attempts")));
});

test("max_attempts with on_fail: escalate is rejected as dead config", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "escalate";
  phases(doc).plan.max_attempts = 3;
  assert.ok(workflow.validate(doc).some((e) => e.includes("max_attempts") && e.includes("on_fail")));
});

test("max_attempts with on_fail: abort is rejected as dead config", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "abort";
  phases(doc).plan.max_attempts = 3;
  assert.ok(workflow.validate(doc).some((e) => e.includes("max_attempts") && e.includes("on_fail")));
});

test("load() reports an error for a missing/unparseable file", () => {
  const { workflow: wf, errors } = workflow.load("/nonexistent/path/workflow.yaml");
  assert.equal(wf, null);
  assert.ok(errors.length > 0);
});

// --- ready: readiness probe field ---

test("a valid non-empty ready string passes validation", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = "test -f .headsign/tmp/verdict";
  assert.deepEqual(workflow.validate(doc), []);
});

test("an empty ready string is rejected with the exact message", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = "";
  assert.deepEqual(workflow.validate(doc), ["phase 'plan': ready must be a non-empty shell string"]);
});

test("a non-string ready is rejected with the exact message", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = 123;
  assert.deepEqual(workflow.validate(doc), ["phase 'plan': ready must be a non-empty shell string"]);
});

test("ready does not add a reachability edge: a phase reachable only via on_pass/on_fail still validates with ready set", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = "test -f .headsign/tmp/verdict";
  phases(doc).build.ready = "true";
  assert.deepEqual(workflow.validate(doc), []);
});
