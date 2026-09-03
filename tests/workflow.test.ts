import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import * as workflow from "../src/workflow.ts";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

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

test("a phase whose description is an empty string is rejected", () => {
  const doc = validWorkflow();
  // `description:` with nothing after it parses to an empty string rather than a missing key,
  // so the type test alone would let it through — and the phase would then hand the agent an
  // empty instruction, which is the one thing a phase must never do.
  phases(doc).plan.description = "";
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan': description is required")));
});

test("a gate check that is not a mapping is rejected", () => {
  const doc = validWorkflow();
  // The shape someone writes when they read `checks:` as a list of commands. It reports here,
  // naming the index, rather than reaching the gate as a check with no `run` to spawn.
  phases(doc).plan.gate = { checks: ["npm test"] };
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan': gate.checks[0].run is required")));
});

test("a gate check whose run is an empty string is rejected", () => {
  const doc = validWorkflow();
  // A `run:` left blank is a check that always passes: `sh -c ""` exits 0. The gate would be
  // green about nothing, which is the failure this message exists to prevent.
  phases(doc).plan.gate = { checks: [{ run: "" }] };
  assert.ok(errors(doc).some((e) => e.includes("phase 'plan': gate.checks[0].run is required")));
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
  assert.ok(errors(doc).some((e) => e.includes("on_pass[0].to 'nope' does not name a defined phase or '$end'")));
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

// --- properties (hegel) ---
//
// Everything above pins one document each. What follows asks the same module about documents
// nobody typed: hegel draws them, and each assertion is a relation this file's own header or a
// named ADR already states. The generator below is the shared asset — the same draw feeds the
// no-throw property, the schema properties and the fingerprint properties.

// Full Unicode minus the two categories a YAML round trip does not return unchanged: a control
// character and a lone surrogate come back as something else, and `parseWorkflow` below would
// then fail on the parser's rules rather than on headsign's. The three excluded characters are
// YAML's other line breaks (NEL, LS, PS), left out for the same reason.
const phrase = gs.text({ minSize: 1, maxSize: 16, excludeCategories: ["Cc", "Cs"], excludeCharacters: "\u0085\u2028\u2029" });

// Names a phase may carry. `$limits` is in the pool deliberately: workflow.ts's LIMITS_KEY
// documents the collision it makes with the fingerprint's own key and says `limits` wins, and a
// key-set property has to hold with that phase present. `retry`, `$end` and `escalate` are out
// because the schema reads each of them as a token wherever a destination is written, so a
// phase carrying one of those names cannot be routed to.
const PHASE_NAMES = ["plan", "build", "review", "docs", "ship", "$limits", "phase-1", "a b", "変更"];

function drawCheck(tc: hegel.TestCase): Record<string, unknown> {
  const check: Record<string, unknown> = { run: tc.draw(phrase) };
  if (tc.draw(gs.booleans())) check.name = tc.draw(phrase);
  if (tc.draw(gs.booleans())) check.timeout = tc.draw(gs.integers({ minValue: 1, maxValue: 600 }));
  return check;
}

// The k-way form, built to the two positional rules validateRoutes states: every entry but the
// last carries a `when:`, and the last one carries none.
function drawRoutes(tc: hegel.TestCase, targets: string[]): Record<string, unknown>[] {
  const count = tc.draw(gs.integers({ minValue: 1, maxValue: 3 }));
  return Array.from({ length: count }, (_unused, i) => {
    const route: Record<string, unknown> = { to: tc.draw(gs.sampledFrom(targets)) };
    if (i < count - 1) route.when = tc.draw(phrase);
    if (tc.draw(gs.booleans())) route.timeout = tc.draw(gs.integers({ minValue: 1, maxValue: 600 }));
    return route;
  });
}

function drawPhase(tc: hegel.TestCase, names: string[]): Record<string, unknown> {
  const targets = [...names, "$end"];
  const phase: Record<string, unknown> = {
    description: tc.draw(phrase),
    gate: { checks: Array.from({ length: tc.draw(gs.integers({ minValue: 1, maxValue: 3 })) }, () => drawCheck(tc)) },
    on_pass: tc.draw(gs.booleans()) ? tc.draw(gs.sampledFrom(targets)) : drawRoutes(tc, targets),
  };
  if (tc.draw(gs.booleans())) phase.ready = tc.draw(phrase);
  if (tc.draw(gs.booleans())) {
    // No trailing '/': that spelling carries a warning of its own, and these properties are
    // about errors. The relative, `..`-free shape is what validatePhase accepts.
    phase.clear = Array.from({ length: tc.draw(gs.integers({ minValue: 1, maxValue: 2 })) }, () => `${tc.draw(gs.text({ alphabet: "abc.", minSize: 1, maxSize: 6 }))}x`);
  }
  const onFail = tc.draw(gs.sampledFrom([null, "retry", "$end", "escalate", ...names]));
  if (onFail !== null) phase.on_fail = onFail;
  // Paired with 'escalate' the schema rejects it outright — the first failure already ends the
  // run, so the budget could never be reached (validatePhase says so in its message).
  if (onFail !== "escalate" && tc.draw(gs.booleans())) phase.max_attempts = tc.draw(gs.integers({ minValue: 1, maxValue: 10 }));
  return phase;
}

// A document the schema accepts. Unreachable phases and pass-only cycles stay possible on
// purpose: both are warnings, and a property about errors has to survive them.
function drawWorkflowDoc(tc: hegel.TestCase): Record<string, unknown> {
  const count = tc.draw(gs.integers({ minValue: 1, maxValue: 5 }));
  const names = tc.draw(gs.arrays(gs.sampledFrom(PHASE_NAMES), { minSize: count, maxSize: count, unique: true }));
  const doc: Record<string, unknown> = {
    version: 0.1,
    name: tc.draw(phrase),
    entry: tc.draw(gs.sampledFrom(names)),
    // fromEntries, not an assignment loop: it creates an own property for every name it is
    // handed, which is also what the YAML parser hands validate().
    phases: Object.fromEntries(names.map((name) => [name, drawPhase(tc, names)])),
  };
  if (tc.draw(gs.booleans())) doc.limits = { max_total_iterations: tc.draw(gs.integers({ minValue: 1, maxValue: 1000 })) };
  return doc;
}

// Anything a YAML file can parse to, nested: scalars, sequences and mappings, with the schema's
// own vocabulary in the string pool so near-miss documents get drawn as well as nonsense.
function drawAnyDocument(tc: hegel.TestCase, depth: number): unknown {
  const kind = tc.draw(gs.integers({ minValue: 0, maxValue: depth > 0 ? 7 : 5 }));
  switch (kind) {
    case 0: return null;
    case 1: return tc.draw(gs.booleans());
    case 2: return tc.draw(gs.integers());
    case 3: return tc.draw(gs.floats());
    case 4: return tc.draw(gs.text({ maxSize: 12 }));
    case 5: return tc.draw(gs.sampledFrom(["version", "name", "entry", "phases", "gate", "checks", "run", "on_pass", "on_fail", "$end", "retry", "escalate", "0.1"]));
    case 6: return Array.from({ length: tc.draw(gs.integers({ minValue: 0, maxValue: 3 })) }, () => drawAnyDocument(tc, depth - 1));
    default: {
      const keys = tc.draw(gs.arrays(gs.sampledFrom(["version", "name", "entry", "phases", "limits", "gate", "checks", "on_pass", "on_fail", "description", "run", "to", "when", "x"]), { maxSize: 5, unique: true }));
      return Object.fromEntries(keys.map((k) => [k, drawAnyDocument(tc, depth - 1)]));
    }
  }
}

// This file's header states it: nothing here throws, whatever it is handed — a problem comes
// back as text in the error list instead. That is the contract the whole `validate` command
// rests on, and it is the one property every document can be asked at once.
test("validate never throws, whatever the document is", () =>
  hegel.test((tc) => {
    const doc = drawAnyDocument(tc, 3);
    const { errors, warnings } = workflow.validate(doc);
    assert.ok(Array.isArray(errors) && Array.isArray(warnings));
    assert.ok(errors.every((e) => typeof e === "string"));
  }));

test("a document built to the schema validates with no errors", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    assert.deepEqual(workflow.validate(doc).errors, []);
  }));

