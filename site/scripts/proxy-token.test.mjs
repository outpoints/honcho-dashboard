import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BASE_URL_META,
  DEFAULT_TOKEN_MANAGED_META,
  canonicalize,
  readRuntimeEnv,
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

const defaultOrigin = canonicalize(DEFAULT);
const otherOrigin = canonicalize(OTHER);

test("env unset: no token is injected, with or without a header", () => {
  assert.equal(resolveRequestToken(null, defaultOrigin, SOURCES, undefined), undefined);
  assert.equal(resolveRequestToken("hdr", defaultOrigin, SOURCES, undefined), "hdr");
});

test("env set, header present: the header wins", () => {
  assert.equal(resolveRequestToken("browser-token", defaultOrigin, SOURCES, TOKEN), "browser-token");
  assert.equal(resolveRequestToken("browser-token", otherOrigin, SOURCES, TOKEN), "browser-token");
});

test("env set, no header, origin is the default: the env token is used", () => {
  assert.equal(resolveRequestToken(null, defaultOrigin, SOURCES, TOKEN), TOKEN);
});

test("env set, no header, another allowlisted origin: nothing is injected", () => {
  assert.equal(resolveRequestToken(null, otherOrigin, SOURCES, TOKEN), undefined);
  assert.equal(serverDefaultToken(otherOrigin, SOURCES, TOKEN), undefined);
});

test("env set to whitespace or empty is treated as unset", () => {
  for (const blank of ["", "   ", "\n\t"]) {
    assert.equal(serverManagedToken(blank), undefined);
    assert.equal(resolveRequestToken(null, defaultOrigin, SOURCES, blank), undefined);
  }
});

test("the env token is trimmed", () => {
  assert.equal(resolveRequestToken(null, defaultOrigin, SOURCES, `  ${TOKEN}\n`), TOKEN);
});

test("a blank header does not mask the server token", () => {
  assert.equal(resolveRequestToken("", defaultOrigin, SOURCES, TOKEN), TOKEN);
  assert.equal(resolveRequestToken("  ", defaultOrigin, SOURCES, TOKEN), TOKEN);
});

test("the default is matched on the canonical origin, whichever source supplies it", () => {
  const sources = { runtimePublicBaseUrl: `${DEFAULT}/`, buildPublicBaseUrl: "http://localhost:8000" };
  assert.equal(resolveRequestToken(null, defaultOrigin, sources, TOKEN), TOKEN);
  assert.equal(resolveRequestToken(null, "http://localhost:8000", sources, TOKEN), undefined);
});

test("no default target configured: the env token has nowhere to apply", () => {
  assert.equal(resolveRequestToken(null, defaultOrigin, {}, TOKEN), undefined);
  assert.equal(resolveRequestToken(null, defaultOrigin, { proxyBaseUrl: "not a url" }, TOKEN), undefined);
});

test("a look-alike origin does not receive the token", () => {
  for (const lookalike of [
    "https://honcho.synthetic.invalid:18100",
    "http://honcho.synthetic.invalid:18101",
    "http://honcho.synthetic.invalid",
    "http://honcho.synthetic.invalid.evil.invalid:18100",
  ]) {
    assert.equal(resolveRequestToken(null, canonicalize(lookalike), SOURCES, TOKEN), undefined, lookalike);
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
