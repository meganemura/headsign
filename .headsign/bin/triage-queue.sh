#!/bin/sh
# Prints ticket ids for one tool:headsign queue, one per line:
# closed-unjudged selects closed tickets with reporter notes awaiting judgment;
# open-judged selects open tickets whose last tool comment follows every reporter note.
#
# A judged ticket has a tool comment and no later reporter note, ordered by created_at.
# An ack only marks what the reporter read, so it is excluded from reporter notes.
# The triage description and both gate checks call this script to share that comparison.
# Export must succeed before jq reads it, so a failed read cannot look like an empty queue.
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: triage-queue.sh closed-unjudged|open-judged' >&2
  exit 2
fi
case "$1" in
  closed-unjudged|open-judged) ;;
  *)
    printf '%s\n' 'Usage: triage-queue.sh closed-unjudged|open-judged' >&2
    exit 2
    ;;
esac

HQ="$(git config --global headquarters.issuesDir)"
mkdir -p .headsign/tmp || exit 1
export_file=$(mktemp .headsign/tmp/triage-comments.XXXXXX) || exit 1
trap 'rm -f "$export_file"' 0
bd -C "$HQ" export > "$export_file" || exit 1
jq -rs --arg mode "$1" '
  def reporter_note:
    (.author | tostring | startswith("project:")) and
    ((.text | tostring | test("^ack \\S+\\s*$")) | not);
  def judged:
    sort_by(.created_at) as $cs
    | ([$cs | to_entries[] | select(.value.author == "tool:headsign") | .key]
       | last // -1) as $t
    | $t >= 0 and (any($cs[($t + 1):][]; reporter_note) | not);
  .[]
  | select(._type == "issue" and ((.labels // []) | index("tool:headsign")))
  | (.comments // []) as $cs
  | select(
      if $mode == "closed-unjudged" then
        .status == "closed" and ($cs | judged | not) and any($cs[]; reporter_note)
      else
        .status == "open" and ($cs | judged)
      end)
  | .id
' "$export_file"
