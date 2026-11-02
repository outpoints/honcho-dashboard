import assert from "node:assert/strict";
import test from "node:test";
import { safeFetch, withoutCredentials } from "../src/lib/operator/safeFetch.ts";
import { canonicalize } from "../src/lib/honcho/defaultTarget.ts";

const FIRST = "http://honcho.synthetic.invalid:18100";
const SECOND = "http://second.synthetic.invalid:8000";
const EVIL = "http://169.254.169.254";
const ALLOWED = [FIRST, SECOND].map(canonicalize);
const isAllowed = (location) => {
  const origin = canonicalize(location);
  return !!origin && ALLOWED.includes(origin);
};

const redirect = (status, location) => new Response(null, { status, headers: location ? { location } : {} });
const ok = () => new Response("ok", { status: 200 });

/** Mock fetch with one scripted response per call; returns the recorded calls. */
function script(t, ...responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init, headers: new Headers(init?.headers) });
    return responses[calls.length - 1]();
  });
  return calls;
}

const secretInit = () => ({
  method: "POST",
  body: "{}",
  headers: {
    Authorization: "Bearer server-token-synthetic",
    "X-Honcho-Token": "browser-token",
    Cookie: "sid=1",
    "Content-Type": "application/json",
  },
});

test("a 307 to a second allowlisted base is followed without any credential header", async (t) => {
  const calls = script(t, () => redirect(307, `${SECOND}/health`), ok);
  const res = await safeFetch(`${FIRST}/health`, secretInit(), isAllowed);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);

  assert.equal(calls[0].headers.get("authorization"), "Bearer server-token-synthetic");

  assert.equal(calls[1].url, `${SECOND}/health`);
  for (const name of ["authorization", "x-honcho-token", "cookie", "proxy-authorization", "x-api-key"]) {
    assert.equal(calls[1].headers.has(name), false, name);
  }
  assert.equal(calls[1].headers.get("content-type"), "application/json");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.body, "{}");
  assert.equal(calls[1].init.redirect, "manual");
});

test("every status in the redirect range is handled the same way", async (t) => {
  for (const status of [301, 302, 303, 307, 308]) {
    const calls = script(t, () => redirect(status, `${SECOND}/x`), ok);
    await safeFetch(`${FIRST}/x`, secretInit(), isAllowed);
    assert.equal(calls[1].headers.has("authorization"), false, String(status));
    t.mock.restoreAll();
  }
});

test("a redirect within the same origin keeps the credentials", async (t) => {
  const calls = script(t, () => redirect(307, `${FIRST}/v3/health`), ok);
  await safeFetch(`${FIRST}/health`, secretInit(), isAllowed);
  assert.equal(calls[1].url, `${FIRST}/v3/health`);
  assert.equal(calls[1].headers.get("authorization"), "Bearer server-token-synthetic");
  assert.equal(calls[1].headers.get("x-honcho-token"), "browser-token");
});

test("a different port or scheme on the same host is another origin", async (t) => {
  const other = canonicalize("http://honcho.synthetic.invalid:18101");
  const secure = canonicalize("https://honcho.synthetic.invalid:18100");
  for (const target of [other, secure]) {
    const calls = script(t, () => redirect(302, `${target}/x`), ok);
    await safeFetch(`${FIRST}/x`, secretInit(), (l) => canonicalize(l) === target);
    assert.equal(calls[1].headers.has("authorization"), false, target);
    t.mock.restoreAll();
  }
});

test("a redirect outside the allowlist is still blocked, and nothing is sent to it", async (t) => {
  const calls = script(t, () => redirect(302, `${EVIL}/latest/meta-data/`));
  await assert.rejects(safeFetch(`${FIRST}/health`, secretInit(), isAllowed), (err) => {
    assert.equal(err.name, "BlockedRedirect");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a redirect without a Location is blocked", async (t) => {
  script(t, () => redirect(302));
  await assert.rejects(safeFetch(`${FIRST}/health`, {}, isAllowed), /\(no Location\)/);
});

test("a non-redirect response is returned untouched with a single request", async (t) => {
  const calls = script(t, ok);
  const res = await safeFetch(`${FIRST}/health`, secretInit(), isAllowed);
  assert.equal(await res.text(), "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get("authorization"), "Bearer server-token-synthetic");
});

test("requests with no headers (the openapi probe) redirect cross-origin without error", async (t) => {
  const calls = script(t, () => redirect(307, `${SECOND}/openapi.json`), ok);
  const res = await safeFetch(`${FIRST}/openapi.json`, {}, isAllowed);
  assert.equal(res.status, 200);
  assert.equal(calls[1].url, `${SECOND}/openapi.json`);
});

test("a second redirect is returned, not followed", async (t) => {
  const calls = script(t, () => redirect(307, `${SECOND}/a`), () => redirect(307, `${FIRST}/b`));
  const res = await safeFetch(`${FIRST}/a`, secretInit(), isAllowed);
  assert.equal(res.status, 307);
  assert.equal(calls.length, 2);
});

test("withoutCredentials handles plain objects, Headers and entry arrays without mutating the input", () => {
  const headers = new Headers({ Authorization: "Bearer t", Accept: "application/json" });
  const stripped = withoutCredentials(headers);
  assert.equal(stripped.has("authorization"), false);
  assert.equal(stripped.get("accept"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer t");

  assert.equal(withoutCredentials([["authorization", "Bearer t"], ["accept", "x"]]).has("authorization"), false);
  assert.equal(withoutCredentials({ AUTHORIZATION: "Bearer t" }).has("authorization"), false);
  assert.equal(withoutCredentials(undefined), undefined);
});
