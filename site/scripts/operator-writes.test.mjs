import assert from "node:assert/strict";
import test from "node:test";
import {
  CROSS_SITE_REJECTED_REASON,
  OPERATOR_WRITES_DISABLED_REASON,
  OPERATOR_WRITES_ENV,
  isSameOriginRequest,
  operatorWritesEnabled,
  requireOperatorWrites,
  requireSameOrigin,
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

const URL_ = "http://dash.test:3000/api/operator/db?action=retry_all_failed_reasoning";
const h = (o) => new Headers(o);

test("same-origin: Sec-Fetch-Site same-origin or none is allowed", () => {
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "same-origin" }), URL_), true);
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "none" }), URL_), true);
});

test("same-origin: cross-site and same-site Sec-Fetch-Site are rejected", () => {
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "cross-site" }), URL_), false);
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "same-site" }), URL_), false);
});

test("same-origin: missing headers (curl, server-to-server) are allowed", () => {
  assert.equal(isSameOriginRequest(h({}), URL_), true);
  assert.equal(isSameOriginRequest(h({ host: "dash.test:3000" }), URL_), true);
});

test("same-origin: Origin host must match the Host header", () => {
  const host = "dash.test:3000";
  assert.equal(isSameOriginRequest(h({ origin: "http://dash.test:3000", host }), URL_), true);
  assert.equal(isSameOriginRequest(h({ origin: "http://evil.test", host }), URL_), false);
  assert.equal(isSameOriginRequest(h({ origin: "http://dash.test:3001", host }), URL_), false);
  assert.equal(isSameOriginRequest(h({ origin: "null", host }), URL_), false);
  assert.equal(isSameOriginRequest(h({ origin: "not a url", host }), URL_), false);
});

test("same-origin: falls back to the request URL host, honours x-forwarded-host", () => {
  assert.equal(isSameOriginRequest(h({ origin: "http://dash.test:3000" }), URL_), true);
  assert.equal(isSameOriginRequest(h({ origin: "http://evil.test" }), URL_), false);
  assert.equal(
    isSameOriginRequest(
      h({ origin: "https://dash.example", host: "internal:3000", "x-forwarded-host": "dash.example" }),
      URL_,
    ),
    true,
  );
});

test("same-origin: Sec-Fetch-Site decides alone when present (Host rewritten by a proxy)", () => {
  // nginx `proxy_pass http://dashboard:3000;` rewrites Host and sends no X-Forwarded-Host.
  assert.equal(
    isSameOriginRequest(
      h({ "sec-fetch-site": "same-origin", origin: "https://dash.example", host: "dashboard:3000" }),
      "http://dashboard:3000/api/operator/db",
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(h({ "sec-fetch-site": "same-origin", origin: "http://evil.test", host: "dash.test:3000" }), URL_),
    true,
    "Origin is not consulted when Sec-Fetch-Site says same-origin",
  );
});

test("same-origin: cross-site Sec-Fetch-Site rejects even when Origin matches Host", () => {
  assert.equal(
    isSameOriginRequest(h({ "sec-fetch-site": "cross-site", origin: "http://dash.test:3000", host: "dash.test:3000" }), URL_),
    false,
  );
});

test("requireSameOrigin returns null or a 403 with the cross-site reason", async () => {
  assert.equal(requireSameOrigin(h({}), URL_), null);
  const res = requireSameOrigin(h({ "sec-fetch-site": "cross-site" }), URL_);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: CROSS_SITE_REJECTED_REASON });
});
