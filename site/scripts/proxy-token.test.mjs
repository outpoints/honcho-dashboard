import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BASE_URL_META,
  DEFAULT_TOKEN_MANAGED_META,
  canonicalize,
  readRuntimeEnv,
  resetInvalidTokenWarning,
  resolveRequestToken,
  serverDefaultToken,
  serverManagedToken,
} from "../src/lib/honcho/defaultTarget.ts";

// resolveHonchoTarget lives in allowlist.ts, which imports `server-only` and
// cannot load outside Next. It delegates the token decision to
// resolveRequestToken, which is what these tests exercise.

const DEFAULT = "http://honcho.synthetic.invalid:18100";
const OTHER = "http://second.synthetic.invalid:8000";
const SOURCES = { proxyBaseUrl: DEFAULT };
const TOKEN = "server-token-synthetic";

/** resolveRequestToken for a request that named its target, as every dashboard call does. */
const resolve = (headerToken, origin, sources, envToken, baseUrlSent = true) =>
  resolveRequestToken(headerToken, origin, sources, envToken, baseUrlSent);

const defaultOrigin = canonicalize(DEFAULT);
const otherOrigin = canonicalize(OTHER);

test("env unset: no token is injected, with or without a header", () => {
  assert.equal(resolve(null, defaultOrigin, SOURCES, undefined), undefined);
  assert.equal(resolve("hdr", defaultOrigin, SOURCES, undefined), "hdr");
});

test("env set, header present: the header wins", () => {
  assert.equal(resolve("browser-token", defaultOrigin, SOURCES, TOKEN), "browser-token");
  assert.equal(resolve("browser-token", otherOrigin, SOURCES, TOKEN), "browser-token");
});

test("env set, no header, origin is the default: the env token is used", () => {
  assert.equal(resolve(null, defaultOrigin, SOURCES, TOKEN), TOKEN);
});

test("env set, no header, another allowlisted origin: nothing is injected", () => {
  assert.equal(resolve(null, otherOrigin, SOURCES, TOKEN), undefined);
  assert.equal(serverDefaultToken(otherOrigin, SOURCES, TOKEN), undefined);
});

test("env set to whitespace or empty is treated as unset", () => {
  for (const blank of ["", "   ", "\n\t"]) {
    assert.equal(serverManagedToken(blank), undefined);
    assert.equal(resolve(null, defaultOrigin, SOURCES, blank), undefined);
  }
});

test("the env token is trimmed", () => {
  assert.equal(resolve(null, defaultOrigin, SOURCES, `  ${TOKEN}\n`), TOKEN);
});

test("a blank header does not mask the server token", () => {
  assert.equal(resolve("", defaultOrigin, SOURCES, TOKEN), TOKEN);
  assert.equal(resolve("  ", defaultOrigin, SOURCES, TOKEN), TOKEN);
});

test("the default is matched on the canonical origin, whichever source supplies it", () => {
  const sources = { runtimePublicBaseUrl: `${DEFAULT}/`, buildPublicBaseUrl: "http://localhost:8000" };
  assert.equal(resolve(null, defaultOrigin, sources, TOKEN), TOKEN);
  assert.equal(resolve(null, "http://localhost:8000", sources, TOKEN), undefined);
});

test("no default target configured: the env token has nowhere to apply", () => {
  assert.equal(resolve(null, defaultOrigin, {}, TOKEN), undefined);
  assert.equal(resolve(null, defaultOrigin, { proxyBaseUrl: "not a url" }, TOKEN), undefined);
});

test("a look-alike origin does not receive the token", () => {
  for (const lookalike of [
    "https://honcho.synthetic.invalid:18100",
    "http://honcho.synthetic.invalid:18101",
    "http://honcho.synthetic.invalid",
    "http://honcho.synthetic.invalid.evil.invalid:18100",
  ]) {
    assert.equal(resolve(null, canonicalize(lookalike), SOURCES, TOKEN), undefined, lookalike);
  }
});

test("HONCHO_PROXY_TOKEN is read by computed key from the runtime env", () => {
  assert.equal(readRuntimeEnv({ HONCHO_PROXY_TOKEN: TOKEN }, "HONCHO_PROXY_TOKEN"), TOKEN);
  assert.equal(readRuntimeEnv({}, "HONCHO_PROXY_TOKEN"), undefined);
});

