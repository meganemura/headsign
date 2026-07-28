// Responsibility: load + validate workflow.yaml; owns the schema types (ADR-0003).
// Must NOT know about: state.json, gate execution, git.

import fs from "node:fs";
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

  // A warning, not an error (ADR-0011): a half-written phase or a temporarily commented-out
  // edge must not stop the run that is being used to write it. Only computed once the shape
  // is otherwise valid, since the walk below trusts the schema.
  if (errors.length === 0) warnings.push(...unreachable(doc.entry as string, phases as unknown as Record<string, Phase>, names));
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

function unreachable(entry: string, phases: Record<string, Phase>, names: Set<string>): string[] {
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (visited.has(name) || !names.has(name)) continue;
    visited.add(name);
    for (const t of routeTargets(phases[name])) if (typeof t === "string" && names.has(t)) stack.push(t);
  }
  return [...names].filter((n) => !visited.has(n)).map((n) => `phase '${n}' is unreachable from entry '${entry}'`);
}
