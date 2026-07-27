import { test } from "node:test";
import assert from "node:assert/strict";
import * as workflow from "../src/workflow.ts";

function validWorkflow(): Record<string, unknown> {
  return {
    version: 0.1,
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

// `abort` is not an on_fail token (ADR-0014) — ending a run for good is the `headsign abort`
// command's job, so a workflow naming it here gets the ordinary unknown-route error.
test("on_fail: abort is rejected as an unknown route", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_fail = "abort";
  assert.ok(errors(doc).some((e) => e.includes("on_fail") && e.includes("abort")));
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

// --- unknown keys are errors, at every level (ADR-0015) ---
//
// Each of these asserts the whole error list, not just a substring: the message has to name
// the key, say where it was found, and print that level's allowed keys, because those three
// together are what a reader fixes the file from. No did-you-mean guess is asserted (or
// produced) — that is the decision, not an omission.

function gate(doc: Record<string, unknown>, phase: string): Record<string, unknown> {
  return phases(doc)[phase].gate as Record<string, unknown>;
}

function checks(doc: Record<string, unknown>, phase: string): Record<string, unknown>[] {
  return gate(doc, phase).checks as Record<string, unknown>[];
}

test("an unknown top-level key is rejected", () => {
  const doc = validWorkflow();
  doc.limit = { max_total_iterations: 5 };
  assert.deepEqual(errors(doc), ["top level: unknown key 'limit' (allowed: version, name, entry, phases, limits)"]);
});

// The case the whole rule exists for: before this, the typo loaded, the phase ran with no
// budget at all, and nothing said so.
test("a misspelled max_attempts is rejected instead of leaving the phase silently unlimited", () => {
  const doc = validWorkflow();
  phases(doc).plan.max_atempts = 3;
  assert.deepEqual(errors(doc), [
    "phase 'plan': unknown key 'max_atempts' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)",
  ]);
});

test("an unknown gate key is rejected", () => {
  const doc = validWorkflow();
  gate(doc, "plan").timeout = 60;
  assert.deepEqual(errors(doc), ["phase 'plan': gate: unknown key 'timeout' (allowed: checks)"]);
});

test("an unknown check key is rejected", () => {
  const doc = validWorkflow();
  checks(doc, "plan")[0].shell = "bash";
  assert.deepEqual(errors(doc), ["phase 'plan': gate.checks[0]: unknown key 'shell' (allowed: name, run, timeout)"]);
});

test("an unknown route key is rejected", () => {
  const doc = routedWorkflow();
  routes(doc)[0].if = "true";
  assert.deepEqual(errors(doc), ["phase 'plan': on_pass[0]: unknown key 'if' (allowed: when, to, timeout)"]);
});

test("an unknown limits key is rejected", () => {
  const doc = validWorkflow();
  doc.limits = { max_total_iterations: 20, max_turns: 20 };
  assert.deepEqual(errors(doc), ["limits: unknown key 'max_turns' (allowed: max_total_iterations)"]);
});

test("every unknown key is reported, not only the first one found", () => {
  const doc = validWorkflow();
  phases(doc).plan.retries = 2;
  phases(doc).build.descrption = "typo";
  assert.deepEqual(errors(doc), [
    "phase 'plan': unknown key 'retries' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)",
    "phase 'build': unknown key 'descrption' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)",
  ]);
});

// ADR-0014 removed these two fields and said a file still carrying them loads with them
// ignored. That is no longer true, and this is the pair of leftovers most likely to be sitting
// in a file written a few days ago.
test("a phase still declaring the removed env: is rejected, not ignored", () => {
  const doc = validWorkflow();
  phases(doc).plan.env = { FOO: "bar" };
  assert.deepEqual(errors(doc), [
    "phase 'plan': unknown key 'env' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)",
  ]);
});

test("a phase still declaring the removed on_exhausted: is rejected, not ignored", () => {
  const doc = validWorkflow();
  phases(doc).plan.on_exhausted = "escalate";
  assert.deepEqual(errors(doc), [
    "phase 'plan': unknown key 'on_exhausted' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)",
  ]);
});

// --- version: 0.1 (ADR-0015) ---

test("version 0.1 is accepted", () => {
  const doc = validWorkflow();
  doc.version = 0.1;
  assert.deepEqual(errors(doc), []);
});

// The schema changed under `version: 1`, so a file carrying it needs reading, not a
// one-character edit. The message has to say that much or it invites the wrong fix.
test("version: 1 is rejected, and the message asks for the fields to be checked, not just the number changed", () => {
  const doc = validWorkflow();
  doc.version = 1;
  const [message, ...rest] = errors(doc);
  assert.deepEqual(rest, []);
  assert.match(message, /version must be 0\.1/);
  assert.match(message, /'version: 1'/);
  assert.match(message, /fields checked against the current schema, not just the number changed/);
});