test("the advertised meta names are stable and distinct", () => {
  assert.equal(DEFAULT_TOKEN_MANAGED_META, "honcho-dashboard:default-token-managed");
  assert.notEqual(DEFAULT_TOKEN_MANAGED_META, DEFAULT_BASE_URL_META);
});

// ---- invalid header values ----

/** Capture console.warn and return what it was called with. */
function captureWarnings(t) {
  const calls = [];
  t.mock.method(console, "warn", (...args) => calls.push(args.map(String).join(" ")));
  return calls;
}

const INVALID = [
  ["a newline mid-value", "abc\ndef"],
  ["a carriage return mid-value", "abc\rdef"],
  ["CRLF header injection", "abc\r\nX-Evil: 1"],
  ["a NUL byte", "abc\0def"],
  ["another control character", "abc\x07def"],
  ["DEL", "abc\x7fdef"],
  ["a non-ASCII character", "abcédef"],
  ["a character above Latin-1", "abc☃def"],
];

test("env values with invalid header characters count as unset", (t) => {
  captureWarnings(t);
  for (const [name, value] of INVALID) {
    resetInvalidTokenWarning();
    assert.equal(serverManagedToken(value), undefined, name);
    assert.equal(serverManagedToken(`  ${value}\n`), undefined, `${name}, padded`);
    assert.equal(resolve(null, defaultOrigin, SOURCES, value), undefined, name);
    assert.equal(serverDefaultToken(defaultOrigin, SOURCES, value), undefined, name);
  }
});

test("an invalid env value does not mask a token the browser sent", (t) => {
  captureWarnings(t);
  assert.equal(resolve("browser-token", defaultOrigin, SOURCES, "abc\ndef"), "browser-token");
});

test("a rejected value warns once, and the warning never contains the value", (t) => {
  const calls = captureWarnings(t);
  resetInvalidTokenWarning();
  const secret = "s3cr3t-line-one\ns3cr3t-line-two";
  for (let i = 0; i < 5; i++) assert.equal(serverManagedToken(secret), undefined);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /HONCHO_PROXY_TOKEN/);
  assert.equal(calls[0].includes("s3cr3t"), false);
  assert.equal(calls[0].includes("line-one"), false);
});

test("valid values never warn, including unset, blank and padded ones", (t) => {
  const calls = captureWarnings(t);
  resetInvalidTokenWarning();
  for (const ok of [undefined, "", "   ", "\n", TOKEN, `  ${TOKEN}\n`, "a.b-c_d~e+f/g=", "two words", "tab\tinside"]) {
    serverManagedToken(ok);
  }
  assert.deepEqual(calls, []);
});

test("an accepted token is a valid Authorization header value", () => {
  for (const ok of [TOKEN, "a.b-c_d~e+f/g=", "two words", "tab\tinside"]) {
    const token = serverManagedToken(ok);
    assert.equal(token, ok);
    assert.doesNotThrow(() => new Headers().set("authorization", `Bearer ${token}`));
  }
});

test("a line break or NUL in the value would have made Headers throw, with the value in the message", () => {
  // Why the value must be dropped before it is used: this is the error
  // /api/operator/diagnostics used to hand back to an unauthenticated caller.
  for (const value of ["abc\ndef", "abc\rdef", "abc\0def", "abc\r\nX-Evil: 1"]) {
    assert.throws(
      () => new Headers().append("authorization", `Bearer ${value}`),
      (err) => err.message.includes("abc"),
      JSON.stringify(value),
    );
  }
});

// ---- cross-site requests: the server token needs X-Honcho-Base-Url ----

test("a request without X-Honcho-Base-Url gets no server token, even for the default target", () => {
  assert.equal(resolve(null, defaultOrigin, SOURCES, TOKEN, false), undefined);
  assert.equal(resolve("", defaultOrigin, SOURCES, TOKEN, false), undefined);
  assert.equal(resolve("  ", defaultOrigin, SOURCES, TOKEN, false), undefined);
});

test("a request with X-Honcho-Base-Url still gets the server token on the default target only", () => {
  assert.equal(resolve(null, defaultOrigin, SOURCES, TOKEN, true), TOKEN);
  assert.equal(resolve(null, otherOrigin, SOURCES, TOKEN, true), undefined);
});

test("an explicit X-Honcho-Token is the caller's own credential and passes without the base URL header", () => {
  assert.equal(resolve("browser-token", defaultOrigin, SOURCES, TOKEN, false), "browser-token");
});