// Warnings are computed only once the shape is otherwise valid — validate() guards the walks on
// exactly that — so an accepted document is the only one that can carry them.
test("warnings arrive only with an empty error list", () =>
  hegel.test((tc) => {
    // Both sources, because only one of them can produce a warning at all: a schema-shaped
    // document is the only kind that reaches the walks, and junk is what has to stay silent.
    const doc = tc.draw(gs.booleans()) ? drawWorkflowDoc(tc) : drawAnyDocument(tc, 3);
    const { errors, warnings } = workflow.validate(doc);
    if (warnings.length > 0) assert.deepEqual(errors, []);
  }));

// --- the strict schema (ADR-0015): a key the schema does not know is an error ---

const ALLOWED_KEYS_ORACLE = {
  top: ["version", "name", "entry", "phases", "limits"],
  phase: ["description", "clear", "ready", "gate", "on_pass", "on_fail", "max_attempts"],
  gate: ["checks"],
  check: ["name", "run", "timeout"],
  route: ["when", "to", "timeout"],
  limits: ["max_total_iterations"],
};

type Level = keyof typeof ALLOWED_KEYS_ORACLE;

// Every mapping in the document the schema polices, paired with the level it is policed at.
// The `phases` mapping itself is absent on purpose: its keys are phase names, which the author
// chooses.
function keyedMappings(doc: Record<string, unknown>): { level: Level; map: Record<string, unknown> }[] {
  const found: { level: Level; map: Record<string, unknown> }[] = [{ level: "top", map: doc }];
  if (doc.limits) found.push({ level: "limits", map: doc.limits as Record<string, unknown> });
  for (const phase of Object.values(doc.phases as Record<string, Record<string, unknown>>)) {
    found.push({ level: "phase", map: phase });
    const gate = phase.gate as Record<string, unknown>;
    found.push({ level: "gate", map: gate });
    for (const check of gate.checks as Record<string, unknown>[]) found.push({ level: "check", map: check });
    if (Array.isArray(phase.on_pass)) for (const route of phase.on_pass as Record<string, unknown>[]) found.push({ level: "route", map: route });
  }
  return found;
}

