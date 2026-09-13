// Responsibility: validate a run's optimization identity and assessment record.
// This module does not judge the assessment text or prove that an improvement occurred.

import fs from "node:fs";
import path from "node:path";
import type { State } from "./state.ts";

export type AssessmentDisposition = "NO_CHANGE" | "APPLIED" | "PROPOSED" | "DEFERRED";

const DISPOSITIONS: readonly AssessmentDisposition[] = ["NO_CHANGE", "APPLIED", "PROPOSED", "DEFERRED"];
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function metadata(record: State): NonNullable<State["optimization"]> | null {
  const value: unknown = record.optimization;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as { id?: unknown; stop_requested?: unknown; friction_noticed?: unknown };
  if (typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id)) return null;
  if (typeof candidate.stop_requested !== "boolean" || typeof candidate.friction_noticed !== "boolean") return null;
  return { id: candidate.id, stop_requested: candidate.stop_requested, friction_noticed: candidate.friction_noticed };
}

export function assessmentPath(cwd: string, record: State): string | null {
  const value = metadata(record);
  return value === null ? null : path.join(cwd, ".headsign", "optimization", value.id, "assessment.md");
}

export type AssessmentState = "assessed" | "unassessed" | "unavailable";

export function assessmentState(cwd: string, record: State): AssessmentState {
  const file = assessmentPath(cwd, record);
  if (file === null) return "unassessed";
  try {
    const details = fs.statSync(file);
    if (!details.isFile() || details.size > 65_536) return "unassessed";
    const normalized = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const newline = normalized.indexOf("\n");
    if (newline < 0) return "unassessed";
    const first = normalized.slice(0, newline);
    const rest = normalized.slice(newline + 1).trim();
    return DISPOSITIONS.includes(first as AssessmentDisposition) && rest.length > 0 ? "assessed" : "unassessed";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "unassessed" : "unavailable";
  }
}

export function hasAssessment(cwd: string, record: State): boolean {
  return assessmentState(cwd, record) === "assessed";
}

export function guidance(cwd: string, record: State): string | null {
  const file = assessmentPath(cwd, record);
  if (file === null || hasAssessment(cwd, record)) return null;
  return `Use the bundled \`optimize\` skill, then record its disposition at ${file}.`;
}
