import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_HEADER,
  DASHBOARD_HEADER_REQUIRED_REASON,
  DASHBOARD_HEADER_VALUE,
  OPERATOR_WRITES_DISABLED_REASON,
  OPERATOR_WRITES_ENV,
  OPERATOR_WRITE_HEADERS,
  hasDashboardHeader,
  operatorWritesEnabled,
  requireDashboardHeader,
  requireOperatorWrites,
  serverWriteGate,
} from "../src/lib/operator/writes.ts";

const withValue = (value) => ({ [OPERATOR_WRITES_ENV]: value });

test("writes are disabled when the variable is unset", () => {
  assert.equal(operatorWritesEnabled({}), false);
  assert.equal(operatorWritesEnabled(withValue(undefined)), false);
});

test("writes are disabled for empty, false-like and unknown values", () => {
  for (const v of ["", " ", "0", "false", "FALSE", "no", "off", "disabled", "2", "truee", "y", "on"]) {
    assert.equal(operatorWritesEnabled(withValue(v)), false, `value ${JSON.stringify(v)}`);
  }
});

test("writes are enabled for 1/true/yes in any case", () => {
  for (const v of ["1", "true", "TRUE", "True", "yes", "YES", "Yes"]) {
    assert.equal(operatorWritesEnabled(withValue(v)), true, `value ${JSON.stringify(v)}`);
  }
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(operatorWritesEnabled(withValue(" true ")), true);
  assert.equal(operatorWritesEnabled(withValue("\tyes\n")), true);
});

test("other env vars do not enable writes", () => {
  assert.equal(operatorWritesEnabled({ HONCHO_DATABASE_URL: "postgres://x", WRITES: "true" }), false);
});

test("defaults to process.env", () => {
  const prev = process.env[OPERATOR_WRITES_ENV];
  try {
    delete process.env[OPERATOR_WRITES_ENV];
    assert.equal(operatorWritesEnabled(), false);
    process.env[OPERATOR_WRITES_ENV] = "true";
    assert.equal(operatorWritesEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env[OPERATOR_WRITES_ENV];
    else process.env[OPERATOR_WRITES_ENV] = prev;
  }
});

test("disabled reason names the env var", () => {
  assert.ok(OPERATOR_WRITES_DISABLED_REASON.includes(OPERATOR_WRITES_ENV));
});

test("requireOperatorWrites returns a 403 Response when disabled", async () => {
  for (const env of [{}, withValue("false"), withValue("")]) {
    const res = requireOperatorWrites(env);
    assert.ok(res instanceof Response);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, reason: OPERATOR_WRITES_DISABLED_REASON });
  }
});

test("requireOperatorWrites returns null when enabled", () => {
  assert.equal(requireOperatorWrites(withValue("true")), null);
  assert.equal(requireOperatorWrites(withValue("1")), null);
});

const h = (o) => new Headers(o);
const GOOD = { "x-honcho-dashboard": "1" };

test("the UI header constant is X-Honcho-Dashboard: 1", () => {
  assert.equal(DASHBOARD_HEADER, "X-Honcho-Dashboard");
  assert.equal(DASHBOARD_HEADER_VALUE, "1");
  assert.deepEqual(OPERATOR_WRITE_HEADERS, { "X-Honcho-Dashboard": "1" });
  // What the client sends must satisfy the server check.
  assert.equal(hasDashboardHeader(new Headers(OPERATOR_WRITE_HEADERS)), true);
});

test("dashboard header: the correct header is accepted, case-insensitively", () => {
  assert.equal(hasDashboardHeader(h(GOOD)), true);
  assert.equal(hasDashboardHeader(h({ "X-HONCHO-DASHBOARD": "1" })), true);
  assert.equal(requireDashboardHeader(h(GOOD)), null);
});

test("dashboard header: missing header is rejected, with and without browser headers", async () => {
  for (const headers of [
    {},
    { host: "dash.test:3000" },
    { origin: "http://dash.test:3000", host: "dash.test:3000" },
    { "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "none" },
  ]) {
    assert.equal(hasDashboardHeader(h(headers)), false, JSON.stringify(headers));
    const res = requireDashboardHeader(h(headers));
    assert.ok(res instanceof Response);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, reason: DASHBOARD_HEADER_REQUIRED_REASON });
  }
});

