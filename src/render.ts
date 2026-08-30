// Responsibility: outcome -> text. The ONLY place the output contract (ADR-0002) is written.
// Also the only place the .headsign/log line format is written (logLine); state.ts owns
// that file's I/O, cli.ts owns the timestamp.
// And a third kind of text, which is neither of those two: `gateProgress` (ADR-0032). It is
// composed here like everything else, and cli.ts writes it to stderr WHILE a gate is running
// — before the lap has an outcome to report at all — so it is no part of the output contract
// above. A reader looking for "what this module composes" gets all three from this paragraph;
// counting only the first two is how the third would drift out of anyone's view.
// A log line is composed from the state AFTER the event it describes: the counters printed
// come straight out of what it is handed, so passing the state from before a transition
// produces a line that reads correctly and counts wrong, and nothing here would notice.
// Must NOT know about: HOW any of it was decided — the routing rules, the gates, or what made
// a counter the number it is. It is handed the run's state and reads values straight out of
// it (the phase, the attempt count, the iteration count) precisely because reading is all it
// does; the exclusion is about the reasoning, not about the data. That wording used to say
// "must not know about … state", which a seam sweep caught as a contradiction with the line
// above it.

import type { Outcome, NotCleared, NotClearedReason } from "./engine.ts";
import type { State, UnheldCause } from "./state.ts";

export function start(phase: string, description: string, cleared?: string[], notCleared?: NotCleared[]): string {
  return `START ${phase}\n${clearedBlock(cleared)}${notClearedBlock(notCleared)}--- phase: ${phase} ---\n${description}\n`;
}

// --- gate progress: printed to stderr while a gate runs, never to stdout (ADR-0032) ---
//
// A structural echo of gate.ts's `GateProgress`, not an import of it — the same precedent
// `Failure` below follows: this file prints from a shape it declares itself, so a change to
// gate.ts's own type breaks the call site here rather than silently reprinting whatever gate.ts
// now sends.
type GateProgress =
  | { kind: "gate"; total: number }
  | { kind: "check"; index: number; total: number; name: string; elapsedSeconds: number; timeoutSeconds: number; outcome: "passed" | "failed" | "timed out" };

// Where the second number joins the first — a display threshold on a limit the workflow already
// declared (`timeout:`, or gate.ts's default when the author wrote none), not a budget of
// headsign's own: nothing fails here, and nothing is bounded by it. Below it, a check's own
// duration reads as unremarkable on its own; at or past it, the duration alone no longer says
// whether the check is close to its limit or nowhere near it, so the line names the limit too
// (ADR-0032's "Half is where the second number appears" paragraph). Consulted only for a passed
// or failed check — a timed-out one names the limit without this comparison, for the reason
// `gateProgress` below gives.
const HALF_OF_LIMIT = 0.5;

// One line, called once per event cli.ts's sink receives: the gate's size before the first
// check starts, then one more per check that finished, whichever of three ways it went —
// `outcome` supplies the word, and a timeout gets one of its own rather than reading as an
// ordinary failure (ADR-0032 §3): on the three paths where a failure ends the run, this line is
// the only report the check gets at all. `elapsedSeconds` prints with no forced decimal (a whole
// second reads `2s`), the same way `clause()` below prints a failing check's — and so does the
// limit beside it, once `elapsedSeconds` has reached `HALF_OF_LIMIT` of `timeoutSeconds`, OR
// whenever `outcome` is `timed out`, checked on its own rather than folded into that comparison.
// A killed check reached its limit by definition — headsign knows that from the fact of being
// killed, not from measuring — while `elapsedSeconds` is a measurement rounded to one decimal,
// and a `timeout:` under a tenth of a second (the schema allows any positive number) can round
// its elapsed time down to `0`, landing below half of that same tiny limit. The rounded number is
// the wrong evidence for a question the fact already answers exactly.
export function gateProgress(p: GateProgress): string {
  if (p.kind === "gate") {
    return `--- gate: ${p.total} ${p.total === 1 ? "check" : "checks"} ---\n`;
  }
  const ofLimit = p.outcome === "timed out" || p.elapsedSeconds >= p.timeoutSeconds * HALF_OF_LIMIT ? ` of ${p.timeoutSeconds}s` : "";
  return `--- check ${p.index}/${p.total} ${p.outcome}: ${p.name} (${p.elapsedSeconds}s${ofLimit}) ---\n`;
}

