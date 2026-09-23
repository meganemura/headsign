# A review phase's verdict

Open this before you write a verdict file. The reviewer stays read-only. You
write the verdict only after `headsign status` shows the review phase as the
current phase.

7. If the current phase's gate reads a verdict file (a review phase), spawn
   a reviewer subagent restricted to read-only tools (Read/Grep/Glob) and
   have it REPORT exactly `APPROVED` or `REJECTED` (with reasons). Then
   *you* write that reported verdict, verbatim, to the verdict file and run
   `headsign next` — the reviewer stays unable to touch code or the
   verdict, so the judgment and the work stay separated.

   Write the verdict only after `headsign status` shows the review phase as
   the current phase. A phase's `clear:` runs when the run enters that phase,
   so a verdict written before entry is deleted on entry, and `next` reports
   it as `--- cleared: <path> ---`. When the gate of the previous phase is
   still unconsumed, run `headsign next` first, confirm `ADVANCE <review
   phase>` in its output, and then write the verdict.

   Check that the gate actually requires the current review's final decision
   and the artifact it reviewed. File existence, size, or a historical
   `APPROVED` line does not establish acceptance of the current revision.
   If the gate passes despite an unresolved rejection, repair the check and
   arrange the necessary rework and review. Do not treat that pass as acceptance.
   Keep review history separate from the current verdict consumed by the gate.
