// Responsibility: load + validate workflow.yaml; owns the schema types (ADR-0003).
// The path is the caller's to choose and is read as given: turning a bare name into
// `.headsign/<name>.yaml`, and falling back to the file a run recorded, both happen before
// the call.
// NOTHING here throws — not a missing file, not broken YAML, not a file of nonsense. Every
// problem comes back as text in the error list, and the workflow comes back only when that
// list is empty, so "no workflow" is how a fatal problem is reported. Warnings come back
// alongside a perfectly usable workflow and are never shown from here: who sees them is the
// caller's call (`validate` and `start` print them once, `next` never does, so the hot path
// of a run stays quiet).
// Nothing is remembered between calls: the file is read and parsed afresh every time, so a
// run re-loading it on every lap sees an edit made mid-run on the next lap. That is what
// makes a workflow rewritable while it is being walked (ADR-0016), and it is a property of
// this module rather than of its callers.
// It also computes the GRAPH FINGERPRINT (bottom of the file) — the hash of the rules a run is
// currently walking under. That lives here and not with the run record because it is a fact
// about the schema and the reachability walk, both of which are this module's alone; who
// stores it, when it is compared and what is said about a difference are somebody else's
// (state.ts, engine.ts, render.ts respectively).
// Must NOT know about: state.json, gate execution, git.

import fs from "node:fs";
import crypto from "node:crypto";
import { parse as parseYaml } from "yaml";

export interface Check { name?: string; run: string; timeout?: number }
// One branch of a k-way `on_pass`. `when` is a shell command judged by its exit code, not
// an expression (ADR-0011): 0 means "take this edge". The last entry carries no `when` and
// is the default destination, so a routed pass always has somewhere declared to land.
export interface Route { when?: string; to: string; timeout?: number }
export interface Phase {
  description: string;
  clear?: string[];
  gate: { checks: Check[] };
  on_pass: string | Route[];
  on_fail?: string;
  max_attempts?: number;
  ready?: string;
}
export interface Workflow { version: number; name: string; entry: string; phases: Record<string, Phase>; limits?: { max_total_iterations?: number } }

// No `abort` here (ADR-0014): a gate failure is a machine verdict, and ending a run for good
// is a human-directed act — `headsign abort <reason>` — so the only end-the-run token a
// workflow can declare on failure is `escalate`, which hands the call to a person.
const ON_FAIL_TOKENS = new Set(["retry", "$end", "escalate"]);

// The only value `version:` may take. Exact match, and it stays exact when this becomes 0.2
// (ADR-0015): while the schema is pre-1.0 a changed schema must be answered by an explicit
// edit to the file, not by a file that keeps loading with fields that no longer mean
// anything. `1` used to be the value and claimed a stability we don't have.
const SCHEMA_VERSION = 0.1;

// The schema's key set, in one place. Each level's allowed keys are listed here and nowhere
// else — the validators below read this table instead of repeating it — so adding a field
// means adding it here, next to the interfaces above, and no second list can fall out of
// sync with it. Unknown keys are rejected (ADR-0015): a misspelled `max_atempts` that loads
// silently runs a workflow its author did not write.
const ALLOWED_KEYS = {
  top: ["version", "name", "entry", "phases", "limits"],
  phase: ["description", "clear", "ready", "gate", "on_pass", "on_fail", "max_attempts"],
  gate: ["checks"],
  check: ["name", "run", "timeout"],
  route: ["when", "to", "timeout"],
  limits: ["max_total_iterations"],
} as const;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;

// `where` is the caller's location prefix (`phase 'plan': `), so a message names the map the
// key was found in as well as what the schema allows there. No did-you-mean guess is offered:
// listing the allowed keys is enough, and a guess that misses misdirects (ADR-0015).
function rejectUnknownKeys(level: keyof typeof ALLOWED_KEYS, m: Record<string, unknown>, where: string, errors: string[]): void {
  const allowed: readonly string[] = ALLOWED_KEYS[level];
  for (const key of Object.keys(m)) {
    if (!allowed.includes(key)) errors.push(`${where}unknown key '${key}' (allowed: ${allowed.join(", ")})`);
  }
}

// Warnings are things a run can proceed with; errors are not (they leave `workflow` null).
// The caller decides who gets to see the warnings: `validate` and `start` print them once,
// `next` never does — see engine.ts (and cli.ts, which still loads for `validate`).
export function load(path: string): { workflow: Workflow | null; errors: string[]; warnings: string[] } {
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(path, "utf8"));
  } catch (err) {
    return { workflow: null, errors: [`could not read/parse ${path}: ${(err as Error).message}`], warnings: [] };
  }
  const { errors, warnings } = validate(doc);
  return errors.length > 0 ? { workflow: null, errors, warnings } : { workflow: doc as Workflow, errors: [], warnings };
}

