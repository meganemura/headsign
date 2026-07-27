# What headsign protects

Distilled from the work that produced ADR-0008 through ADR-0015. Each line is
meant to be falsifiable against a diff: if a change violates one, say which.

1. **A transition is decided by an exit code and a declared edge.** Never by
   what an LLM wrote. What an agent writes can pick among destinations the
   workflow already declares; it can never name a new one.
2. **Do not proceed through ambiguity.** A condition that could not be
   evaluated is not a "no" — stop (exit 3) rather than take a default nobody
   declared for that situation.
3. **Claim only what you can prove.** If a comparison cannot separate two
   things, say so in the output instead of picking one. Measurements in
   records carry their date.
4. **No silent divergence.** A key nobody reads, a typo that changes
   behaviour, a cached answer hiding a stalled run — each is a place where
   what someone believes and what the machine did drift apart in silence.
   Make it loud or make it impossible.
5. **State a rule once and reference it.** The same rule written in nine
   places was corrected in eight of them, five reviews running.
6. **A name says what the thing holds.** `last_eval` held the last failure;
   `driver_session` held an agent id. Both were renamed rather than
   explained.
7. **Prefer removing the question to answering it.** Branching was put on the
   pass path so that "does routing spend an attempt?" has no answer to get
   wrong.
8. **A guard with no stated expiry never expires.** Transitional code says
   what has to be true before it can go.
9. **The harness is not the ceiling.** No methodology is built in. The graph
   is data, so the graph is what improves.
10. **Escalate rather than give up quietly.** A run that has stopped
    progressing belongs to a person, not to a `stalled` line nobody reads.
11. **A record says why it was right then, and why it is different now.**
    Superseding keeps both halves.
