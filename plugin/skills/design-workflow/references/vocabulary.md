# The vocabulary you need

Read this when you are writing `.headsign/<name>.yaml`. This is enough to
write one simple workflow correctly. The complete field table, the router
pattern, and the less common branches are in `schema.md` — read it when you
need a field that is not here.

```yaml
version: 0.1              # exactly 0.1; the schema is pre-1.0
name: feature-dev         # the label in `status` and .headsign/log
entry: plan               # the phase a run starts on

phases:
  plan:
    # Handed to the agent verbatim when it enters the phase. Say what has to
    # be TRUE when the gate runs; leave who does the work to the agent
    # (see `pitfalls.md`, item 7).
    description: Write the spec to docs/spec.md, with an "## Acceptance" section.
    gate:
      checks:                       # run with /bin/sh -c, in order;
        - name: spec exists         # the first failure stops the gate
          run: "test -s docs/spec.md"
        - name: acceptance criteria present
          run: "grep -q '## Acceptance' docs/spec.md"
    on_pass: implement              # a phase name, or $end
    max_attempts: 3                 # failures before the run escalates

  implement:
    description: Implement per the spec, test-first.
    gate:
      checks:
        - name: unit tests
          run: "npm test"
          timeout: 300              # seconds; default 120
    on_pass: review
    max_attempts: 5

  review:
    description: >
      Have a read-only reviewer — one that did not write the change — report
      APPROVED or REJECTED for the current repository state. As the driving
      agent, fingerprint HEAD, tracked changes, and untracked non-ignored files
      before and after the read-only review. Write two lines to
      .headsign/tmp/verdict: the decision, then
      REVISION followed by the unchanged fingerprint. Put reasons in
      .headsign/tmp/review-notes.md.
    clear: [.headsign/tmp/verdict, .headsign/tmp/review-notes.md, .headsign/tmp/review-current, .headsign/tmp/review-untracked]
    ready: "test -f .headsign/tmp/verdict"   # judge only once this passes
    gate:
      checks:
        - name: current review approved
          run: >-
            awk 'NR == 1 { ok = ($0 == "APPROVED") }
            NR == 2 { value = substr($0, 10); ok = ok &&
            substr($0, 1, 9) == "REVISION " &&
            (length(value) == 40 || length(value) == 64) &&
            value !~ /[^0-9a-f]/ } NR > 2 { ok = 0 }
            END { exit !(ok && NR == 2) }' .headsign/tmp/verdict
        - name: review covers current fingerprint scope
          run: >-
            expected=$(sed -n '2s/^REVISION //p' .headsign/tmp/verdict) &&
            git rev-parse 'HEAD^{tree}' > .headsign/tmp/review-current &&
            git diff --no-ext-diff --binary HEAD -- >> .headsign/tmp/review-current &&
            git ls-files --others --exclude-standard -z > .headsign/tmp/review-untracked &&
            xargs -0 sh -c 'for f do printf "%s\0" "$f";
            git hash-object -- "$f" || exit; done' sh < .headsign/tmp/review-untracked >> .headsign/tmp/review-current &&
            current=$(git hash-object .headsign/tmp/review-current) &&
            test -n "$expected" && test "$expected" = "$current"
    on_pass: $end
    on_fail: implement              # rejection goes back for rework
    max_attempts: 3

limits:
  max_total_iterations: 20          # global runaway backstop
```

The two review checks make one current decision. The first accepts exactly two
records and rejects a missing, rejected, or mixed historical verdict. The
second binds approval to HEAD, tracked changes, and untracked non-ignored file
contents. Ignored files and changes inside a submodule are outside this example.
The driving agent calculates the fingerprint before the reviewer reads, gives
that identifier to the reviewer, and calculates it again before recording the
decision. The reviewer stays read-only and supplies the independent judgment.
If the values differ, review the new state.
A narrower workflow must scope every fingerprint input to its reviewed paths,
including committed content. Keep the decision file separate from
review notes so later reasons cannot turn an earlier approval into a current
verdict.

`on_fail` defaults to `retry` (stay in the phase) and also accepts a phase
name, `$end`, or `escalate` (stop and ask a person). No gate can abort a run:
exhausting `max_attempts` escalates, `on_fail: $end` completes, and only a
person running `headsign abort <reason>` aborts.

**Quote any `name:` that contains a colon.** Check names tend to quote a
fragment of the command they run, and `- name: verify git status: clean` is
not a headsign error but a YAML one — `Nested mappings are not allowed in
compact mappings` — so `validate` exits 3 having read no fields at all.
`- name: "verify git status: clean"` parses fine.

**`run:` is where quoting actually bites, and it bites more often than the
colon does.** A shell command that wants a single quote — `grep -q '##
Acceptance' docs/spec.md` — cannot sit in a YAML single-quoted scalar without
doubling every one of them, and the double-quoted scalar is not the way out
it looks like: inside it YAML owns the backslash, so `\$` is not a shell
escape reaching the shell but an unknown YAML escape, and the parser rejects
it. Writing every check with double quotes only, to keep out of the way of
the outer quoting, is a restriction on your shell that you should not accept
silently. **Use a block scalar instead** — `run: >-` folds the lines into
one, `run: |` keeps the newlines — and inside it the quoting is the shell's
business alone, with no YAML escapes to work around. Whichever way you write
it, the guarantee is not the quoting rule: it is step 7 of `procedure.md`,
where you take the string back out of the YAML and run the thing you actually
wrote.

Shapes `validate` accepts that still misbehave are in `pitfalls.md`.
