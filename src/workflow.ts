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
  env?: Record<string, unknown>;
  gate: { checks: Check[] };
  on_pass: string | Route[];
  on_fail?: string;
  max_attempts?: number;
  on_exhausted?: string;
  ready?: string;
}
export interface Workflow { version: number; name: string; entry: string; phases: Record<string, Phase>; limits?: { max_total_iterations?: number } }

const ON_FAIL_TOKENS = new Set(["retry", "$end", "escalate", "abort"]);
const ON_EXHAUSTED_TOKENS = new Set(["escalate", "abort"]);
const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;

// Warnings are things a run can proceed with; errors are not (they leave `workflow` null).
// The caller decides who gets to see the warnings: `validate` and `start` print them once,
// `next` never does — see cli.ts.
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
  if (doc.version !== 1) errors.push("version must be 1");
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
    else if (doc.limits.max_total_iterations !== undefined && !isPosInt(doc.limits.max_total_iterations)) {
      errors.push("limits.max_total_iterations must be a positive integer");
    }
  }

  // A warning, not an error (ADR-0011): a half-written phase or a temporarily commented-out
  // edge must not stop the run that is being used to write it. Only computed once the shape
  // is otherwise valid, since the walk below trusts the schema.
  if (errors.length === 0) warnings.push(...unreachable(doc.entry as string, phases as unknown as Record<string, Phase>, names));
  return { errors, warnings };
}

function validatePhase(name: string, p: Record<string, unknown>, names: Set<string>, errors: string[]): void {
  if (typeof p.description !== "string" || !p.description) errors.push(`phase '${name}': description is required`);

  const checks = (p.gate as Record<string, unknown> | undefined)?.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push(`phase '${name}': gate.checks is required and must be non-empty`);
  } else {
    checks.forEach((c: unknown, i: number) => {
      const check = isMap(c) ? c : null;
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

  if (p.env !== undefined && !isMap(p.env)) errors.push(`phase '${name}': env must be a mapping`);

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
  // 'escalate'/'abort' ends the run on the very first failure — attempts never
  // gets a chance to reach max_attempts, so one of the two settings is always dead.
  if (p.max_attempts !== undefined && (p.on_fail === "escalate" || p.on_fail === "abort")) {
    errors.push(`phase '${name}': max_attempts has no effect when on_fail is '${p.on_fail}' — the first failure already ends the run; remove one of them`);
  }
  if (p.on_exhausted !== undefined && (typeof p.on_exhausted !== "string" || !ON_EXHAUSTED_TOKENS.has(p.on_exhausted))) {
    errors.push(`phase '${name}': on_exhausted must be 'escalate' or 'abort'`);
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