export function validate(doc: unknown): { errors: string[]; warnings: string[] } {
  if (!isMap(doc)) return { errors: ["workflow must be a YAML mapping"], warnings: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  rejectUnknownKeys("top", doc, "top level: ", errors);
  if (doc.version !== SCHEMA_VERSION) {
    errors.push(
      `version must be ${SCHEMA_VERSION} (the schema is pre-1.0 and still changing; a file written for the old 'version: 1' needs its fields checked against the current schema, not just the number changed)`,
    );
  }
  if (typeof doc.name !== "string" || !doc.name) errors.push("name is required");
  if (typeof doc.entry !== "string" || !doc.entry) errors.push("entry is required");

  if (!isMap(doc.phases) || Object.keys(doc.phases).length === 0) {
    errors.push("phases is required and must be a non-empty mapping");
    return { errors, warnings };
  }
  const phases = doc.phases;
  const names = new Set(Object.keys(phases));
  if (typeof doc.entry === "string" && !names.has(doc.entry)) errors.push(`entry '${doc.entry}' does not name a defined phase`);

  for (const [name, raw] of Object.entries(phases)) {
    if (isMap(raw)) validatePhase(name, raw, names, errors);
    else errors.push(`phase '${name}' must be a mapping`);
  }

  if (doc.limits !== undefined) {
    if (!isMap(doc.limits)) errors.push("limits must be a mapping");
    else {
      rejectUnknownKeys("limits", doc.limits, "limits: ", errors);
      if (doc.limits.max_total_iterations !== undefined && !isPosInt(doc.limits.max_total_iterations)) {
        errors.push("limits.max_total_iterations must be a positive integer");
      }
    }
  }

  // Warnings, not errors (ADR-0011): a half-written phase or a temporarily commented-out
  // edge must not stop the run that is being used to write it. Only computed once the shape
  // is otherwise valid, since the walks below trust the schema.
  if (errors.length === 0) {
    const graph = phases as unknown as Record<string, Phase>;
    warnings.push(...unreachable(doc.entry as string, graph, names));
    // Nothing to say when a ceiling is declared: `max_total_iterations` is the answer to a
    // graph that turns forever (ADR-0017), so a bounded run needs no advice about it.
    const bounded = isMap(doc.limits) && doc.limits.max_total_iterations !== undefined;
    if (!bounded) warnings.push(...unboundedPassCycles(doc.entry as string, graph, names));
  }
  return { errors, warnings };
}

function validatePhase(name: string, p: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  rejectUnknownKeys("phase", p, `phase '${name}': `, errors);
  if (typeof p.description !== "string" || !p.description) errors.push(`phase '${name}': description is required`);

  if (isMap(p.gate)) rejectUnknownKeys("gate", p.gate, `phase '${name}': gate: `, errors);
  const checks = (p.gate as Record<string, unknown> | undefined)?.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push(`phase '${name}': gate.checks is required and must be non-empty`);
  } else {
    checks.forEach((c: unknown, i: number) => {
      const check = isMap(c) ? c : null;
      if (check) rejectUnknownKeys("check", check, `phase '${name}': gate.checks[${i}]: `, errors);
      if (!check || typeof check.run !== "string" || !check.run) errors.push(`phase '${name}': gate.checks[${i}].run is required`);
      if (check?.timeout !== undefined && !(typeof check.timeout === "number" && check.timeout > 0)) {
        errors.push(`phase '${name}': gate.checks[${i}].timeout must be a positive number`);
      }
    });
  }

  if (p.clear !== undefined) {
    if (!Array.isArray(p.clear)) errors.push(`phase '${name}': clear must be an array`);
    else {
      p.clear.forEach((rel: unknown, i: number) => {
        const ok = typeof rel === "string" && rel.length > 0 && !rel.startsWith("/") && !rel.split("/").includes("..");
        if (!ok) errors.push(`phase '${name}': clear[${i}] must be a relative path without '..'`);
      });
    }
  }

  // `ready` is a readiness probe, not a routing field: it never adds a graph edge, so it
  // takes no part in the `unreachable()` walk below.
  if (p.ready !== undefined && (typeof p.ready !== "string" || !p.ready)) {
    errors.push(`phase '${name}': ready must be a non-empty shell string`);
  }

  if (Array.isArray(p.on_pass)) validateRoutes(name, p.on_pass, names, errors);
  else if (typeof p.on_pass !== "string" || !p.on_pass) errors.push(`phase '${name}': on_pass is required`);
  else if (p.on_pass === "retry") errors.push(`phase '${name}': on_pass cannot be 'retry'`);
  else if (p.on_pass !== "$end" && !names.has(p.on_pass)) errors.push(`phase '${name}': on_pass '${p.on_pass}' does not name a defined phase`);

  if (p.on_fail !== undefined && (typeof p.on_fail !== "string" || (!ON_FAIL_TOKENS.has(p.on_fail) && !names.has(p.on_fail)))) {
    errors.push(`phase '${name}': on_fail '${String(p.on_fail)}' is not a valid route`);
  }
  if (p.max_attempts !== undefined && !isPosInt(p.max_attempts)) errors.push(`phase '${name}': max_attempts must be a positive integer`);
  // engine.ts step() checks max_attempts exhaustion before on_fail, but on_fail
  // 'escalate' ends the run on the very first failure — attempts never gets a
  // chance to reach max_attempts, so one of the two settings is always dead.
  if (p.max_attempts !== undefined && p.on_fail === "escalate") {
    errors.push(`phase '${name}': max_attempts has no effect when on_fail is 'escalate' — the first failure already ends the run; remove one of them`);
  }
}

