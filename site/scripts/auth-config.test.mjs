import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
  MIN_SECRET_LENGTH,
  SECRET_ERROR_MESSAGE,
  isAuthEnabled,
  parseTtlHours,
  readAuthConfig,
} from "../src/lib/auth/config.ts";
import { isExemptPath, isGuardedPath } from "../src/lib/auth/guard.ts";

const SECRET = "s".repeat(48);

test("auth is disabled without DASHBOARD_PASSWORD", () => {
  assert.equal(isAuthEnabled({}), false);
  assert.equal(isAuthEnabled({ DASHBOARD_PASSWORD: "" }), false);
  assert.deepEqual(readAuthConfig({}), { enabled: false });
  // A secret alone does not enable auth.
  assert.deepEqual(readAuthConfig({ DASHBOARD_SESSION_SECRET: SECRET }), { enabled: false });
});

test("auth is enabled by any non-empty password", () => {
  assert.equal(isAuthEnabled({ DASHBOARD_PASSWORD: "x" }), true);
  assert.equal(isAuthEnabled({ DASHBOARD_PASSWORD: " " }), true);
});

test("password set with a missing secret is a configuration error", () => {
  for (const secret of [undefined, ""]) {
    const cfg = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: secret });
    assert.deepEqual(cfg, { enabled: true, ok: false, error: SECRET_ERROR_MESSAGE });
  }
  assert.match(SECRET_ERROR_MESSAGE, /DASHBOARD_SESSION_SECRET must be set \(>=32 chars\)/);
});

test("secret length boundary: 31 rejected, 32 accepted", () => {
  const short = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: "a".repeat(MIN_SECRET_LENGTH - 1) });
  assert.equal(short.ok, false);
  const exact = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: "a".repeat(MIN_SECRET_LENGTH) });
  assert.equal(exact.ok, true);
});

test("the secret is never derived from the password", () => {
  const long = "p".repeat(64);
  const cfg = readAuthConfig({ DASHBOARD_PASSWORD: long });
  assert.equal(cfg.ok, false);
});

test("valid config carries password, secret and TTL seconds", () => {
  const cfg = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET });
  assert.deepEqual(cfg, { enabled: true, ok: true, password: "pw", secret: SECRET, ttlSeconds: DEFAULT_TTL_HOURS * 3600 });
  const custom = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_SESSION_TTL_HOURS: "2" });
  assert.equal(custom.ttlSeconds, 7200);
});

test("TTL parsing: default, fractions, clamping and junk", () => {
  assert.equal(DEFAULT_TTL_HOURS, 168);
  assert.equal(parseTtlHours(undefined), 168);
  assert.equal(parseTtlHours(""), 168);
  assert.equal(parseTtlHours("   "), 168);
  assert.equal(parseTtlHours("24"), 24);
  assert.equal(parseTtlHours(" 12 "), 12);
  assert.equal(parseTtlHours("0.5"), 0.5);
  for (const bad of ["0", "-3", "abc", "NaN", "Infinity", "-Infinity", "1h"]) {
    assert.equal(parseTtlHours(bad), 168, bad);
  }
  assert.equal(parseTtlHours("999999"), MAX_TTL_HOURS);
});

test("guard: data routes are guarded", () => {
  for (const p of [
    "/api/operator/runtime",
    "/api/operator/db",
    "/api/honcho/v3/workspaces/list",
    "/api",
    "/v3/workspaces/list",
    "/health",
    "/openapi.json",
    "/api/auth", // not an auth route, only /api/auth/* is exempt
    "/api/healthz2",
    "/api//operator/runtime",
    "/api/operator/runtime/",
  ]) {
    assert.equal(isGuardedPath(p), true, p);
  }
});

test("guard: pages, assets and auth routes are not guarded", () => {
  for (const p of [
    "/",
    "/favicon.ico",
    "/_next/static/chunks/a.js",
    "/_next/data/x.json",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/status/",
    "/api/healthz",
    "/images/honcho-logo.svg",
  ]) {
    assert.equal(isGuardedPath(p), false, p);
  }
  assert.equal(isExemptPath("/api/healthz"), true);
  assert.equal(isExemptPath("/api/operator/runtime"), false);
});

test("guard: lookalike prefixes do not slip through", () => {
  assert.equal(isGuardedPath("/api/authx/steal"), true);
  assert.equal(isGuardedPath("/_nextish/api"), false); // not an API path at all
  assert.equal(isGuardedPath("/v3x"), false);
});
