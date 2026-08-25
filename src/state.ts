// Responsibility: read/write .headsign/state.json; owns the run-state shape (ADR-0004) — and
// owns WHERE the three files live as well as what is in them. It hands out the path of the
// record, the log and the lock on request, so a caller that needs to test for a run's
// existence (the stop hooks, walking upward) asks here rather than joining path fragments of
// its own. Nowhere else in the program spells `.headsign/state.json`.
// Also owns I/O for .headsign/log (a sibling transition log; see ADR-0004) — line formatting
// itself lives in render.ts's logLine, not here — and "formatting" includes the terminator: an
// append writes exactly the bytes handed over and adds nothing, so a caller that omits the
// trailing newline runs its entry into the next one. Owning the file's I/O here does not mean
// framing its entries.
// Appending is the ONLY write offered, deliberately: see ADR-0024 for why and for who owns
// framing the seam between runs (render.ts, not here).
// The directory is the caller's choice and is taken on trust, never searched for — see
// ADR-0004's cwd-only resolution section.
// Absence and damage are reported differently, on purpose: no record at all comes back as
// `null` — the ordinary way to learn there is no run here — while a record that will not parse
// throws. They are not the same situation and a caller that treated them alike would read a
// damaged run as no run.
// It also owns the LOCK that serialises concurrent `next` in one directory — taking it,
// releasing it, and healing one whose holder has died; see ADR-0004's lock section and
// acquireLock/releaseLock below for the mechanics.
// Must NOT know about: routing rules, the workflow YAML schema.

import fs from "node:fs";
import path from "node:path";

type Status = "running" | "complete" | "escalated" | "aborted";

// Named for what it actually holds and not for a `current_failure` it can't honestly claim
// to be — see ADR-0012 §3 for the naming rationale.
export interface LastFailure {
  phase: string;
  check: string; run: string; exit_code: number | "timeout"; output_tail: string; timeout_seconds?: number;
  // How long the check actually ran (gate.ts's CheckFailure.elapsedSeconds, carried through
  // unmodified). Optional here, in engine.StatusFailure.elapsedSeconds, and in
  // render.Failure.elapsedSeconds, for the one same reason: a `state.json` written before this
  // field existed simply lacks it, and reading one back must not throw. This is the one place
  // that reason is written; the other two point here instead of repeating it.
  // TRANSITIONAL on the same criterion as this file's `driver_agent` field, read for the
  // release that added this field instead of the one that renamed that one — see
  // `driver_agent`'s doc for the full criterion, which applies unchanged here. It can go in
  // all three places at once once no run started before that release can plausibly still be in
  // progress — but not before gate.ts's `CheckFailure.elapsedSeconds` sheds its own `?`, which
  // expires on a different criterion: cli.ts hands render a `CheckFailure` directly.
  elapsed_seconds?: number;

  // How many times in a row, ending with this one, the SAME failure has landed. What counts as
  // the same is engine.ts's `sameFailureStreak`, which is where the comparison and the
  // increment both happen — deliberately not restated here, because a list of fields written
  // twice is a list that drifts (`what-headsign-protects` #5), and this one already did.
  // 1 the first time, and any difference resets it to 1 rather than continuing the count.
  // Optional for the one reason `elapsed_seconds` above documents (see there): a `state.json`
  // written before this field existed simply lacks it.
  repeats?: number;
}
// The two things that can make headsign let an `unheld` stop pass without holding it, spelled
// exactly as Claude Code spells each token (render.ts:352's rule for this slot) — see
// ADR-0006 for `stop_hook_active` and ADR-0026 for the `CLAUDE_PROJECT_DIR` fallback.
export type UnheldCause = "stop_hook_active" | "CLAUDE_PROJECT_DIR";

export interface State {
  workflow: string; workflow_path: string; status: Status; phase: string;
  attempts: Record<string, number>; total_iterations: number; last_failure: LastFailure | null;
  end_reason: string | null; stop_nudges: number;
  // Who currently drives this run — see ADR-0010 for the SubagentStop adoption gate that is
  // its only writer, and ADR-0013 for why an agent id is the only thing it ever holds.
  //
  // Named `driver_agent`, not the `driver_session` of ADR-0008/0010, and `driver_source` went
  // with the rename — see ADR-0013 §3 for why.
  //
  // A state.json written before this rename simply lacks the field; the tolerant-read rule
  // (a non-empty-string test, not a null check) is ADR-0013 §3's.
  //
  // The missing-field half of that tolerance is TRANSITIONAL, and this is the ONE place the
  // criterion for removing it is written — the two reader sites (stophook.ts's
  // recordedDriver, engine.ts's status) point here instead of restating it. It exists only
  // so a run already in progress across the rename keeps working; nothing headsign writes
  // today can produce a state.json without this field. It can go once no run started before
  // the release that renamed the field can plausibly still be in progress — i.e. that
  // release has shipped and enough time has passed that any older run has finished, been
  // aborted, or been abandoned. A run is one work session in one directory, not a long-lived
  // record, so that window is short: one release cycle is ample. Removing it means dropping
  // the `typeof … === "string"` guards at both reader sites for a plain null check. The
  // non-string *corrupt*-value half of the tolerance is not transitional and stays — a
  // hand-edited state.json is always possible.
  driver_agent: string | null;