// `elapsedSeconds` (gate.ts's CheckFailure field, carried through engine.ts unmodified) is
// optional for the one reason state.ts's `LastFailure.elapsed_seconds` documents (see there):
// a `state.json` written before this field existed reads back as a `last_failure` with no
// `elapsedSeconds` on it. `unrunnable`/`pass` are not a second reason — neither ever reaches
// this type at all (see `durSuffix` below: every live `fail` sets it). `clause()` below omits
// the clause rather than print `undefined`.
// `checksTotal`/`checksRun`/`notRunChecks` (gate.ts's CheckFailure fields, carried through
// engine.ts unmodified) are optional for the same reason `elapsedSeconds` above is: a fixture
// built before these fields existed has none of them. `notRunLine` below reads their absence,
// or an empty `notRunChecks`, as "nothing to add" rather than printing an empty line.
type Failure = {
  check: string; run: string; exitCode: number | "timeout"; timeoutSeconds?: number; elapsedSeconds?: number;
  checksTotal?: number; checksRun?: number; notRunChecks?: string[];
};

// `routedBy` is present only for a k-way `on_pass` (ADR-0011) and adds exactly one line, in
// the same slot the gate-failed line uses (the two never co-occur: one is the pass path, the
// other the fail-route path). A string-form `on_pass` adds nothing, so the output of every
// workflow written before k-way routing is unchanged to the byte.
export function advance(
  phase: string,
  description: string,
  failure?: Failure & { routedTo: string },
  cleared?: string[],
  notCleared?: NotCleared[],
  routedBy?: { when: string } | { default: true },
): string {
  // A fail-routed ADVANCE is a gate failure like any other, so it carries the same
  // never-reached-these-checks line a RETRY does — the destination differs, what the gate got
  // through does not. Reported here as well as on RETRY because the phase a failure routes AWAY
  // from is exactly the one nobody comes back to look at.
  const failedLine = failure
    ? `--- gate failed: ${failure.check} (${clause(failure.run, failure.exitCode, failure.timeoutSeconds, failure.elapsedSeconds)}) → routed to ${failure.routedTo} ---\n` +
      notRunLine(failure.checksRun, failure.checksTotal, failure.notRunChecks)
    : "";
  const routedLine = routedBy ? `--- routed: ${"when" in routedBy ? `when "${routedBy.when}"` : "default"} → ${phase} ---\n` : "";
  return `ADVANCE ${phase}\n${clearedBlock(cleared)}${notClearedBlock(notCleared)}${failedLine}${routedLine}--- phase: ${phase} ---\n${description}\n`;
}

// One `--- cleared: <path> ---` line per file clearPhaseArtifacts (engine.ts) reports as
// removed; that function's own comment is why it is worth announcing.
function clearedBlock(cleared?: string[]): string {
  return (cleared ?? []).map((p) => `--- cleared: ${p} ---\n`).join("");
}

// One `--- not cleared: <path> (...) ---` line per entry clearPhaseArtifacts (engine.ts) found
// and could not remove — a directory, which is the one thing it classifies here. The reason
// is written into the line itself rather than left for the reader to look up, same as every
// other line this module prints. Sits right after clearedBlock's lines, in the same slot: what
// `clear:` did, and then what it could not, before anything else start/advance has to say.
const NOT_CLEARED_CLAUSE: Record<NotClearedReason, string> = {
  directory: "a directory — `clear:` removes files only",
  // Named as a fact about where the path landed, not as an accusation: a build directory
  // symlinked out of the tree reaches this the same way a crafted one does.
  outside: "resolves outside this run's directory",
};

function notClearedBlock(notCleared?: NotCleared[]): string {
  return (notCleared ?? []).map((n) => `--- not cleared: ${n.path} (${NOT_CLEARED_CLAUSE[n.reason]}) ---\n`).join("");
}

// PENDING vs RETRY, and why the `ready:` probe is uncounted: ADR-0002's Consequences
// (the PENDING paragraph) and its transition-table `ready:` note.
export function pending(phase: string, description: string, ready: string): string {
  return (
    `PENDING ${phase}\n` +
    `--- not ready yet — no attempt counted (readiness: ${ready}) ---\n` +
    `--- phase: ${phase} ---\n${description}\n` +
    "This is not a failure. Do the work above so the gate can run, then run `headsign next` again.\n"
  );
}