test("a key the schema does not know is reported, wherever in the document it is written", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const sites = keyedMappings(doc);
    const site = sites[tc.draw(gs.integers({ minValue: 0, maxValue: sites.length - 1 }))];
    // Drawn from the schema's whole vocabulary as often as from nowhere: a key that is legal
    // one level up is the misspelling ADR-0015 is about, and it has to be rejected here too.
    const key = tc.draw(gs.booleans())
      ? tc.draw(gs.sampledFrom(Object.values(ALLOWED_KEYS_ORACLE).flat()))
      : tc.draw(gs.text({ alphabet: "abcdefghijklmnopqrstuvwxyz_", minSize: 1, maxSize: 10 }));
    tc.assume(!ALLOWED_KEYS_ORACLE[site.level].includes(key));
    // defineProperty, not assignment: `map.__proto__ = 1` sets the prototype instead of adding a
    // key, and the YAML parser gives validate an own property for that name like any other.
    Object.defineProperty(site.map, key, { value: tc.draw(gs.integers()), enumerable: true, writable: true, configurable: true });
    const found = workflow.validate(doc).errors;
    assert.ok(
      found.some((e) => e.includes(`unknown key '${key}'`)),
      `expected an unknown-key error naming '${key}' at level ${site.level}, got ${JSON.stringify(found)}`,
    );
  }));

// --- load(): the file is read afresh, and the workflow comes back only when nothing is wrong ---

function parseWorkflow(doc: unknown): ReturnType<typeof workflow.load> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-wf-prop-"));
  const file = path.join(dir, "workflow.yaml");
  fs.writeFileSync(file, stringifyYaml(doc));
  try {
    return workflow.load(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The header's rule stated as one relation: a workflow comes back exactly when the error list
// is empty, so "no workflow" is how a fatal problem is reported and never anything else.
test("load hands back a workflow exactly when it reports no error", () =>
  hegel.test((tc) => {
    const doc = tc.draw(gs.booleans()) ? drawWorkflowDoc(tc) : drawAnyDocument(tc, 3);
    const loaded = parseWorkflow(doc);
    assert.equal(loaded.workflow === null, loaded.errors.length > 0);
  }, { testCases: 50 }));

// A document the schema accepts survives the trip through the file load reads it from: the run
// walks the rules that were written, not a reshaped copy of them.
test("a schema-shaped document round-trips through the YAML file load reads", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const loaded = parseWorkflow(doc);
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(loaded.workflow, doc);
  }, { testCases: 50 }));

// --- the graph pin (ADR-0023) ---

