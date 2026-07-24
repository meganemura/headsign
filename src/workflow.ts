// Responsibility: load + validate workflow.yaml; owns the schema types (ADR-0003).
// Must NOT know about: state.json, gate execution, git.

import fs from "node:fs";
import { parse as parseYaml } from "yaml";

export interface Check { name?: string; run: string; timeout?: number }
export interface Phase {
  description: string;
  clear?: string[];
  env?: Record<string, unknown>;
  gate: { checks: Check[] };
  on_pass: string;
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

export function load(path: string): { workflow: Workflow | null; errors: string[] } {
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(path, "utf8"));
  } catch (err) {
    return { workflow: null, errors: [`could not read/parse ${path}: ${(err as Error).message}`] };
  }
  const errors = validate(doc);
  return errors.length > 0 ? { workflow: null, errors } : { workflow: doc as Workflow, errors: [] };
}

export function validate(doc: unknown): string[] {
  if (!isMap(doc)) return ["workflow must be a YAML mapping"];
  const errors: string[] = [];
  if (doc.version !== 1) errors.push("version must be 1");
  if (typeof doc.name !== "string" || !doc.name) errors.push("name is required");
  if (typeof doc.entry !== "string" || !doc.entry) errors.push("entry is required");

  if (!isMap(doc.phases) || Object.keys(doc.phases).length === 0) {
    errors.push("phases is required and must be a non-empty mapping");
    return errors;
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

  if (errors.length === 0) errors.push(...unreachable(doc.entry as string, phases as unknown as Record<string, Phase>, names));
  return errors;
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

  if (typeof p.on_pass !== "string" || !p.on_pass) errors.push(`phase '${name}': on_pass is required`);
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

function unreachable(entry: string, phases: Record<string, Phase>, names: Set<string>): string[] {
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (visited.has(name) || !names.has(name)) continue;
    visited.add(name);
    for (const t of [phases[name].on_pass, phases[name].on_fail]) if (typeof t === "string" && names.has(t)) stack.push(t);
  }
  return [...names].filter((n) => !visited.has(n)).map((n) => `phase '${n}' is unreachable from entry '${entry}'`);
}
