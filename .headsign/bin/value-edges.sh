#!/bin/sh
# Prints one line per VALUE import edge between modules of src/, as `caller.ts>callee.ts`.
#
# Why this is a committed script rather than a `run:` string: ADR-0003 refuses gate
# indirection where the AGENT writes the judge at run time, and explicitly allows the other
# shape — a stable script, committed, reviewed like any other code, referenced from the
# workflow. The scan is too long to read inline in YAML and too easy to get subtly wrong to
# leave to the phase that has an interest in the answer being short.
#
# VALUE edges only. `import type` shares a shape, not a behaviour, so there is no seam to
# explain: nothing is called, nothing is assumed, nothing can be relied on out of order.
#
# Deliberately refuses to guess: a multi-line import statement would be invisible to a
# line-oriented scan, so the script fails loudly rather than under-reporting — an
# under-report here silently shrinks the sweep, which is the one thing this must not do.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

if grep -nE '^import [^;]*$' src/*.ts | grep -vE 'from "' >/dev/null 2>&1; then
  echo "value-edges: a multi-line import statement exists; this scan reads one line at a time and would miss it" >&2
  exit 1
fi

for f in src/*.ts; do
  from=$(basename "$f")
  grep -E '^import (\*|\{)' "$f" \
    | grep -oE '"\./[a-z]+\.ts"' \
    | sed 's|"\./||; s|"||' \
    | sort -u \
    | while read -r to; do printf '%s>%s\n' "$from" "$to"; done
done
