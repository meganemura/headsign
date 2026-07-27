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

// validate() answers with two lists (errors block the load, warnings don't); most tests here
// only care about one of them, so read them through these.
function errors(doc: unknown): string[] {
  return workflow.validate(doc).errors;
}

function warnings(doc: unknown): string[] {
  return workflow.validate(doc).warnings;
}

test("a well-formed workflow validates with no errors", () => {
  assert.deepEqual(errors(validWorkflow()), []);
});

test("bad version is rejected", () => {
  const doc = validWorkflow();
  doc.version = 2;
  assert.ok(errors(doc).some((e) => e.includes("version")));
});

test("missing entry is rejected", () => {
  const doc = validWorkflow();
  delete doc.entry;
  assert.ok(errors(doc).some((e) => e.includes("entry")));
});

test("entry naming an unknown phase is rejected", () => {
  const doc = validWorkflow();
  doc.entry = "nope";
  assert.ok(errors(doc).some((e) => e.includes("entry")));
});

test("missing on_pass is rejected", () => {
  const doc = validWorkflow();
  delete phases(doc).build.on_pass;
  assert.ok(errors(doc).some((e) => e.includes("on_pass")));
});

test("on_pass: retry is rejected", () => {
  const doc = validWorkflow();
  phases(doc).build.on_pass = "retry";
  assert.ok(errors(doc).some((e) => e.includes("on_pass")));
});

test("unknown route target is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "does-not-exist";
  assert.ok(errors(doc).some((e) => e.includes("on_fail")));
});

test("empty checks is rejected", () => {
  const doc = validWorkflow();
  (phases(doc).plan.gate as Record<string, unknown>).checks = [];
  assert.ok(errors(doc).some((e) => e.includes("gate.checks")));
});

test("on_exhausted naming a phase is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.max_attempts = 3;
  phases(doc).plan.on_exhausted = "build";
  assert.ok(errors(doc).some((e) => e.includes("on_exhausted")));
});

test("an unreachable phase is a warning, not an error", () => {
  const doc = validWorkflow();
  phases(doc).orphan = { description: "orphan", gate: { checks: [{ run: "true" }] }, on_pass: "$end" };
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(warnings(doc), ["phase 'orphan' is unreachable from entry 'plan'"]);
});

test("a workflow with no unreachable phase warns about nothing", () => {
  assert.deepEqual(warnings(validWorkflow()), []);
});

test("warnings are not computed while errors stand: an invalid workflow reports only errors", () => {
  const doc = validWorkflow();
  phases(doc).orphan = { description: "orphan", gate: { checks: [{ run: "true" }] }, on_pass: "$end" };
  doc.version = 2;
  const result = workflow.validate(doc);
  assert.ok(result.errors.some((e) => e.includes("version")));
  assert.deepEqual(result.warnings, []);
});

test("non-positive max_attempts is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.max_attempts = 0;
  assert.ok(errors(doc).some((e) => e.includes("max_attempts")));
});

test("max_attempts with on_fail: escalate is rejected as dead config", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "escalate";
  phases(doc).plan.max_attempts = 3;
  assert.ok(errors(doc).some((e) => e.includes("max_attempts") && e.includes("on_fail")));
});

test("max_attempts with on_fail: abort is rejected as dead config", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "abort";
  phases(doc).plan.max_attempts = 3;
  assert.ok(errors(doc).some((e) => e.includes("max_attempts") && e.includes("on_fail")));
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
  assert.deepEqual(errors(doc), []);
});

test("an empty ready string is rejected with the exact message", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = "";
  assert.deepEqual(errors(doc), ["phase 'plan': ready must be a non-empty shell string"]);
});

test("a non-string ready is rejected with the exact message", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = 123;
  assert.deepEqual(errors(doc), ["phase 'plan': ready must be a non-empty shell string"]);
});

test("ready does not add a reachability edge: a phase reachable only via on_pass/on_fail still validates with ready set", () => {
  const doc = validWorkflow();
  phases(doc).plan.ready = "test -f .headsign/tmp/verdict";
  phases(doc).build.ready = "true";
  assert.deepEqual(errors(doc), []);
});