// The walk the fingerprint is scoped to, written out here rather than borrowed: every
// destination a run standing on `from` can still be sent to, `on_fail` edges included.
function reachableNames(doc: Record<string, unknown>, from: string): Set<string> {
  const phaseMap = doc.phases as Record<string, Record<string, unknown>>;
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name) || !Object.hasOwn(phaseMap, name)) continue;
    seen.add(name);
    const p = phaseMap[name];
    const targets = Array.isArray(p.on_pass) ? (p.on_pass as { to: string }[]).map((r) => r.to) : [p.on_pass as string];
    for (const t of [...targets, p.on_fail]) if (typeof t === "string" && Object.hasOwn(phaseMap, t)) stack.push(t);
  }
  return seen;
}

test("the pin covers exactly the phases the run can still be sent to, plus $limits", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const names = Object.keys(doc.phases as Record<string, unknown>);
    const from = tc.draw(gs.sampledFrom(names));
    const keys = new Set(Object.keys(fingerprintOf(doc, from)));
    assert.deepEqual(keys, new Set([...reachableNames(doc, from), workflow.LIMITS_KEY]));
  }));

// Rebuilds every mapping with its keys in a drawn order, sequences untouched. ADR-0023 §2: the
// hash is of the parsed structure, so key order is the author's business while array order is a
// rule.
function reorderKeys(tc: hegel.TestCase, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => reorderKeys(tc, v));
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reorderKeys(tc, v)] as const);
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = tc.draw(gs.integers({ minValue: 0, maxValue: i }));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(shuffled);
}

test("the pin reads the parsed structure: any key order gives the same hashes", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const names = Object.keys(doc.phases as Record<string, unknown>);
    const from = tc.draw(gs.sampledFrom(names));
    const before = fingerprintOf(doc, from);
    assert.deepEqual(fingerprintOf(reorderKeys(tc, doc) as Record<string, unknown>, from), before);
  }));

// ADR-0003 makes description advisory, and ADR-0023 §2 keeps it out of the pin for that reason:
// a run must be able to reword its own prose mid-walk without anybody being asked.
test("rewording every description in the file moves no hash and reports no change", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const names = Object.keys(doc.phases as Record<string, unknown>);
    const from = tc.draw(gs.sampledFrom(names));
    const before = fingerprintOf(doc, from);
    for (const phase of Object.values(doc.phases as Record<string, Record<string, unknown>>)) phase.description = tc.draw(phrase);
    const after = fingerprintOf(doc, from);
    assert.deepEqual(after, before);
    assert.deepEqual(workflow.changedFingerprintKeys(before, after), []);
  }));

// Edits that leave every edge where it was, so the reachable set — and with it the key set — is
// the same on both sides and the reported difference is about rules and nothing else.
const EDGE_PRESERVING_EDITS: ((tc: hegel.TestCase, phase: Record<string, unknown>) => void)[] = [
  (tc, p) => { (p.gate as { checks: unknown[] }).checks = [{ run: tc.draw(phrase) }]; },
  (tc, p) => { p.ready = tc.draw(phrase); },
  (tc, p) => { p.clear = [`${tc.draw(gs.text({ alphabet: "abc", minSize: 1, maxSize: 5 }))}y`]; },
  (tc, p) => { if (p.on_fail !== "escalate") p.max_attempts = tc.draw(gs.integers({ minValue: 1, maxValue: 10 })); },
];

// ADR-0023 §1: the report has to name which rules moved. One phase edited means that phase
// named and no other — the whole reason the pin is a map of hashes and not one hash of the file.
test("editing one reachable phase's rules reports that phase and no other", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const names = Object.keys(doc.phases as Record<string, unknown>);
    const from = tc.draw(gs.sampledFrom(names));
    const reachable = [...reachableNames(doc, from)]
      // `$limits` is the one name the limits mapping's own hash lands on — workflow.ts's
      // LIMITS_KEY says the collision is deterministic and that limits wins — so a phase
      // carrying it is reported under that key rather than under itself.
      .filter((n) => n !== workflow.LIMITS_KEY);
    tc.assume(reachable.length > 0);
    const target = tc.draw(gs.sampledFrom(reachable));
    const before = fingerprintOf(doc, from);
    const phase = (doc.phases as Record<string, Record<string, unknown>>)[target];
    const pinnedBefore = JSON.stringify({ ...phase, description: null });
    tc.draw(gs.sampledFrom(EDGE_PRESERVING_EDITS))(tc, phase);
    tc.assume(JSON.stringify({ ...phase, description: null }) !== pinnedBefore);
    assert.deepEqual(workflow.changedFingerprintKeys(before, fingerprintOf(doc, from)), [target]);
  }));