// The k-way form of on_pass (ADR-0011). Two of these rules are about position rather than
// shape: only the last entry may omit `when` (it is the default destination, so a pass
// always has somewhere declared to land), and no earlier entry may omit it (an unconditional
// entry mid-list makes every entry after it dead — resolveRoute stops at the first match).
function validateRoutes(name: string, routes: unknown[], names: Set<string>, errors: string[]): void {
  if (routes.length === 0) {
    errors.push(`phase '${name}': on_pass must not be an empty list`);
    return;
  }
  routes.forEach((raw: unknown, i: number) => {
    if (!isMap(raw)) {
      errors.push(`phase '${name}': on_pass[${i}] must be a mapping with 'to' and an optional 'when'`);
      return;
    }
    rejectUnknownKeys("route", raw, `phase '${name}': on_pass[${i}]: `, errors);
    if (typeof raw.to !== "string" || !raw.to) errors.push(`phase '${name}': on_pass[${i}].to is required`);
    else if (raw.to === "retry") errors.push(`phase '${name}': on_pass[${i}].to cannot be 'retry'`);
    else if (raw.to !== "$end" && !names.has(raw.to)) errors.push(`phase '${name}': on_pass[${i}].to '${raw.to}' does not name a defined phase`);

    if (raw.when !== undefined && (typeof raw.when !== "string" || !raw.when)) {
      errors.push(`phase '${name}': on_pass[${i}].when must be a non-empty shell string`);
    }
    const isLast = i === routes.length - 1;
    if (isLast && raw.when !== undefined) {
      errors.push(`phase '${name}': on_pass[${i}] is the last entry and must have no 'when' — it is the default destination when nothing matches`);
    }
    if (!isLast && raw.when === undefined) {
      errors.push(`phase '${name}': on_pass[${i}] has no 'when', so no later entry can ever be reached — only the last entry may omit it`);
    }
    if (raw.timeout !== undefined && !(typeof raw.timeout === "number" && raw.timeout > 0)) {
      errors.push(`phase '${name}': on_pass[${i}].timeout must be a positive number`);
    }
  });
}

// Every declared edge counts, including all `to:` of a k-way on_pass — a branch destination
// reachable only through a `when:` is still reachable.
function routeTargets(p: Phase): unknown[] {
  const passTargets = Array.isArray(p.on_pass) ? p.on_pass.map((r) => r.to) : [p.on_pass];
  return [...passTargets, p.on_fail];
}

function reachableFrom(entry: string, phases: Record<string, Phase>, names: Set<string>): Set<string> {
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (visited.has(name) || !names.has(name)) continue;
    visited.add(name);
    for (const t of routeTargets(phases[name])) if (typeof t === "string" && names.has(t)) stack.push(t);
  }
  return visited;
}

function unreachable(entry: string, phases: Record<string, Phase>, names: Set<string>): string[] {
  const visited = reachableFrom(entry, phases, names);
  return [...names].filter((n) => !visited.has(n)).map((n) => `phase '${n}' is unreachable from entry '${entry}'`);
}