// `repeats` (engine.ts's sameFailureStreak, carried on the RETRY Outcome) is optional here for
// the same reason `elapsedSeconds` above is: a caller can omit it, and 1 or fewer means nothing
// to add — the byte-identical output every RETRY produced before this field existed. Only
// `repeats >= 2` — a SECOND identical failure, not the first — changes anything: one extra line
// naming the count, and the closing sentence itself, which says what changed and what it means
// (check the check, not "fix and retry") rather than asserting the gate cannot pass — that
// would need running an arbitrary shell to know, and is not this function's business.
export function retry(o: Failure & { phase: string; attempt: number; maxAttempts?: number; outputTail: string; repeats?: number }): string {
  const n = o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  // Right after the gate-failed line, ahead of the repeats line: this one is about the gate's
  // own shape (how many of its checks this lap reached), the repeats line is about history
  // across laps — see notRunLine's own comment for why that ordering is deliberate.
  const notRun = notRunLine(o.checksRun, o.checksTotal, o.notRunChecks);
  const repeating = o.repeats !== undefined && o.repeats >= 2;
  const repeatLine = repeating ? `--- same check, same exit code, same output as last time — ${o.repeats} in a row ---\n` : "";
  // Said only where a budget exists to run out of: a phase with no `max_attempts` has nothing
  // to spend, so asserting a run-ending consequence there would be a claim this function cannot
  // back up. Starting over begins at the workflow's entry phase (engine.ts's `start`), which is
  // the one fact this sentence states. Deliberately NOT phrased as `headsign start`: a bare
  // `start` resolves `.headsign/workflow.yaml` (cli.ts's resolveWorkflowPath) and exits 3 in a
  // repository whose workflows are all named, which is where this sentence would be read most.
  // This function is not handed the run's workflow path, and the sentence does not need it — the
  // fact is where a new run begins, not which command spells it.
  const exhaustionClause =
    repeating && o.maxAttempts !== undefined
      ? " Once attempts run out, this run ends, and a new one starts over from the entry phase."
      : "";
  const closing = repeating
    ? `This check produced exactly what it produced last time. If you changed something since, this check is not reading it; if you did not, work out whether this gate can pass at all before spending the rest of your attempts.${exhaustionClause}\n`
    : "Fix the failure above, then run `headsign next` again.\n";
  return `RETRY ${n} ${o.phase}\n--- gate failed: ${o.check} (${clause(o.run, o.exitCode, o.timeoutSeconds, o.elapsedSeconds)}) ---\n${notRun}${repeatLine}${o.outputTail}\n${closing}`;
}

// One line naming what this lap's gate never got to, right after the gate-failed line: `runGate`
// still stops at the first failure (unchanged — see gate.ts), so the checks after it never ran;
// this line is where the output says so. Suppressed when there is nothing to name — the
// failing check was the last one, or the trio is absent (an old fixture built before this field
// existed) — "N of N ran, 0 not run" states nothing a reader didn't already know from the RETRY
// line itself.
// Same `checksRun >= checksTotal` suppression test as ranSuffix below, so a fixture can never
// make the RETRY output and the log line disagree about whether anything was left unrun.
function notRunLine(checksRun?: number, checksTotal?: number, notRunChecks?: string[]): string {
  if (checksRun === undefined || checksTotal === undefined || notRunChecks === undefined || checksRun >= checksTotal) return "";
  return `--- ${checksRun} of ${checksTotal} checks ran; ${notRunChecks.length} not run: ${notRunChecks.join(", ")} ---\n`;
}

// ADR-0016 §5 allows a run to rewrite its own workflow while running; ADR-0023 §8 is why the
// count is reported HERE, on COMPLETE, rather than only in the gitignored log.
export function complete(name: string, acceptedGraphChanges?: number): string {
  const accepted = acceptedGraphChanges ?? 0;
  const changeLine =
    accepted > 0 ? `This run accepted ${accepted} ${accepted === 1 ? "change" : "changes"} to its own workflow rules while it was running.\n` : "";
  return `COMPLETE\nWorkflow '${name}' finished.\n${changeLine}`;
}

export function escalate(reason: string): string {
  return `ESCALATE ${reason}\nHuman judgment needed. Report the situation to the user and ask for instructions.\n`;
}

export function abort(reason: string): string {
  return `ABORT ${reason || "(no reason given)"}\nWorkflow aborted. Report to the user.\n`;
}

// --- claim: the driver-adoption handshake (ADR-0009, re-homed onto SubagentStop by ADR-0010) ---
// Deliberately fixed, argument-free text — ADR-0002's claim paragraph is why.
export function claim(): string {
  return (
    "CLAIM armed\n" +
    "Now end your turn. Sealing happens on this agent's own turn end, which is the only\n" +
    "moment headsign can learn which delegated agent you are. The hook confirms it in its\n" +
    "message; do not run `headsign next` before you see that confirmation.\n" +
    "If the wrong agent gets adopted, run `headsign claim` again from the right one: that\n" +
    "re-arms the marker, though another agent naming itself first can take it again.\n" +
    "Re-claim until the confirmation names the agent you meant.\n"
  );
}

export function validateOk(name: string, phaseCount: number): string {
  return `OK: workflow '${name}' (${phaseCount} phases)\n`;
}

export function validateFail(path: string, errors: string[]): string {
  return `INVALID: ${path}\n${errors.map((e) => `- ${e}\n`).join("")}`;
}

