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
// Appending is the ONLY write offered, deliberately. `start` used to truncate the log first, so
// the file held exactly one run — but it is gitignored, which makes it the only copy of what
// happened, and so `abort` -> edit -> `start` erased the aborted run's stated reason at the
// moment the next run began. The log now survives a restart. Nothing is inserted to mark the
// seam between runs: each run already opens with its own `start` line, and inventing a
// separator would be framing, which is render.ts's to do.
// The directory is the caller's choice and is taken on trust: the record and the log are read
// and written under the directory handed in, never one found by searching upward.
// Absence and damage are reported differently, on purpose: no record at all comes back as
// `null` — the ordinary way to learn there is no run here — while a record that will not parse
// throws. They are not the same situation and a caller that treated them alike would read a
// damaged run as no run.
// It also owns the LOCK that serialises concurrent `next` in one directory — taking it,
// releasing it, and healing one whose holder has died. Releasing only removes the file when
// the pid inside is still yours, so releasing a lock you never took is harmless; taking one
// answers either "you have it" or "somebody else does, and here is their pid".
// A write REPLACES the record; nothing is merged with what was there, so a partial record
// handed in loses every field it left out.
// Must NOT know about: routing rules, the workflow YAML schema.

import fs from "node:fs";
import path from "node:path";

type Status = "running" | "complete" | "escalated" | "aborted";

// Named for what it actually holds: not "the last evaluation" (it is null after a pass, a
// route, and any terminal outcome — only a *failure* ever lands here) but the last failure
// headsign observed. The name also matches the one place it surfaces, `status`'s
// `--- last failure: … ---` block, which is the reason the field exists at all.
// Not `current_failure`: by the time anyone reads it the agent may have already fixed the
// failure without running `next`, so headsign can only honestly claim the last one it saw.
export interface LastFailure {
  phase: string;
  check: string; run: string; exit_code: number | "timeout"; output_tail: string; timeout_seconds?: number;
  // How long the check actually ran (gate.ts's CheckFailure.elapsedSeconds, carried through
  // unmodified). Optional for the same reason `timeout_seconds` is: a state.json written
  // before this field existed simply lacks it, and that must read back fine, not throw.
  elapsed_seconds?: number;
}
// The two things that can make headsign let an `unheld` stop pass without holding it — named
// for the Claude Code token each one rests on, spelled exactly as that token is spelled
// (render.ts:352's rule for this slot: the upstream name travels verbatim from the log line
// through headsign's source to something a person can print, so the type may not paraphrase
// it). `stop_hook_active` is Claude Code's own already-continuing flag; `CLAUDE_PROJECT_DIR`
// is the second starting point the stop-boundary hooks fall back to when the walk up from the
// session's own directory finds no run (ADR-0026).
export type UnheldCause = "stop_hook_active" | "CLAUDE_PROJECT_DIR";

export interface State {
  workflow: string; workflow_path: string; status: Status; phase: string;
  attempts: Record<string, number>; total_iterations: number; last_failure: LastFailure | null;
  end_reason: string | null; stop_nudges: number;
  // Who currently drives this run: the agent id sealed by the SubagentStop hook's adoption
  // gate when a delegated agent that ran `headsign claim` ends its own turn (ADR-0010),
  // or null when nobody has claimed the run.
  //
  // Named `driver_agent`, not the `driver_session` of ADR-0008/0010: the adoption
  // gate is now the only writer, and what that gate writes is always an agent id.
  // A session id can no longer land here, so calling the field `session` would be a lie
  // (ADR-0013). The companion `driver_source` field went with it — one writer means one
  // identifier space, so there is nothing left to discriminate.
  //
  // A state.json written before this rename simply lacks the field; readers must treat
  // anything that isn't a string (missing, or a legacy/corrupt non-string value) as null,
  // the same tolerant idiom stophook.ts already uses for stop_nudges.
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

  // What headsign DID with the most recent turn end it both processed and could attribute to
  // this run — the current-value companion to the stop-boundary lines in `.headsign/log`, in
  // the same way `driver_agent` sits beside `claimed` (the log holds the event, the record
  // holds the value; ADR-0004 calls this file the external memory).
  //
  // The four dispositions are headsign's own actions, never a claim about what the platform
  // did: `nudged` (the turn was held and pointed back at `headsign next`), `unheld` (the turn
  // end arrived carrying a signal headsign treats as an overrule, so it let the stop pass
  // without holding it — stophook.ts owns every branch that can produce this), `paused` (a
  // pause note was consumed) and `stalled` (the nudge cap was already spent, so the stop
  // passed).
  //
  // `cause` says WHICH overrule produced an `unheld` stop — see `UnheldCause` above for what the
  // two values mean and why they are spelled the way they are. Present only on `unheld` records:
  // the other three dispositions are entirely headsign's own doing and have nothing upstream to
  // name, so a `cause` on any of them would claim an overrule that did not happen. Required by
  // render.ts's `status` wording, which has to say which cause applied rather than hardcoding
  // one (ADR-0026) — before this field existed, `unheld` had exactly one cause, so nothing
  // downstream needed to ask.
  //
  // `at` is a local ISO timestamp with a numeric offset — the same `nowIso` value the writers
  // already receive as an argument. Nothing in this module reads the clock, and no reader may
  // reformat the value: only the writer knew the reader's timezone.
  //
  // Written by stophook.ts in the SAME `withRunLock` call as the log line it accompanies. That
  // is what makes a second representation of one event safe rather than a smell — the field and
  // the line land together or neither does.
  //
  // Deliberately stale-able: it describes the last stop headsign could attribute, so after a
  // bystander's turn end it still describes an earlier one. Same limit `status`'s `driver:` line
  // carries, and it gets the same treatment — printed, with the limit written down.
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
  last_stop: { disposition: "nudged" | "unheld" | "paused" | "stalled"; at: string; cause?: UnheldCause } | null;