// The pass edges only — every `to:` of a k-way on_pass, or the single string form, minus
// `$end`. `on_fail` is deliberately absent: a cycle that turns on a failure edge (verify
// --fail--> apply --pass--> verify) can be bounded by the failing phase's max_attempts,
// because attempts survive until that phase passes. A cycle made of passes cannot be, which
// is exactly what the warning below is for.
function passTargets(p: Phase): string[] {
  const targets = Array.isArray(p.on_pass) ? p.on_pass.map((r) => r.to) : [p.on_pass];
  return targets.filter((t): t is string => typeof t === "string" && t !== "$end");
}

// Every phase reachable from `from` by walking ONE OR MORE pass edges. Starting the walk at
// `from`'s targets rather than at `from` is what makes "can I get back to myself" answerable
// with the same function that answers "can I get to you" — and it is what lets a self-loop
// (on_pass naming its own phase) come out as a cycle of one.
function passClosure(from: string, phases: Record<string, Phase>, names: Set<string>): Set<string> {
  const seen = new Set<string>();
  const stack = passTargets(phases[from]).filter((t) => names.has(t));
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const t of passTargets(phases[name])) if (names.has(t)) stack.push(t);
  }
  return seen;
}

// A graph that can turn forever on passes alone, with no `limits.max_total_iterations` under
// it, has nothing that stops it: `max_attempts` counts a phase's failures SINCE IT LAST
// PASSED and engine.ts clears the count on a pass, so a loop whose every edge is a pass keeps
// resetting the only other counter there is.
//
// Found the plain way rather than with Tarjan (ADR-0016 — the fitness function is "can this
// be explained to a middle schooler"): ask each phase whether it can walk back to itself,
// then put two such phases in the same group when each can reach the other. Phase counts here
// are in the tens, so the cost of asking one phase at a time does not matter.
//
// Cycles that need a fail edge to close are left alone on purpose (see passTargets): deciding
// whether such a loop is really unbounded means enumerating the cycles and checking that
// nobody on one carries max_attempts, and the false positives that would cost outweigh what
// it would catch.
function unboundedPassCycles(entry: string, phases: Record<string, Phase>, names: Set<string>): string[] {
  // File order, not walk order: the same file must produce the same warning every time.
  // Unreachable phases are skipped — they already have a warning of their own, and a loop
  // nobody can enter is not what runs away.
  const reachable = reachableFrom(entry, phases, names);
  const order = [...names].filter((n) => reachable.has(n));
  const forward = new Map(order.map((n) => [n, passClosure(n, phases, names)]));
  const onCycle = order.filter((n) => forward.get(n)!.has(n));

  const warnings: string[] = [];
  const grouped = new Set<string>();
  for (const n of onCycle) {
    if (grouped.has(n)) continue;
    const group = onCycle.filter((m) => m === n || (forward.get(n)!.has(m) && forward.get(m)!.has(n)));
    for (const m of group) grouped.add(m);
    // Long, because this warning cannot be acted on without its reason: told only that the
    // graph loops, an author reaches for max_attempts, which is the one thing that cannot help.
    // A group of one is a phase whose on_pass names itself; saying "phases 'build'" there
    // would be the machine mis-hearing its own finding.
    const noun = group.length === 1 ? "phase" : "phases";
    warnings.push(
      `${noun} ${group.map((m) => `'${m}'`).join(", ")} can cycle on pass edges alone, and no limits.max_total_iterations bounds the run: ` +
        `max_attempts counts a phase's failures and is cleared when it passes, so it cannot stop a cycle that turns on passes`,
    );
  }
  return warnings;
}

// --- the graph fingerprint: one hash per rule a run is currently depending on ---
//
// A run re-reads this file every lap (see the header), which is deliberate and stays: ADR-0016
// §5 lets a run rewrite its own workflow, and ADR-0017 tells a person to raise the ceiling and
// resume with `next`. What was missing is not a lock but a RECORD — with nothing pinned, a run
// that failed a gate three times and then had that gate loosened looks exactly like a run that
// passed it, and the loosening is indistinguishable from the edit the documents recommend.
// A fingerprint is what lets the difference be noticed and said out loud; nothing here forbids
// anything.
//
// The map is name -> hash, and it is a map rather than one whole-file hash because a
// difference has to be reportable as "which rules moved" — a single digest can only say "the
// file is not what it was", which is unactionable and would fire on a comment.

export type GraphFingerprint = Record<string, string>;