// Warnings never change an exit code — the workflow still loads and the run still starts.
// Who prints them and who doesn't: ADR-0011 §6.
export function validateWarnings(path: string, warnings: string[]): string {
  return `WARNING: ${path}\n${warnings.map((w) => `- ${w}\n`).join("")}`;
}

// `timed out after Ns` already states the duration (the limit doubles as the answer, since a
// timeout by definition ran until it), so `elapsedSeconds` adds nothing on that arm and is
// left out; the ordinary-exit arm has no duration anywhere else in this line, so it gets one
// here, when the caller has one to give — an old record may not.
function clause(run: string, exitCode: number | "timeout", timeoutSeconds?: number, elapsedSeconds?: number): string {
  if (exitCode === "timeout") return `${run}, timed out after ${timeoutSeconds}s`;
  return elapsedSeconds === undefined ? `${run}, exit ${exitCode}` : `${run}, exit ${exitCode} in ${elapsedSeconds}s`;
}

// --- status: the read-only observation window (ADR-0002/0008) ---

export function statusRunning(o: {
  phase: string;
  attempt: number;
  maxAttempts?: number;
  // Workflow unreadable, or this phase no longer defined in it — degrade to "n/?" rather
  // than guess at a limit that can't actually be resolved right now.
  attemptUnknown: boolean;
  workflowName: string;
  // Only set by the caller when state.last_failure is non-null AND belongs to the current
  // phase (engine.ts's job — render.ts doesn't know the state shape's field names); a
  // last_failure left over from a since-departed phase must never be shown as if it were
  // about now.
  lastFailure?: (Failure & { outputTail: string }) | null;
  // Two values, worded by cli.ts's reportStatus and handed straight through — see it for
  // why neither says who is reading (ADR-0013) and why the line is worth printing at all.
  driver: "a delegated agent" | "not delegated yet — no agent has claimed this run";
  // What headsign did with the last turn end it could attribute to this run, straight off the
  // record (no log parsing). Optional, so a run on which no stop has been processed prints what
  // `status` has always printed, to the byte. The wordings below say what HEADSIGN did and, for
  // `unheld`, name the upstream field it was told — never what any platform documentation
  // currently says about that field, because a published claim about somebody else's docs rots
  // silently. `cause` is optional for the same reason state.ts's field is: absent on every
  // disposition but `unheld`, and on an `unheld` record only when it predates the field or the
  // reader dropped it — either way `lastStopWording` below reads that absence as
  // `stop_hook_active`, `unheld`'s one cause before this change existed.
  // `note` rides along only on `paused`, and only when the recorded value is non-empty — the
  // same one-field-can-be-dropped-without-losing-the-line treatment `cause` gets on `unheld`.
  lastStop?: { disposition: "nudged" | "unheld" | "paused" | "stalled"; at: string; cause?: UnheldCause; note?: string };
  // The other half of the pair `last stop:` above starts (ADR-0027 §7): when the run was last
  // ATTRIBUTED a stop (`lastStop.at`) versus when it was last MOVED (this). A plain timestamp,
  // never an identifier — engine.ts's status reader strips the session id before it ever
  // reaches this module, so "status never prints an id" is a type this function is handed,
  // not a rule it has to remember to follow. Optional and conditional like every line above:
  // a run whose `last_drive` doesn't exist says nothing, byte-identical to before this line
  // existed.
  lastMoved?: string;
  // The third timestamp, and the one about where the run STANDS rather than who touched it:
  // when it last entered the phase named on line 1. Optional and conditional like the two
  // above — a run started before the field existed says nothing, byte-identical to before.
  // Printed verbatim, for the reason `last stop:` gives: this module reads no clock, so the
  // elapsed time is the reader's subtraction to do, never this module's to invent.
  phaseEnteredAt?: string;
  // HEADSIGN_OBSERVER, read from the environment of the process `status` runs in (engine.ts
  // takes it as an argument; this module reads nothing). The one quiet-ending cause a caller can
  // answer ABOUT ITSELF — there is no identifier to resolve — which makes it worth a line even
  // though the switch is nothing to do with the run's record.
  observer?: boolean;
  // The graph pin, and both are optional: a run whose workflow never changed under it says
  // nothing about it at all, and its status output is byte-identical to what it always was.
  // `acceptedGraphChanges` is history (how many changes this run has taken on board);
  // `graphChangeReported` is a standing question (one was shown and has not been accepted).
  acceptedGraphChanges?: number;
  graphChangeReported?: boolean;
  // The third graph reading, and the only one computed rather than read off the record: what
  // the file on disk says that `state.json` has not been told yet. Set by engine.ts only when
  // the two disagree — `changed` for a file that has moved away from the pin with no report
  // standing, `restored` for one that has come back to it while a report still stands — so the
  // two agreeing cases print nothing and stay byte-identical to what they always were. Both
  // readings answer the same question for a reader who cannot run `next`: does the file in
  // front of me hold the rules this run is walking under?
  graphUnreported?: "changed" | "restored";
  // The current phase's instruction, in the same block `next`/`start` print it in — so a
  // driver reading `status` after compaction, or copying the block to a delegate, gets the
  // identical shape `next` would have given. Absent (not just empty) whenever engine.ts
  // could not resolve it — workflow unreadable, or the phase gone from it, the same condition
  // `attemptUnknown` already names — so this module never has to judge that itself; render.ts
  // does not judge, it only places what it is handed. Last in the block, after every other
  // line, because a description can run to several lines and must not sit in the middle of
  // the single-line lines above it.
  description?: string;
}): string {
  const n = o.attemptUnknown ? `${o.attempt}/?` : o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  const lastFailureBlock = o.lastFailure
    ? `--- last failure: ${o.lastFailure.check} (${clause(o.lastFailure.run, o.lastFailure.exitCode, o.lastFailure.timeoutSeconds, o.lastFailure.elapsedSeconds)}) ---\n${o.lastFailure.outputTail}\n`
    : "";
  // After the driver line rather than beside the workflow line: the last-failure block's slot
  // (between `workflow:` and `driver:`) is part of this contract already, and an addendum that
  // only some runs have is safer at the end than wedged into a documented gap. History first,
  // then the outstanding question — the reader wants the thing that needs an answer last.
  const accepted = o.acceptedGraphChanges ?? 0;
  const acceptedLine =
    accepted > 0 ? `graph: ${accepted} accepted ${accepted === 1 ? "change" : "changes"} to the workflow's rules during this run\n` : "";
  // Names the flag, not "run `headsign next` to accept": a bare `next` no longer accepts a
  // reported change (it escalates again, idempotently), so the old wording would be exactly the
  // lie the ESCALATE reason's own wording was corrected out of — see graphChangedReason.
  const reportedLine = o.graphChangeReported
    ? "graph: changed since this run accepted it — restore the file, or `headsign next --accept-graph-change` to accept\n"
    : "";
  // Directly under the two lines that report the RECORD, because this one reports the FILE and
  // is only ever printed when it says something they do not. `restored` sits under the standing
  // question it answers ("the file is back") and must follow it to read that way; `changed`
  // never appears beside that question at all, so the same slot serves both.
  const unreportedLine =
    o.graphUnreported === "changed"
      ? "graph: the file no longer matches the rules this run pinned — `headsign next` will report it before it runs the gate\n"
      : o.graphUnreported === "restored"
        ? "graph: the file matches the rules this run pinned again — `headsign next` will clear the line above and cost nothing\n"
        : "";
  // Directly after `driver:`, which is the other line about who and what happened at a turn
  // boundary, and ahead of the `graph:` lines, which are about the rules rather than the run's
  // stops. The timestamp is printed VERBATIM: this module reads no clock, cannot know the
  // reader's timezone, and the stored value already carries its own offset — reformatting or
  // truncating it to a wall clock would be inventing a fact the writer did not record.
  const lastStopLine = o.lastStop ? `last stop: ${lastStopWording(o.lastStop)} — at ${o.lastStop.at}\n` : "";
  // One line, directly under `last stop:`, and only for `paused` with a note to show: the
  // consumed note's first line is what a later reader most needs to tell an intended pause from
  // a stuck run left mid-work (the motivating case this line exists for).
  const noteLine = o.lastStop?.disposition === "paused" && o.lastStop.note ? `note: ${o.lastStop.note}\n` : "";
  // Directly after `last stop:` and before the graph lines (ADR-0027 §7), not directly under
  // `driver:` — that slot would print like an explanation of the claim handshake, which this
  // line has nothing to do with. The two timestamps belong together instead: one says when a
  // turn end was last attributed, this one says when the run was last moved, and neither
  // explains the other. Printed verbatim, like `last stop:`'s own timestamp — this module
  // reads no clock and cannot know the reader's timezone.
  const lastMovedLine = o.lastMoved ? `last moved: ${o.lastMoved} — turn ends from any other session pass without a nudge\n` : "";
  // Under `last moved:` because the two answer neighbouring questions — when anyone last moved
  // the run, and when the run last arrived where it is — and reading them together is what
  // tells a retry-heavy phase from a long-idle one.
  const enteredLine = o.phaseEnteredAt ? `entered: ${o.phaseEnteredAt} — when this run last entered the phase above\n` : "";
  // The only line here that is about the CALLER rather than the run — last among the
  // conditional lines above the phase block, which comes after everything else in turn.
  const observerLine = o.observer ? "observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held\n" : "";
  const phaseBlock = o.description !== undefined ? `--- phase: ${o.phase} ---\n${o.description}\n` : "";
  return `RUNNING ${o.phase} (attempt ${n})\nworkflow: ${o.workflowName}\n${lastFailureBlock}driver: ${o.driver}\n${lastStopLine}${noteLine}${lastMovedLine}${enteredLine}${acceptedLine}${reportedLine}${unreportedLine}${observerLine}${phaseBlock}`;
}