test("dashboard header: wrong values are rejected", () => {
  for (const v of ["", "0", "true", "yes", "2", "11", "1 1", "one"]) {
    assert.equal(hasDashboardHeader(h({ "x-honcho-dashboard": v })), false, `value ${JSON.stringify(v)}`);
    assert.ok(requireDashboardHeader(h({ "x-honcho-dashboard": v })) instanceof Response);
  }
  // Headers trims surrounding whitespace, so " 1 " arrives as "1".
  assert.equal(hasDashboardHeader(h({ "x-honcho-dashboard": " 1 " })), true);
});

test("dashboard header: similarly named headers do not satisfy the check", () => {
  assert.equal(hasDashboardHeader(h({ "x-honcho": "1" })), false);
  assert.equal(hasDashboardHeader(h({ "x-dashboard": "1" })), false);
  assert.equal(hasDashboardHeader(h({ "x-honcho-dashboard-x": "1" })), false);
});

test("dashboard header: a cross-site request carrying it is still accepted (the browser would have preflighted it)", () => {
  // The server cannot tell; the protection is that a cross-origin page cannot add
  // the header without a preflight the route never approves. Documented here so
  // nobody adds Origin logic back "for safety".
  assert.equal(
    requireDashboardHeader(h({ ...GOOD, "sec-fetch-site": "cross-site", origin: "http://evil.test" })),
    null,
  );
});

test("dashboard header: works behind a Host-rewriting proxy (Origin host differs from Host)", () => {
  // nginx `proxy_pass http://dashboard:3000;` on a plain-HTTP install: the browser
  // sends Origin only, Host is rewritten, no X-Forwarded-Host.
  assert.equal(
    requireDashboardHeader(h({ ...GOOD, origin: "http://192.168.1.20", host: "dashboard:3000" })),
    null,
  );
  assert.equal(
    requireDashboardHeader(h({ ...GOOD, origin: "https://dash.example", host: "dashboard:3000" })),
    null,
  );
  // And without the header the same request is refused whatever Origin/Host say.
  assert.ok(requireDashboardHeader(h({ origin: "http://192.168.1.20", host: "192.168.1.20" })) instanceof Response);
});

// Route source with comment lines removed, so the comments may name what is absent.
const routeSource = () =>
  readFileSync(new URL("../src/app/api/operator/db/route.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

test("the operator db route answers no CORS preflight", () => {
  // The route imports server-only code, so check the source: a preflight for the
  // custom header must fail, which needs no OPTIONS handler and no CORS headers.
  const src = routeSource();
  assert.doesNotMatch(src, /export\s+(async\s+)?function\s+OPTIONS|export\s+const\s+OPTIONS/);
  assert.doesNotMatch(src, /access-control-/i);
  assert.match(src, /requireDashboardHeader\(req\.headers\)/);
  assert.doesNotMatch(src, /requireSameOrigin|isSameOrigin|sec-fetch-site|origin/i);
});

test("the dashboard header is enforced after the writes gate and before any action", () => {
  const src = routeSource();
  const post = src.slice(src.indexOf("export async function POST"));
  const gate = post.indexOf("requireOperatorWrites()");
  const header = post.indexOf("requireDashboardHeader(");
  const action = post.indexOf('searchParams.get("action")');
  assert.ok(gate >= 0 && gate < header && header < action);
});

test("serverWriteGate: only error-free confirmed on enables the buttons", () => {
  assert.deepEqual(serverWriteGate({ data: { writes_enabled: true }, error: undefined }), {
    enabled: true,
    hint: undefined,
  });
  assert.deepEqual(serverWriteGate({ data: { writes_enabled: true } }), { enabled: true, hint: undefined });
});

test("serverWriteGate: a failed refresh disables retries even with stale on data", () => {
  const gate = serverWriteGate({ data: { writes_enabled: true }, error: new Error("HTTP 500") });
  assert.equal(gate.enabled, false);
  assert.match(gate.hint, /probe failed/);
});

test("serverWriteGate: error with no data, off, missing flag and loading all disable", () => {
  assert.equal(serverWriteGate({ error: new Error("x") }).enabled, false);
  assert.match(serverWriteGate({ error: new Error("x") }).hint, /probe failed/);
  assert.deepEqual(serverWriteGate({ data: { writes_enabled: false } }), {
    enabled: false,
    hint: "server: HONCHO_OPERATOR_WRITES off",
  });
  assert.equal(serverWriteGate({ data: {} }).enabled, false);
  assert.deepEqual(serverWriteGate({ data: undefined, error: undefined }), {
    enabled: false,
    hint: "checking server write gate…",
  });
});