// The one key in the map that is not a phase name: the whole `limits` mapping, hashed as a
// unit. `$`-prefixed, like the `$end` destination the schema already reserves, because that is
// this file's existing mark for "not a phase". A phase LITERALLY named `$limits` would collide
// with it; that is left as-is rather than answered with a new validation rule (the schema is
// not this change's to touch), and the collision is deterministic: this key is written last,
// so `limits` wins and the phase rides along with it.
export const LIMITS_KEY = "$limits";

// The field every phase hash leaves out, and the ONLY one — an exclusion list, not an
// allow-list. ADR-0003 makes `description` advisory (it is prose for the agent, changed
// constantly and routed on never), so a run must be able to reword it mid-flight without
// anyone being asked about it. Everything else is in, including fields added to the schema
// after this line was written: an allow-list would let a new routing field ship silently
// unpinned, which is the same trap ADR-0015 closes by rejecting unknown keys instead of
// ignoring them.
//
// `clear:` being in matters more than it looks. Deleting a `clear:` entry leaves the previous
// pass's artifact (a stale `APPROVED` verdict) in place for the next gate to find, which is a
// way of loosening a gate without touching the gate.
const UNPINNED_PHASE_KEY = "description";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Recursively key-sorted JSON, so the hash is of the PARSED STRUCTURE and not of the bytes.
// Comments, indentation, quoting style and key order are things YAML does not make the author
// keep; hashing raw bytes would report every one of them as a change to the rules, and a
// report that fires on reflowing a comment is a report nobody reads. Arrays keep their order:
// a gate's checks run in order and a k-way `on_pass` is resolved in order (ADR-0011), so
// moving an entry there IS a different rule.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isMap(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    sorted[key] = canonical(value[key]);
  }
  return sorted;
}

// `?? null` so an absent value hashes to something rather than to nothing: JSON.stringify
// (undefined) is undefined, and a `limits:` that isn't written at all still needs a hash, or
// the run could not tell "no ceiling" from "no pin".
function hashOf(value: unknown): string {
  return sha256(JSON.stringify(canonical(value) ?? null));
}

// The rules a run sitting on `from` is actually depending on: every phase reachable from
// there, plus `$limits`. Scoped that way because ADR-0016 §5 says what a run is owed — the
// definitions of the phases it has NOT ENTERED YET. A phase it has already walked past can be
// rewritten freely (that is how a workflow improves itself mid-run), and reporting such an
// edit would make the ordinary case noisy enough to train everyone to ignore the report.
// Reachability is the same walk `unreachable()` uses, `on_fail` edges included: a phase a
// failure can still route to is one this run can still land in.
export function graphFingerprint(wf: Workflow, from: string): GraphFingerprint {
  const names = new Set(Object.keys(wf.phases));
  const reachable = reachableFrom(from, wf.phases, names);
  const fingerprint: GraphFingerprint = {};
  // File order, not walk order: the difference is reported to a person as a list of names, and
  // the same pair of files must always produce the same list.
  for (const name of Object.keys(wf.phases)) {
    if (!reachable.has(name)) continue;
    const { [UNPINNED_PHASE_KEY]: _advisory, ...pinned } = wf.phases[name];
    fingerprint[name] = hashOf(pinned);
  }
  // Always present, even with no `limits:` in the file — see hashOf. A key that appears only
  // once a ceiling is declared would make declaring one look like a widened reachable set
  // (adopted in silence) rather than the change it is.
  fingerprint[LIMITS_KEY] = hashOf(wf.limits);
  return fingerprint;
}

// One digest standing for a whole computed map. Its only job is to answer "is this the same
// difference I already reported?", which is why it is a hash rather than a flag: after a report
// the file can be edited AGAIN, and a flag would let that second edit through unreported.
export function fingerprintDigest(fingerprint: GraphFingerprint): string {
  return hashOf(fingerprint);
}

// What moved, in the computed map's order. Only keys present in BOTH sides count, and that is
// the rule rather than an optimisation:
//   - computed-only means the run can now reach a phase it could not reach before (it walked
//     an edge, or an edit added one). It has never depended on that phase's rules, so there is
//     nothing to have changed under it — adopt it in silence.
//   - saved-only means the run has moved past a phase and can no longer reach it. Nothing it
//     does now depends on those rules — drop them in silence.
// Comparing the maps whole would report both as "changed" and turn every ordinary advance into
// an escalation.
export function changedFingerprintKeys(saved: GraphFingerprint, computed: GraphFingerprint): string[] {
  return Object.keys(computed).filter((key) => key in saved && saved[key] !== computed[key]);
}