  // The session that most recently DROVE this run — ran `start`, or a `next` that reached the
  // run (ADR-0027) — never who is driving it now. That is `driver_agent`'s question, answered
  // by a completely different mechanism (the SubagentStop adoption gate above), and this field
  // is neither read nor written by it: two writers sharing one field is the exact hazard
  // ADR-0009 had to manage with a stickiness rule, and giving the stamp its own field removes
  // the hazard instead of reproducing it (see `driver_agent`'s doc above and ADR-0027 §2).
  //
  // `null` is not damage here, unlike almost everywhere else in this file: it is the ordinary
  // value for a run `start`ed or `next`ed from outside Claude Code (a plain shell has no
  // session id to record). "No stamp" reads as UNKNOWN, never as a mismatch — stophook.ts's
  // reader falls through to the fail-open nudge (ADR-0006) for a null or missing stamp exactly
  // as it does for a run that predates this field. That is why the load-bearing half of the
  // read is "does a stamp exist at all", checked strictly before "does it match".
  //
  // Written by `start` (in freshState below, beside `last_stop: null`, never inside it — the
  // two answer different questions, and nesting one inside the other would force a meaning
  // onto `last_stop` for a run that has never stopped) and by every `next` that reaches the
  // run (engine.ts's `next`, under the same lock the rest of the lap already holds) — PENDING
  // and the global ceiling included, because both are the normal shape of a driver walking
  // away to wait, exactly what the backstop exists to cover. `abort`, `claim`, `status` and
  // `validate` never write it.
  //
  // Two tolerances, on DIFFERENT clocks — unlike most fields in this file, where one criterion
  // covers both. A state.json missing the field entirely (written before it existed) is
  // TRANSITIONAL, on the same criterion `driver_agent`'s doc states above, read for the
  // release that added THIS field rather than driver_agent's rename: it can go once no run
  // that predates that release can plausibly still be in progress. A well-formed-but-wrong
  // value (a hand-edited record) is PERMANENT tolerance, same as everywhere else.
  //
  // Read in exactly two places: stophook.ts's recordedDriveSession (the whole `{ session, at
  // }`, compared against a Stop payload's own session id) and engine.ts's status reader,
  // which takes only `at` — `session` must never reach render.ts, which is what keeps
  // `status` from ever printing an identifier (ADR-0027 §7).
  last_drive: { session: string; at: string } | null;

  // --- the graph pin: the rules this run has been running under ---
  //
  // A run re-reads its workflow file every lap and may rewrite it as it goes (ADR-0016 §5,
  // ADR-0017). These three fields are what makes such a change VISIBLE; nothing here prevents
  // one, and nothing could — anything that can edit the workflow can edit this file too.
  //
  // `graph_fingerprint` is workflow.ts's name -> hash map for the phases this run can still
  // reach, plus `$limits`. `graph_change_reported` is the digest of the changed map a person
  // has already been shown and has not yet accepted (null when there is nothing outstanding) —
  // a digest and not a flag, so a second edit made after the report cannot ride in on the
  // first one's acknowledgement. `accepted_graph_changes` is how many such changes this run
  // has accepted, and it is the number COMPLETE reports: `.headsign/log` is gitignored, so a
  // count that only lived there would never reach the person reading the pull request.
  //
  // engine.ts owns when these are compared and what happens on a difference; render.ts owns
  // the wording. This module owns only the shape.
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
  // Temp file + rename in the same dir: a process killed mid-write must never
  // leave a half-written (unparseable) state.json behind.
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

// Serializes concurrent `headsign next` in the same .headsign/ (e.g. multiple subagents
// delegated to at once): an exclusive create is atomic, so exactly one caller wins.
export function acquireLock(cwd: string): { ok: true } | { ok: false; pid: number } {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  const p = lockPath(cwd);
  // Create the lock with its pid ALREADY INSIDE IT, in one atomic step: write the pid to a
  // private temp file, then hard-link that file into place. `link` fails with EEXIST when the
  // lock exists, so exactly one caller still wins — and no other process can ever observe the
  // lock file empty.
  //
  // That window was real, not theoretical. Creating the file and then writing the pid leaves
  // it empty for a moment, and a reader that finds an unparseable lock concludes the holder
  // is dead and steals it (see below — that steal is what stops a crashed run wedging the
  // directory forever). So a second process could steal a lock the first was still in the
  // middle of taking, after which both believed they held it, both evaluated, and one's write
  // silently overwrote the other's attempt increment. It surfaced as an intermittent failure
  // in the concurrency regression test, under load, roughly one run in three.
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

  // A crashed holder must not wedge future runs forever: an unparseable or dead pid
  // means the lock outlived its owner, so steal it and retry once.
  try {
    fs.unlinkSync(p);
  } catch {
    // already gone — fall through to the retry below
  }
  const second = tryCreate();
  if (second) {
    // Two processes can both observe the same dead holder and both unlink+create; since
    // pids are distinct, a read-back after the steal tells us whether we actually won or
    // the other stealer's create landed last and clobbered ours.
    if (readLockPid(p) === process.pid) return { ok: true };
    return { ok: false, pid: readLockPid(p) ?? -1 };
  }
  return { ok: false, pid: readLockPid(p) ?? -1 };
}

export function releaseLock(cwd: string): void {
  try {
    // Only remove the lock if we're still its owner — a concurrent stealer may have
    // already taken over the (previously dead) lock we think we hold.
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
    // EPERM means a process with that pid exists but we can't signal it — still alive.
    // ESRCH (or anything else) means no such process — treat as dead.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