  // When this run last ENTERED the phase it is standing on. Written in exactly one place —
  // beside the call that runs the phase's `clear:` — because that call IS the entry boundary
  // the schema already draws: `on_fail: retry` stays in the phase and clears nothing, while
  // `on_fail: <this same phase>` leaves and re-enters, clearing as it goes (ADR-0031). So a
  // retry does not move this, and a re-entry does.
  //
  // Distinct from `last_drive.at` below, which every `start` and `next` stamps whatever the
  // answer was — a RETRY moves that one and not this one. Read together they say how long the
  // run has been working on the phase it is on, and when anyone last touched it.
  //
  // null for a run that predates this field. Nothing headsign writes today produces one, and
  // like every other tolerated absence here it means "nothing to report", never "just now".
  phase_entered_at: string | null;

  // What headsign DID with the most recent turn end it both processed and could attribute to
  // this run — the current-value companion to the stop-boundary lines in `.headsign/log`; see
  // ADR-0025 §4 for why both exist.
  //
  // The four dispositions are headsign's own actions, never a claim about what the platform
  // did — see ADR-0025 §1-§2 (and ADR-0006 for `paused`/`stalled`) for what each one means.
  //
  // `cause` says WHICH overrule produced an `unheld` stop (see `UnheldCause` above) and is
  // present only on `unheld` records — see ADR-0026 §3/§6 for why it was added.
  //
  // `at` is a local ISO timestamp with a numeric offset, the same `nowIso` value the writers
  // receive as an argument — see ADR-0004's clock rule and ADR-0025 §6 for why no reader may
  // reformat it.
  //
  // Written by stophook.ts in the SAME `withRunLock` call as the log line it accompanies —
  // see ADR-0025 §4 for why that makes a second representation of one event safe.
  //
  // Deliberately stale-able, the same limit `status`'s `driver:` line carries — see ADR-0025
  // §4's "Not written" paragraph.
  //
  // A state.json written before this field existed simply lacks it, so every reader must treat
  // anything that is not a well-formed object (missing, null, a non-object, or an object whose
  // `disposition`/`at` are not one of the four words and a string) as null. The missing-field
  // half of that tolerance is TRANSITIONAL on exactly the criterion written for `driver_agent`
  // above, read for the release that added THIS field; the malformed-value half is permanent,
  // because a hand-edited state.json is always possible. `cause` carries the SAME transitional
  // tolerance one field later: an `unheld` record written before `cause` existed lacks it
  // entirely, which a reader must treat as "the only cause `unheld` had back then"
  // (`stop_hook_active`) rather than as damage — see render.ts's default for exactly that
  // reading, which doubles as the fallback for a well-formed record that simply omits it.
  //
  // `note` carries the pause note's first line, already truncated the same way the `paused`
  // `.headsign/log` line's is (stophook.ts computes that value once and this field reuses it,
  // never a second truncation) — present only when `disposition` is `"paused"`. Optional for
  // the same reason `LastFailure.elapsed_seconds` is optional; see there.
  last_stop: { disposition: "nudged" | "unheld" | "paused" | "stalled"; at: string; cause?: UnheldCause; note?: string } | null;

  // The session that most recently DROVE this run — ran `start`, or a `next` that reached the
  // run — never who is driving it now, which is `driver_agent`'s question, answered by a
  // completely different mechanism. See ADR-0027 §2/§4 for why it needed its own field.
  //
  // `null` is not damage here, unlike almost everywhere else in this file: it is the ordinary
  // value for a run driven from outside Claude Code, and reads as UNKNOWN, never as a mismatch
  // — see ADR-0027 §3 step 6 for why that half of the read is load-bearing.
  //
  // Written by `start` and by every `next` that reaches the run — PENDING and the global
  // ceiling included; `abort`, `claim`, `status` and `validate` never write it. See ADR-0027
  // §4-§5 for why, and why it sits beside `last_stop` rather than inside it.
  //
  // Two tolerances, on DIFFERENT clocks — unlike most fields in this file, where one criterion
  // covers both. A state.json missing the field entirely (written before it existed) is
  // TRANSITIONAL, on the same criterion `driver_agent`'s doc states above, read for the
  // release that added THIS field rather than driver_agent's rename: it can go once no run
  // that predates that release can plausibly still be in progress. A well-formed-but-wrong
  // value (a hand-edited record) is PERMANENT tolerance, same as everywhere else.
  //
  // `session` must never reach render.ts, which is what keeps `status` from ever printing an
  // identifier — see ADR-0027 §7.
  last_drive: { session: string; at: string } | null;