// The ceiling is pinned under its own key, and declaring one has to read as a change to that key
// rather than as a key appearing out of nowhere — a key present on one side only is adopted in
// silence.
test("changing the ceiling reports $limits and no phase", () =>
  hegel.test((tc) => {
    const doc = drawWorkflowDoc(tc);
    const names = Object.keys(doc.phases as Record<string, unknown>);
    const from = tc.draw(gs.sampledFrom(names));
    const before = fingerprintOf(doc, from);
    const limit = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
    tc.assume(JSON.stringify(doc.limits ?? null) !== JSON.stringify({ max_total_iterations: limit }));
    doc.limits = { max_total_iterations: limit };
    assert.deepEqual(workflow.changedFingerprintKeys(before, fingerprintOf(doc, from)), [workflow.LIMITS_KEY]);
  }));

// --- a phase name has to be a name the run's own maps can hold ---
//
// A phase name becomes a key of `state.attempts` and of the graph fingerprint. Two names that
// the language already puts on every object broke both, silently: a `toString` phase counted its
// attempts as a string (so `max_attempts` compared a string to a number and never fired), and a
// `__proto__` phase never entered the fingerprint at all (so an edit to its rules was invisible).
// ADR-0035 is why the schema rejects the whole class rather than each map hardening itself.

function docNamed(name: string): Record<string, unknown> {
  return {
    version: 0.1,
    name: "demo",
    entry: name,
    phases: Object.fromEntries([[name, { description: "d", gate: { checks: [{ run: "true" }] }, on_pass: "$end" }]]),
  };
}

test("a phase named toString is rejected, and the message says the name is the problem", () => {
  const found = errors(docNamed("toString"));
  assert.ok(found.some((e) => e.includes("phase 'toString'") && e.includes("rename the phase")), JSON.stringify(found));
});

test("a phase named __proto__ is rejected", () => {
  assert.ok(errors(docNamed("__proto__")).some((e) => e.includes("phase '__proto__'")));
});

test("every name the language already puts on an object is rejected", () =>
  hegel.test((tc) => {
    const name = tc.draw(gs.sampledFrom(Object.getOwnPropertyNames(Object.prototype)));
    assert.ok(errors(docNamed(name)).some((e) => e.includes(`phase '${name}'`)), `'${name}' was accepted`);
  }));

test("an ordinary name that merely looks reserved is accepted", () => {
  assert.deepEqual(errors(docNamed("to_string")), []);
});

// graphFingerprint is exported and the tests below call it with hand-built documents, so it
// keeps its own guard — the same standing engine.ts's describePhase has behind validate.
test("graphFingerprint pins a phase whose name is a built-in object property, rather than dropping it", () => {
  const fingerprint = fingerprintOf(docNamed("__proto__"), "__proto__");
  assert.deepEqual(Object.keys(fingerprint).sort(), ["$limits", "__proto__"]);
  assert.equal(typeof fingerprint["__proto__"], "string");
});

// The rule is that a key only one side carries is adopted or dropped in silence. `in` would have
// answered yes for a name every object inherits, turning a newly reachable `toString` phase into
// a reported change.
test("changedFingerprintKeys: a computed key named after an object property that the saved map never carried is not a difference", () => {
  assert.deepEqual(workflow.changedFingerprintKeys({ plan: "p" }, { plan: "p", toString: "t" }), []);
});

test("changedFingerprintKeys: the same key IS a difference once both maps carry it", () => {
  assert.deepEqual(workflow.changedFingerprintKeys({ toString: "t" }, { toString: "T" }), ["toString"]);
});

// fingerprintDigest hashes the whole map through the same key-sorting walk the phase hashes go
// through, so that walk has to be able to hold these names too — a digest that ignored the
// `__proto__` entry would answer "the same difference I already reported" about a different one.
test("fingerprintDigest: a map differing only in a key named after an object property gets a different digest", () => {
  // A computed key, because the plain `__proto__: "a"` spelling in an object literal is the
  // prototype setter rather than an entry — the same trap the fix under test is about.
  const withProto = (hash: string): Record<string, string> => ({ plan: "p", $limits: "l", ["__proto__"]: hash });
  assert.notEqual(workflow.fingerprintDigest(withProto("a")), workflow.fingerprintDigest(withProto("b")));
});