// One phrase per disposition, and each one is about what headsign did to the turn: "held" for
// the two dispositions that blocked, "not held" for the two that could not. `paused` says
// neither, because a pause is the reader's own doing and "not held" would read as a failure.
// `unheld` is not here: it is the one disposition with two possible causes, so its wording
// lives in `UNHELD_WORDING` and `lastStopWording` below picks the right one.
const LAST_STOP_WORDING: Record<"nudged" | "paused" | "stalled", string> = {
  nudged: "held, and pointed back to headsign next",
  paused: "paused by a note",
  stalled: "not held — the nudge cap is spent",
};

// Two sentences for the two things that can make headsign let a stop pass without holding it
// (state.ts's `UnheldCause`), each naming its own upstream token verbatim in parentheses — the
// same convention `logDetail`'s `by=` uses, so a reader who has seen one can read the other.
// Deliberately not "the working directory found nothing, so CLAUDE_PROJECT_DIR was tried
// instead": that would describe headsign's own procedure, which is `nudged`/`stalled`'s job
// (they say what headsign did to the turn) — this sentence, like `stop_hook_active`'s, says
// only what happened.
const UNHELD_WORDING: Record<UnheldCause, string> = {
  stop_hook_active: "not held — Claude Code had already resumed the turn (stop_hook_active)",
  // Names where the session was, not how headsign compensated, for the reason above — and it
  // is the sentence's most useful half: a reader who cannot explain a quiet turn end is being
  // told the one fact that explains it. The token goes in the parentheses like its sibling's
  // rather than inside the prose, which read as a stutter with the name in both halves.
  CLAUDE_PROJECT_DIR: "not held — the session was not standing in the run's tree (CLAUDE_PROJECT_DIR)",
};

