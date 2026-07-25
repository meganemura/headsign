import { test } from "node:test";
import assert from "node:assert/strict";
import * as session from "../src/session.ts";

// --- resolveSessionId ---

test("resolveSessionId: HEADSIGN_SESSION_ID wins when both are set", () => {
  const id = session.resolveSessionId({ HEADSIGN_SESSION_ID: "explicit-id", CLAUDE_CODE_SESSION_ID: "auto-id" });
  assert.equal(id, "explicit-id");
});

test("resolveSessionId: falls back to CLAUDE_CODE_SESSION_ID when HEADSIGN_SESSION_ID is unset", () => {
  const id = session.resolveSessionId({ CLAUDE_CODE_SESSION_ID: "auto-id" });
  assert.equal(id, "auto-id");
});

test("resolveSessionId: neither set -> null", () => {
  assert.equal(session.resolveSessionId({}), null);
});

test("resolveSessionId: trims surrounding whitespace", () => {
  assert.equal(session.resolveSessionId({ HEADSIGN_SESSION_ID: "  padded-id  " }), "padded-id");
});

test("resolveSessionId: a blank (whitespace-only) HEADSIGN_SESSION_ID falls through to CLAUDE_CODE_SESSION_ID", () => {
  const id = session.resolveSessionId({ HEADSIGN_SESSION_ID: "   ", CLAUDE_CODE_SESSION_ID: "auto-id" });
  assert.equal(id, "auto-id");
});

test("resolveSessionId: an empty-string HEADSIGN_SESSION_ID falls through to CLAUDE_CODE_SESSION_ID", () => {
  const id = session.resolveSessionId({ HEADSIGN_SESSION_ID: "", CLAUDE_CODE_SESSION_ID: "auto-id" });
  assert.equal(id, "auto-id");
});

test("resolveSessionId: both candidates blank -> null", () => {
  assert.equal(session.resolveSessionId({ HEADSIGN_SESSION_ID: "  ", CLAUDE_CODE_SESSION_ID: "" }), null);
});

// --- isObserver ---

test("isObserver: HEADSIGN_OBSERVER=1 -> true", () => {
  assert.equal(session.isObserver({ HEADSIGN_OBSERVER: "1" }), true);
});

test("isObserver: any non-empty value is treated the same (the value itself is never inspected)", () => {
  assert.equal(session.isObserver({ HEADSIGN_OBSERVER: "yes" }), true);
  assert.equal(session.isObserver({ HEADSIGN_OBSERVER: "0" }), true);
  assert.equal(session.isObserver({ HEADSIGN_OBSERVER: "false" }), true);
});

test("isObserver: unset -> false", () => {
  assert.equal(session.isObserver({}), false);
});

test("isObserver: empty string -> false", () => {
  assert.equal(session.isObserver({ HEADSIGN_OBSERVER: "" }), false);
});
