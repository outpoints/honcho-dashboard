import assert from "node:assert/strict";
import test from "node:test";
import { COLLAPSED_LIMIT, collapsedScope, expandSessions, readCollapsed, setCollapsed } from "../src/lib/collapsedSessions.ts";

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), data };
};

test("collapsed sessions are kept per instance and workspace", () => {
  const store = memory();
  const a = collapsedScope("http://honcho:8000/", "agents");
  const b = collapsedScope("http://other:8000", "agents");
  assert.equal(a, "http://honcho:8000::agents", "a trailing slash does not make a second scope");
  assert.deepEqual(setCollapsed(store, a, "s1", true), ["s1"]);
  assert.deepEqual(setCollapsed(store, a, "s2", true), ["s1", "s2"]);
  assert.deepEqual(setCollapsed(store, a, "s1", true), ["s2", "s1"], "collapsing again does not duplicate");
  assert.deepEqual(readCollapsed(store, b), [], "another instance with the same workspace name is separate");
  assert.deepEqual(setCollapsed(store, a, "s2", false), ["s1"]);
});

test("expanding some or all sessions, and bad storage", () => {
  const store = memory();
  const scope = collapsedScope("http://h", "ws");
  for (const id of ["s1", "s2", "s3"]) setCollapsed(store, scope, id, true);
  assert.deepEqual(expandSessions(store, scope, ["s1", "s3"]), ["s2"]);
  assert.deepEqual(expandSessions(store, scope), []);
  assert.equal(store.data.get("honcho-dashboard:messages-collapsed"), "{}", "an empty scope is removed");

  store.setItem("honcho-dashboard:messages-collapsed", "not json");
  assert.deepEqual(readCollapsed(store, scope), []);
  store.setItem("honcho-dashboard:messages-collapsed", JSON.stringify({ [scope]: ["ok", 7, null] }));
  assert.deepEqual(readCollapsed(store, scope), ["ok"], "only session ids are kept");
});

test("the list is capped, dropping the oldest first", () => {
  const store = memory();
  const scope = collapsedScope("http://h", "ws");
  for (let i = 0; i <= COLLAPSED_LIMIT; i++) setCollapsed(store, scope, `s${i}`, true);
  const ids = readCollapsed(store, scope);
  assert.equal(ids.length, COLLAPSED_LIMIT);
  assert.equal(ids[0], "s1");
  assert.equal(ids.at(-1), `s${COLLAPSED_LIMIT}`);
});