  // --- the graph pin: the rules this run has been running under ---
  //
  // These three fields are what makes a mid-run workflow edit VISIBLE; nothing here prevents
  // one — see ADR-0023 for why and ADR-0016 §5/ADR-0017 for why the edit is sanctioned.
  //
  // `graph_fingerprint` is workflow.ts's name -> hash map for the phases this run can still
  // reach, plus `$limits`; `graph_change_reported` is the digest of a change not yet accepted;
  // `accepted_graph_changes` is the count `COMPLETE` reports — see ADR-0023 §§1,5,8.
  //
  // engine.ts owns when these are compared and what happens on a difference; render.ts owns
  // the wording. This module owns only the shape (ADR-0023).
  //
  // A state.json written before these fields existed simply lacks all three; readers must
  // treat a missing/non-map `graph_fingerprint` as "not pinned yet" (adopt what is on disk in
  // silence — a run that never pinned anything cannot have had it changed under it), a
  // non-string `graph_change_reported` as null, and a non-number `accepted_graph_changes` as
  // 0. Same tolerant idiom as `driver_agent` above and `stop_nudges`.
  //
  // The missing-field half of that tolerance is TRANSITIONAL, on exactly the criterion written
  // for `driver_agent` above and repeated here rather than pointed at, because the two will
  // not expire together: it can go once no run started before the release that ADDED THESE
  // THREE FIELDS can plausibly still be in progress — i.e. that release has shipped and enough
  // time has passed that any older run has finished, been aborted, or been abandoned. A run is
  // one work session in one directory, not a long-lived record, so one release cycle is ample.
  // Removing it means dropping the missing-field arm of engine.ts's three reader helpers
  // (recordedFingerprint / recordedGraphMarker / acceptedGraphChanges) — the corrupt-value arm
  // is not transitional and stays.
  graph_fingerprint: Record<string, string>;
  graph_change_reported: string | null;
  accepted_graph_changes: number;
}

export function statePath(cwd: string): string {
  return path.join(cwd, ".headsign", "state.json");
}

export function readState(cwd: string): State | null {
  const p = statePath(cwd);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as State) : null;
}

export function writeState(cwd: string, state: State): void {
  const dir = path.join(cwd, ".headsign");
  fs.mkdirSync(dir, { recursive: true });
  const target = statePath(cwd);
  // Temp file + rename in the same dir — the atomic-write guarantee ADR-0004 states.
  // The `Date.now()` here is a uniquifier, not a time anyone reads back, which is why it sits
  // outside ADR-0004's rule that cli.ts alone reads the wall clock: that rule is about a
  // datetime that lands on disk, and this one lands in a filename that is renamed away.
  const tmp = path.join(dir, `.state.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

export function lockPath(cwd: string): string {
  return path.join(cwd, ".headsign", "lock");
}

export function logPath(cwd: string): string {
  return path.join(cwd, ".headsign", "log");
}

export function appendLog(cwd: string, line: string): void {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  fs.appendFileSync(logPath(cwd), line);
}

// Serializes concurrent `headsign next` in the same .headsign/ — see ADR-0004's lock section
// for why.
export function acquireLock(cwd: string): { ok: true } | { ok: false; pid: number } {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  const p = lockPath(cwd);
  // Create the lock with its pid ALREADY INSIDE IT, in one atomic step: write the pid to a
  // private temp file, then hard-link that file into place — see ADR-0004's lock section for
  // why creating first and writing the pid second was a real, measured race.
  const tryCreate = (): { ok: true } | null => {
    const tmp = path.join(path.dirname(p), `.lock.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, String(process.pid));
      fs.linkSync(tmp, p);
      return { ok: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return null;
    } finally {
      // The link (or the failure to make one) is the whole result; the temp file has no
      // further job. Best effort: a leftover would be harmless but pointless.
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    }
  };

  const first = tryCreate();
  if (first) return first;

  const holderPid = readLockPid(p);
  if (holderPid !== null && isAlive(holderPid)) return { ok: false, pid: holderPid };

  // A crashed holder must not wedge future runs forever — see ADR-0004's "stale locks
  // self-heal" section.
  try {
    fs.unlinkSync(p);
  } catch {
    // already gone — fall through to the retry below
  }
  const second = tryCreate();
  if (second) {
    // Two processes can both observe the same dead holder and attempt to steal — see
    // ADR-0004's lock section for why the read-back after create is what decides who won.
    if (readLockPid(p) === process.pid) return { ok: true };
    return { ok: false, pid: readLockPid(p) ?? -1 };
  }
  return { ok: false, pid: readLockPid(p) ?? -1 };
}

export function releaseLock(cwd: string): void {
  try {
    // Only remove the lock if we're still its owner — see ADR-0004's lock section for why.
    if (readLockPid(lockPath(cwd)) === process.pid) fs.unlinkSync(lockPath(cwd));
  } catch {
    // nothing to release, or another process already cleaned it up
  }
}

function readLockPid(p: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(p, "utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means still alive, anything else means dead — the rule ADR-0004's lock section
    // states.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