// --- on_pass as a list of routes (k-way branching, ADR-0011) ---

// plan routes three ways; docs and build both fall through to $end.
function routedWorkflow(): Record<string, unknown> {
  const doc = validWorkflow();
  phases(doc).docs = { description: "docs", gate: { checks: [{ run: "true" }] }, on_pass: "$end" };
  phases(doc).plan.on_pass = [
    { when: "grep -qx docs .headsign/tmp/route", to: "docs" },
    { to: "build" },
  ];
  return doc;
}

function routes(doc: Record<string, unknown>): Record<string, unknown>[] {
  return phases(doc).plan.on_pass as Record<string, unknown>[];
}

test("a well-formed route list validates with no errors and no warnings", () => {
  assert.deepEqual(workflow.validate(routedWorkflow()), { errors: [], warnings: [] });
});

test("an empty route list is rejected", () => {
  const doc = routedWorkflow();
  phases(doc).plan.on_pass = [];
  assert.ok(errors(doc).some((e) => e.includes("on_pass must not be an empty list")));
});

test("a route entry that is not a mapping is rejected", () => {
  const doc = routedWorkflow();
  phases(doc).plan.on_pass = ["build"];
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0] must be a mapping")));
});

test("a route with no 'to' is rejected", () => {
  const doc = routedWorkflow();
  delete routes(doc)[1].to;
  assert.ok(errors(doc).some((e) => e.includes("on_pass[1].to is required")));
});

test("a route with an empty 'to' is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[1].to = "";
  assert.ok(errors(doc).some((e) => e.includes("on_pass[1].to is required")));
});

test("a route with a non-string 'to' is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[1].to = 7;
  assert.ok(errors(doc).some((e) => e.includes("on_pass[1].to is required")));
});

test("a route whose 'to' names no phase is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[0].to = "nope";
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].to 'nope' does not name a defined phase")));
});

test("a route to '$end' is accepted", () => {
  const doc = routedWorkflow();
  routes(doc)[0].to = "$end";
  assert.deepEqual(errors(doc), []);
});

test("a route to 'retry' is rejected, same as the string form", () => {
  const doc = routedWorkflow();
  routes(doc)[0].to = "retry";
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].to cannot be 'retry'")));
});

test("a route with an empty 'when' is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[0].when = "";
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].when must be a non-empty shell string")));
});

test("a route with a non-string 'when' is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[0].when = true;
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].when must be a non-empty shell string")));
});

test("a route with a non-positive timeout is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[0].timeout = 0;
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].timeout must be a positive number")));
});

test("a positive route timeout is accepted", () => {
  const doc = routedWorkflow();
  routes(doc)[0].timeout = 5;
  assert.deepEqual(errors(doc), []);
});

test("a 'when' on the last route is rejected: nothing would be the default destination", () => {
  const doc = routedWorkflow();
  routes(doc)[1].when = "true";
  assert.ok(errors(doc).some((e) => e.includes("on_pass[1] is the last entry and must have no 'when'")));
});

test("a missing 'when' before the last route is rejected: everything after it is dead", () => {
  const doc = routedWorkflow();
  delete routes(doc)[0].when;
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0] has no 'when'")));
});

test("a single-entry route list with no 'when' is accepted: it is just a spelled-out default", () => {
  const doc = routedWorkflow();
  phases(doc).plan.on_pass = [{ to: "build" }];
  phases(doc).plan.on_fail = "docs"; // keep docs reachable so nothing warns
  assert.deepEqual(workflow.validate(doc), { errors: [], warnings: [] });
});

test("reachability follows every route target, not just the default one", () => {
  const doc = routedWorkflow();
  // `docs` is reachable through the first route's `when` branch only.
  assert.deepEqual(warnings(doc), []);
});

test("a phase named by no route at all is still reported unreachable", () => {
  const doc = routedWorkflow();
  phases(doc).orphan = { description: "orphan", gate: { checks: [{ run: "true" }] }, on_pass: "$end" };
  assert.deepEqual(warnings(doc), ["phase 'orphan' is unreachable from entry 'plan'"]);
});