function lastStopWording(o: { disposition: "nudged" | "unheld" | "paused" | "stalled"; cause?: UnheldCause }): string {
  // Absence is not damage here (see state.ts's `cause` doc): a record predating the field, or
  // one a tolerant reader stripped the field from, gets the cause `unheld` always had before
  // there were two — never an empty or invented sentence.
  if (o.disposition === "unheld") return UNHELD_WORDING[o.cause ?? "stop_hook_active"];
  return LAST_STOP_WORDING[o.disposition];
}

export function statusTerminal(status: "complete" | "escalated" | "aborted", workflowName: string, endReason: string | null): string {
  const reasonLine = endReason !== null && endReason.length > 0 ? `reason: ${endReason}\n` : "";
  return `${status.toUpperCase()}\nworkflow: ${workflowName}\n${reasonLine}`;
}

// What a `.headsign/log` line can be about: every real transition engine.ts logs, plus the
// synthetic `start` event (which isn't an engine.Outcome — `start` never runs step()), plus
// the Stop-boundary events (ADR-0004's explicit exception to "transitions only"; owned
// and appended by stophook.ts, not engine.ts — see ADR-0006). The type is the full
// engine.Outcome (PENDING included) rather than a narrower Exclude<>, because
// engine.step()'s declared return type still carries PENDING even though it never actually
// produces one — narrowing here would just force an unsafe cast at the one real call site.
// PENDING has no line format (see logDetail): engine.ts never calls this on the PENDING path
// (probes aren't transitions), so it's unreachable in practice, not by type.
export type LogEvent =
  | { kind: "START"; workflow: string }
  | Outcome
  // The global ceiling. A synthetic event rather than the ESCALATE outcome it is printed as —
  // ADR-0017's "The log gets a fourth word: ceiling" is why.
  | { kind: "CEILING"; reason: string }
  // The workflow's own rules moved under a running run (engine.ts's reconcileGraphPin). One
  // event word for both dispositions, distinguished in the detail, because they are two
  // readings of the same finding and a reader following a run wants them on one grep. Not an
  // `escalate`, for the same reason `ceiling` is not: the reported disposition prints as
  // ESCALATE but ends nothing.
  // `disposition` rather than `state` even though it PRINTS as `state=`: `state` in this file
  // means the run record, which logLine also takes, and one word for two things across one
  // function signature is how a log line ends up reporting the wrong one.
  | { kind: "GRAPH_CHANGED"; disposition: "reported" | "accepted"; keys: string[] }
  | { kind: "PAUSED"; note: string }
  // A turn end headsign held: the nudge branch of both stop-boundary hooks, one line per
  // nudge. The count rides on the EVENT even though the resulting state also carries it,
  // because its sibling `stalled` states the same quantity as a constant: one arm reading the
  // record and the other writing a literal is how one `nudges=` key would come to mean two
  // things in this file.
  // Why every nudge and not only the cap: ADR-0025 §7 (the retraction) and its Consequences.
  | { kind: "HELD"; nudges: number }
  | { kind: "STALLED" }
  // A turn end headsign was overruled on: either Claude Code's already-continuing flag was set
  // on the hook's input (stophook.ts's flagged branches), or the walk from the session's own
  // directory found no run and the second starting point, CLAUDE_PROJECT_DIR, found one instead
  // (stophook.ts's fallback, ADR-0026) — `cause` (state.ts's `UnheldCause`) names which. `unheld`
  // and not `pass`, deliberately — `pass` is this codebase's word for a GATE SUCCEEDING
  // (GateVerdict's passing arm is literally named `pass`), so reusing it here would put the
  // same string in the log for the opposite kind of event. `unheld` negates the verb headsign
  // already uses for what these hooks do to a turn, and claims no choice: headsign did not let
  // go, it was overruled.
  | { kind: "UNHELD"; cause: UnheldCause }
  // The claim handshake's adoption event (ADR-0009/0010) — a third hook-boundary exception
  // alongside PAUSED/STALLED. Deliberately detail-free: the identifier that was just
  // adopted must never be written to the log (see logDetail below).
  | { kind: "CLAIMED" };

