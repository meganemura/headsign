import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
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

test("a phase whose body is not a mapping is rejected", () => {
  const doc = validWorkflow();
  // The route-entry sibling of this branch has been pinned since the k-way routes landed; the
  // phase-level one had not, so a workflow writing `plan: "write the spec"` — the shape someone
  // reaches for when they think `phases:` maps a name to its instructions — reported nothing
  // here and failed later, somewhere else.
  (doc.phases as Record<string, unknown>).plan = "write the spec";
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan' must be a mapping")));
});

test("a gate check with a non-positive timeout is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.gate = { checks: [{ run: "true", timeout: 0 }] };
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan': gate.checks[0].timeout must be a positive number")));
});

test("a gate check with a non-numeric timeout is rejected", () => {
  const doc = validWorkflow();
  phases(doc).plan.gate = { checks: [{ run: "true", timeout: "30s" }] };
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan': gate.checks[0].timeout must be a positive number")));
});

test("a positive gate-check timeout is accepted", () => {
  const doc = validWorkflow();
  phases(doc).plan.gate = { checks: [{ run: "true", timeout: 30 }] };
  assert.deepEqual(errors(doc), []);
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

// --- clear: a trailing '/' warns, since it names a directory and clear: removes files only ---

test("a clear: entry ending with '/' warns instead of erroring — it names a directory, and clear: only removes files", () => {
  const doc = validWorkflow();
  phases(doc).plan.clear = ["scratch/"];
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(warnings(doc), ["phase 'plan': clear[0] 'scratch/' names a directory — clear: removes files only, so nothing happens here"]);
});

test("a clear: entry not ending with '/' warns about nothing", () => {
  const doc = validWorkflow();
  phases(doc).plan.clear = ["scratch"];
  assert.deepEqual(warnings(doc), []);
});

test("multiple clear: entries in one phase are each warned about individually, keeping their index", () => {
  const doc = validWorkflow();
  phases(doc).plan.clear = ["keep-me.txt", "scratch/", "also-scratch/"];
  assert.deepEqual(warnings(doc), [
    "phase 'plan': clear[1] 'scratch/' names a directory — clear: removes files only, so nothing happens here",
    "phase 'plan': clear[2] 'also-scratch/' names a directory — clear: removes files only, so nothing happens here",
  ]);
});

test("clear: still rejects an absolute path or a '..' segment as an error, trailing slash or not, and suppresses the warning pass entirely", () => {
  const doc = validWorkflow();
  phases(doc).plan.clear = ["/abs/scratch/", "../escape/"];
  const result = workflow.validate(doc);
  assert.ok(result.errors.some((e) => e.includes("clear[0]")));
  assert.ok(result.errors.some((e) => e.includes("clear[1]")));
  assert.deepEqual(result.warnings, [], "warnings are not computed while errors stand, the same rule as any other error");
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

// --- a cycle of pass edges with no max_total_iterations under it ---
//
// max_attempts counts a phase's failures since it last passed and engine.ts clears it on a
// pass, so it cannot bound a loop whose every edge is a pass: `limits.max_total_iterations`
// is the only backstop there is (ADR-0017), and it is optional with no default.

function cycleWarning(...names: string[]): string {
  return (
    `${names.length === 1 ? "phase" : "phases"} ${names.map((n) => `'${n}'`).join(", ")} can cycle on pass edges alone, and no limits.max_total_iterations bounds the run: ` +
    `max_attempts counts a phase's failures and is cleared when it passes, so it cannot stop a cycle that turns on passes`
  );
}

// sweep.yaml's shape: apply -> verify -> record, and record's route list turns back to apply
// while there is work left, or falls through to report when there is not.
function sweepWorkflow(): Record<string, unknown> {
  return {
    version: 0.1,
    name: "sweep",
    entry: "apply",
    phases: {
      apply: { description: "apply", gate: { checks: [{ run: "true" }] }, on_pass: "verify" },
      verify: { description: "verify", gate: { checks: [{ run: "true" }] }, on_pass: "record" },
      record: {
        description: "record",
        gate: { checks: [{ run: "true" }] },
        on_pass: [{ when: "test -s queue", to: "apply" }, { to: "report" }],
      },
      report: { description: "report", gate: { checks: [{ run: "true" }] }, on_pass: "$end" },
    },
  };
}

test("a pass-only cycle with no max_total_iterations warns, naming every phase on the loop", () => {
  const doc = sweepWorkflow();
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(warnings(doc), [cycleWarning("apply", "verify", "record")]);
});

test("the same cycle with limits.max_total_iterations set says nothing: the ceiling is the answer", () => {
  const doc = sweepWorkflow();
  doc.limits = { max_total_iterations: 60 };
  assert.deepEqual(warnings(doc), []);
});

// verify --fail--> apply --pass--> verify. Deliberately not warned about: verify's attempts
// survive until verify passes, so max_attempts can bound this one.
test("a cycle that needs a fail edge to close is not warned about, even with no limits", () => {
  const doc = validWorkflow();
  doc.entry = "apply";
  phases(doc).apply = { description: "apply", gate: { checks: [{ run: "true" }] }, on_pass: "verify" };
  phases(doc).verify = {
    description: "verify",
    gate: { checks: [{ run: "true" }] },
    on_pass: "$end",
    on_fail: "apply",
    max_attempts: 3,
  };
  delete phases(doc).plan;
  delete phases(doc).build;
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(warnings(doc), []);
});

test("a straight-line workflow with no limits warns about nothing", () => {
  assert.deepEqual(warnings(validWorkflow()), []);
});

test("a phase whose on_pass names itself is a cycle of one", () => {
  const doc = validWorkflow();
  phases(doc).build.on_pass = "build";
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(warnings(doc), [cycleWarning("build")]);
});

// A loop nobody can enter is not what runs away, and it already has a warning of its own.
test("a pass cycle unreachable from entry gets the unreachable warning only", () => {
  const doc = validWorkflow();
  phases(doc).left = { description: "left", gate: { checks: [{ run: "true" }] }, on_pass: "right" };
  phases(doc).right = { description: "right", gate: { checks: [{ run: "true" }] }, on_pass: "left" };
  assert.deepEqual(warnings(doc), [
    "phase 'left' is unreachable from entry 'plan'",
    "phase 'right' is unreachable from entry 'plan'",
  ]);
});

test("two separate pass cycles are warned about one at a time, in file order", () => {
  const doc = sweepWorkflow();
  // report loops back on itself instead of ending: a second cycle, disjoint from the first.
  phases(doc).report.on_pass = "report";
  assert.deepEqual(warnings(doc), [cycleWarning("apply", "verify", "record"), cycleWarning("report")]);
});

// The point of it being a warning (ADR-0011): a file that loops is still a file a run can be
// walking, and a run in progress must not be stopped by advice.
test("the cycle warning is not an error: load() still hands back the workflow", () => {
  const doc = sweepWorkflow();
  const result = workflow.validate(doc);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "headsign-workflow-")), "cycle.yaml");
  fs.writeFileSync(file, stringifyYaml(doc));
  const loaded = workflow.load(file);
  assert.ok(loaded.workflow);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.warnings.length, 1);
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

// --- graph fingerprint: which rules a run is depending on, hashed ---
//
// The fingerprint's job is to make a mid-run edit to the rules noticeable, so every test here
// is about one of two failure modes: something that IS a rule change coming out invisible, or
// something that is NOT one (a reworded description, a moved comment, a phase the run can no
// longer reach) coming out as a change and making the report noise.

function fingerprintOf(doc: Record<string, unknown>, from: string): Record<string, string> {
  return workflow.graphFingerprint(doc as unknown as workflow.Workflow, from);
}

// The workflow the tests below mutate: three phases, and `docs` is reachable from `plan` only
// by walking through `build`, which is what makes the reachability assertions meaningful.
function pinnableWorkflow(): Record<string, unknown> {
  return {
    version: 0.1,
    name: "demo",
    entry: "plan",
    phases: {
      plan: { description: "plan", gate: { checks: [{ run: "true" }] }, on_pass: "build" },
      build: { description: "build", gate: { checks: [{ run: "true" }] }, on_pass: "docs" },
      docs: { description: "docs", gate: { checks: [{ run: "true" }] }, on_pass: "$end" },
    },
  };
}

// The one key every fingerprint has, whether or not the file declares `limits:`.
test("graphFingerprint: keys are the phases reachable from where the run stands, plus $limits", () => {
  assert.deepEqual(Object.keys(fingerprintOf(pinnableWorkflow(), "plan")), ["plan", "build", "docs", "$limits"]);
});

// ADR-0003 makes description advisory: it is prose for the agent and nothing routes on it, so
// a run must be able to reword it mid-flight without anybody being asked about it.
test("graphFingerprint: a description is not part of the pin — rewording one changes no hash", () => {
  const before = fingerprintOf(pinnableWorkflow(), "plan");
  const doc = pinnableWorkflow();
  phases(doc).build.description = "completely different prose, at length";
  assert.deepEqual(fingerprintOf(doc, "plan"), before);
});

// Every field the schema allows on a phase except description, one at a time. The point is the
// exclusion list: a field nobody remembered to add to an allow-list would silently go unpinned,
// and `clear:` is in the list because deleting a clear entry leaves the previous pass's verdict
// on disk for the next gate to find — a way of loosening a gate without touching the gate.
const PINNED_PHASE_EDITS: Record<string, (phase: Record<string, unknown>) => void> = {
  gate: (p) => { p.gate = { checks: [{ run: "false" }] }; },
  ready: (p) => { p.ready = "test -f ready"; },
  clear: (p) => { p.clear = ["artifact.txt"]; },
  // Same destination, spelled as a one-entry route list: reachability is untouched, so this
  // isolates "the rule was rewritten" from "the graph now goes somewhere else".
  on_pass: (p) => { p.on_pass = [{ to: "docs" }]; },
  on_fail: (p) => { p.on_fail = "escalate"; },
  max_attempts: (p) => { p.max_attempts = 3; },
};

for (const [field, edit] of Object.entries(PINNED_PHASE_EDITS)) {
  test(`graphFingerprint: changing a phase's ${field} changes that phase's hash and no other`, () => {
    const before = fingerprintOf(pinnableWorkflow(), "plan");
    const doc = pinnableWorkflow();
    edit(phases(doc).build);
    const after = fingerprintOf(doc, "plan");
    assert.notEqual(after.build, before.build, `${field} must be part of the pin`);
    assert.equal(after.plan, before.plan);
    assert.equal(after.docs, before.docs);
    assert.equal(after.$limits, before.$limits);
  });
}

test("graphFingerprint: changing limits changes $limits and no phase hash", () => {
  const before = fingerprintOf(pinnableWorkflow(), "plan");
  const doc = pinnableWorkflow();
  doc.limits = { max_total_iterations: 20 };
  const after = fingerprintOf(doc, "plan");
  assert.notEqual(after.$limits, before.$limits);
  for (const phase of ["plan", "build", "docs"]) assert.equal(after[phase], before[phase]);
});

// Declaring a ceiling has to read as a change to $limits rather than as a key appearing out of
// nowhere: a key present on only one side is adopted in silence (see changedFingerprintKeys),
// so a $limits that only exists once `limits:` is written would let the first ceiling through.
test("graphFingerprint: a workflow with no limits still has a $limits hash, and it differs from one that declares limits", () => {
  const bare = fingerprintOf(pinnableWorkflow(), "plan");
  const doc = pinnableWorkflow();
  doc.limits = { max_total_iterations: 20 };
  assert.equal(typeof bare.$limits, "string");
  assert.notEqual(fingerprintOf(doc, "plan").$limits, bare.$limits);
});

// ADR-0016 §5: what a run is owed is the definitions of the phases it has NOT ENTERED yet. A
// phase it can no longer reach is one it can never be judged by again.
test("graphFingerprint: phases unreachable from where the run stands are not keys at all", () => {
  const fromDocs = fingerprintOf(pinnableWorkflow(), "docs");
  assert.deepEqual(Object.keys(fromDocs), ["docs", "$limits"]);
});

test("graphFingerprint: an on_fail edge counts as reachable — a failure can still land there", () => {
  const doc = pinnableWorkflow();
  phases(doc).docs.on_fail = "plan";
  assert.deepEqual(Object.keys(fingerprintOf(doc, "docs")).sort(), ["$limits", "build", "docs", "plan"]);
});

// The pin is of the parsed structure, not of the bytes: YAML does not make an author keep the
// key order they typed, so reporting one would fire on a file nobody meaningfully changed.
test("graphFingerprint: reordering a phase's keys changes nothing; reordering a gate's checks does", () => {
  const before = fingerprintOf(pinnableWorkflow(), "plan");
  const reordered = pinnableWorkflow();
  const build = phases(reordered).build;
  phases(reordered).build = { on_pass: build.on_pass, gate: build.gate, description: build.description };
  assert.deepEqual(fingerprintOf(reordered, "plan"), before);

  const twoChecks = pinnableWorkflow();
  phases(twoChecks).build.gate = { checks: [{ run: "a" }, { run: "b" }] };
  const swapped = pinnableWorkflow();
  phases(swapped).build.gate = { checks: [{ run: "b" }, { run: "a" }] };
  assert.notEqual(fingerprintOf(swapped, "plan").build, fingerprintOf(twoChecks, "plan").build, "checks run in order, so their order is a rule");
});

test("fingerprintDigest: same map, same digest; any differing hash gives a different one", () => {
  const map = fingerprintOf(pinnableWorkflow(), "plan");
  assert.equal(workflow.fingerprintDigest(map), workflow.fingerprintDigest({ ...map }));
  assert.notEqual(workflow.fingerprintDigest({ ...map, build: "0".repeat(64) }), workflow.fingerprintDigest(map));
});

// --- changedFingerprintKeys: only what both sides know about ---

test("changedFingerprintKeys: reports differing shared keys, in the computed map's (file) order", () => {
  const saved = { plan: "p", build: "b", docs: "d", $limits: "l" };
  const computed = { plan: "p", build: "B", docs: "D", $limits: "l" };
  assert.deepEqual(workflow.changedFingerprintKeys(saved, computed), ["build", "docs"]);
});

test("changedFingerprintKeys: a key only the computed map has is not a difference — the run never depended on it", () => {
  assert.deepEqual(workflow.changedFingerprintKeys({ plan: "p" }, { plan: "p", build: "b" }), []);
});

test("changedFingerprintKeys: a key only the saved map has is not a difference — the run can no longer reach it", () => {
  assert.deepEqual(workflow.changedFingerprintKeys({ plan: "p", build: "b" }, { plan: "p" }), []);
});