// Pure formatting of one .headsign/log line (state.ts's appendLog owns the I/O).
// `ts` always originates from cli.ts's local `localIso(new Date())` helper — the one place
// headsign reads the wall clock for a datetime that lands on disk (ADR-0004's own scope; a
// temp filename's `Date.now()` and gate.ts's monotonic clock are neither) — even though
// neither caller is cli.ts any more:
// engine.ts and stophook.ts both receive `ts` as a `nowIso` argument and never call
// `new Date()` themselves.
// `state` is the resulting state of this transition — the same object passed to state.writeState —
// so `a=`/`i=`/`<phase>` always match what's on disk after this event. `prevPhase` is the
// one piece of context that state doesn't carry after the fact (an ADVANCE's `state.phase`
// is already the destination): it feeds the `from=` clause and is otherwise unused.
export function logLine(ts: string, event: LogEvent, state: State, prevPhase?: string): string {
  const phase = state.phase;
  const a = state.attempts[phase] ?? 0;
  const i = state.total_iterations;
  const head = `${ts} ${eventName(event)} ${phase} a=${a} i=${i}`;
  const detail = logDetail(event, prevPhase);
  return oneLine(detail ? `${head} ${detail}` : head) + "\n";
}

// ADR-0004 records a run as one line per event, and this is what keeps it one. Several fields
// above carry text a person typed — an abort reason, a pause note, a check's name, a phase's
// name — and `headsign abort` takes its reason straight off the command line, where a line
// break is one keystroke away. A reason typed with one used to put a second line in the file
// with no timestamp on it, which is a line every reader of this file has to skip past.
// Applied once, to the finished line, rather than inside each arm of logDetail: an arm added
// later then cannot forget it. Written as the two characters a reader already knows, so what
// happened stays legible; it is an escape for READING and not for reading back, because
// nothing parses a value out of these lines again. Only the two characters that end a line are
// touched — a tab or a quote inside free text is somebody's text, and this function's job is
// the record's shape.
function oneLine(text: string): string {
  return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function eventName(event: LogEvent): string {
  switch (event.kind) {
    case "START":
      return "start";
    case "ADVANCE":
      return "advance";
    case "COMPLETE":
      return "complete";
    case "RETRY":
      return "retry";
    case "ESCALATE":
      return "escalate";
    case "ABORT":
      return "abort";
    case "CEILING":
      return "ceiling";
    case "GRAPH_CHANGED":
      return "graph-changed";
    case "PAUSED":
      return "paused";
    case "HELD":
      return "held";
    case "STALLED":
      return "stalled";
    case "UNHELD":
      return "unheld";
    case "CLAIMED":
      return "claimed";
    case "PENDING":
      // Unreachable: no call site in engine.ts ever logs a PENDING outcome. Kept only so this
      // switch stays exhaustive against the full engine.Outcome type.
      throw new Error("logLine: PENDING is never logged");
  }
}

// Trailing, not leading: appended after the existing `check=`/`exit=` fields on both lines
// that carry a failure, so a script already splitting one of those lines on whitespace keeps
// working unchanged. Empty rather than `dur=undefineds` when there is nothing to report,
// which no caller reaching HERE can currently produce: a `LogEvent` is always composed from a
// freshly built outcome, never from a stored record, and every `fail` sets the field. The
// old-record case that makes `Failure.elapsedSeconds` optional up top belongs to `clause()`,
// which `statusRunning` does feed from `state.json`; this guard is the type's shape honoured,
// not a case observed.
function durSuffix(elapsedSeconds?: number): string {
  return elapsedSeconds === undefined ? "" : ` dur=${elapsedSeconds}s`;
}

// Trailing, after `dur=`, for the same "existing scripts keep working" reason: appended, never
// inserted. Empty under the same condition notRunLine above suppresses its own line on — the
// two must agree, or a hand-built fixture could make the log say one thing and the RETRY output
// say another about the same lap.
function ranSuffix(checksRun?: number, checksTotal?: number): string {
  return checksRun === undefined || checksTotal === undefined || checksRun >= checksTotal ? "" : ` ran=${checksRun}/${checksTotal}`;
}

function logDetail(event: LogEvent, prevPhase?: string): string {
  switch (event.kind) {
    case "START":
      return `workflow=${event.workflow}`;
    case "RETRY":
      return `check="${event.failure.check}" exit=${event.failure.exitCode}${durSuffix(event.failure.elapsedSeconds)}${ranSuffix(event.failure.checksRun, event.failure.checksTotal)}`;
    case "ADVANCE":
      // Which branch of a k-way `on_pass` was taken, and why the log is the record of it
      // that outlives the run: ADR-0011's Consequences.
      if (event.routedBy) {
        const why = "when" in event.routedBy ? `routed-when="${event.routedBy.when}"` : "routed-default";
        return `from=${prevPhase} ${why}`;
      }
      return event.failure
        ? `from=${prevPhase} routed-fail check="${event.failure.check}" exit=${event.failure.exitCode}` +
          `${durSuffix(event.failure.elapsedSeconds)}${ranSuffix(event.failure.checksRun, event.failure.checksTotal)}`
        : `from=${prevPhase}`;
    case "ESCALATE":
    case "ABORT":
    // Same `reason="…"` shape as the two endings: only the event word separates them, so a
    // reader who knows one line format knows all three.
    case "CEILING":
      return `reason="${event.reason}"`;
    case "GRAPH_CHANGED":
      // Which keys moved, comma-separated and unquoted: they are identifiers (phase names and
      // `$limits`), not free text like a reason, and this is the one record of WHAT changed
      // that outlives the lap. A reported line is written every time a difference is reported,
      // the same way `ceiling` repeats at the wall: each one was a real question really asked,
      // and collapsing them would understate how much a run's rules moved under it.
      return `state=${event.disposition} phases=${event.keys.join(",")}`;
    case "PAUSED":
      return `note="${event.note}"`;
    case "HELD":
      // `nudges=`, the same key `stalled` writes for the same quantity — ADR-0004's
      // 2026-07-31 revision note is why the two share it.
      return `nudges=${event.nudges}`;
    case "STALLED":
      // The cap-tripping hold writes this INSTEAD of `held`, one line per event — ADR-0004's
      // 2026-07-31 revision note spells out the count this leaves a reader.
      return "nudges=5";
    case "UNHELD":
      // Bare, not quoted, by this file's own rule: quotes are for free text, and both
      // `stop_hook_active` and `CLAUDE_PROJECT_DIR` are identifiers (see the graph-changed arm
      // above). Naming the upstream token is deliberate — it is the one string common to the
      // whole diagnostic chain, from this line through headsign's source to the hook payload or
      // environment a person can print. Which is also why the event WORD stays inside
      // headsign's own vocabulary: the line says what headsign did, and names in the detail
      // what it was told, whichever of the two causes told it.
      return `by=${event.cause}`;
    case "CLAIMED":
      // No detail — ADR-0004's "Unlike the other two, `claimed`'s detail field is empty" is
      // why; ADR-0010 is why the identifier itself is an agent id rather than a session id.
      return "";
    // PENDING rides on COMPLETE's arm rather than carrying a `throw` of its own. logLine calls
    // eventName before it calls this function, and eventName's own PENDING case already throws,
    // so no statement written here could ever run. What the compiler needs from this arm is
    // exhaustiveness against the full engine.Outcome type, and sharing one supplies that without
    // a second copy of an invariant enforced a screen above — a copy that no test could reach,
    // and that would read to the next person as a live guard.
    case "PENDING":
    case "COMPLETE":
      // No detail form is specified for `complete` in the spec's enumeration (start /
      // retry / fail-route advance / pass advance / escalate+abort) despite it being
      // named as one of the logged events — `<phase>`/`a=`/`i=` already name which phase
      // just completed, so nothing is appended here. Recorded as a spec gap rather than
      // guessed at.
      return "";
  }
}
