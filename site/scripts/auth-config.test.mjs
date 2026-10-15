import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
  MIN_SECRET_LENGTH,
  SECRET_ERROR_MESSAGE,
  MIN_TTL_SECONDS,
  isAuthEnabled,
  parseTrustedProxies,
  parseTtlHours,
  readAuthConfig,
} from "../src/lib/auth/config.ts";
import { isCrossSiteWrite, isExemptPath, isGuardedPath } from "../src/lib/auth/guard.ts";

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
  assert.deepEqual(cfg, {
    enabled: true,
    ok: true,
    password: "pw",
    secret: SECRET,
    ttlSeconds: DEFAULT_TTL_HOURS * 3600,
    trustedProxies: 1,
  });
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

test("TTL is never shorter than one minute", () => {
  assert.equal(MIN_TTL_SECONDS, 60);
  assert.equal(parseTtlHours("0.0001"), 60 / 3600);
  const tiny = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_SESSION_TTL_HOURS: "0.0001" });
  assert.equal(tiny.ttlSeconds, 60);
  const edge = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_SESSION_TTL_HOURS: "0.017" });
  assert.equal(edge.ttlSeconds, 61);
  const hour = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_SESSION_TTL_HOURS: "1" });
  assert.equal(hour.ttlSeconds, 3600);
});

test("DASHBOARD_TRUSTED_PROXIES: whole numbers 1..10, else 1", () => {
  assert.equal(parseTrustedProxies(undefined), 1);
  assert.equal(parseTrustedProxies(""), 1);
  assert.equal(parseTrustedProxies("2"), 2);
  assert.equal(parseTrustedProxies(" 3 "), 3);
  assert.equal(parseTrustedProxies("99"), 10);
  for (const bad of ["0", "-1", "1.5", "abc", "1e2", "0x2"]) assert.equal(parseTrustedProxies(bad), 1, bad);
  const cfg = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_TRUSTED_PROXIES: "2" });
  assert.equal(cfg.trustedProxies, 2);
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

test("guard: rewrite sources match case-insensitively (Next rewrites do)", () => {
  for (const p of [
    "/V3/workspaces/list",
    "/v3/Workspaces/List",
    "/HEALTH",
    "/Health",
    "/Health/",
    "/OPENAPI.JSON",
    "/OpenAPI.json",
    "/Api/Operator/Runtime",
    "/API/OPERATOR/DB",
    "/Api/Honcho/V3/x",
    "//V3//workspaces",
  ]) {
    assert.equal(isGuardedPath(p), true, p);
  }
  // Case variants of exempt paths stay exempt (none of them serves data).
  assert.equal(isGuardedPath("/API/HEALTHZ"), false);
  assert.equal(isGuardedPath("/Api/Auth/Login"), false);
});

test("guard: lookalike prefixes do not slip through", () => {
  assert.equal(isGuardedPath("/api/authx/steal"), true);
  assert.equal(isGuardedPath("/_nextish/api"), false); // not an API path at all
  assert.equal(isGuardedPath("/v3x"), false);
});

const w = (over) => ({ method: "POST", ...over });

test("CSRF: safe methods are never rejected", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isCrossSiteWrite({ method, secFetchSite: "cross-site", origin: "https://evil.test", host: "dash.test" }), false, method);
  }
});

test("CSRF: Sec-Fetch-Site decides when present", () => {
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "same-origin" })), false);
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "none" })), false);
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "cross-site" })), true);
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "same-site" })), true);
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "Cross-Site" })), true);
  // It wins over a matching Origin.
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "cross-site", origin: "http://dash.test", host: "dash.test" })), true);
  // Rewritten Host behind a proxy: same-origin still passes.
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "same-origin", origin: "https://dash.example", host: "10.0.0.5:3000" })), false);
});

test("CSRF: without Sec-Fetch-Site, Origin must match Host or X-Forwarded-Host", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(isCrossSiteWrite({ method, origin: "http://dash.test", host: "dash.test" }), false, method);
    assert.equal(isCrossSiteWrite({ method, origin: "https://evil.test", host: "dash.test" }), true, method);
  }
  assert.equal(isCrossSiteWrite(w({ origin: "http://dash.test:3000", host: "dash.test:3000" })), false);
  assert.equal(isCrossSiteWrite(w({ origin: "http://dash.test:3001", host: "dash.test:3000" })), true, "port differs");
  assert.equal(isCrossSiteWrite(w({ origin: "https://dash.example", host: "10.0.0.5:3000", forwardedHost: "dash.example" })), false);
  assert.equal(isCrossSiteWrite(w({ origin: "https://dash.example", host: "10.0.0.5:3000", forwardedHost: "dash.example, other" })), false);
  assert.equal(isCrossSiteWrite(w({ origin: "https://evil.test", host: "10.0.0.5:3000", forwardedHost: "dash.example" })), true);
  assert.equal(isCrossSiteWrite(w({ origin: "HTTP://DASH.TEST", host: "dash.test" })), false, "case-insensitive");
  assert.equal(isCrossSiteWrite(w({ origin: "null", host: "dash.test" })), true);
  assert.equal(isCrossSiteWrite(w({ origin: "not a url", host: "dash.test" })), true);
  assert.equal(isCrossSiteWrite(w({ origin: "https://dash.test" })), true, "no Host to compare");
});

test("CSRF: requests without browser headers (curl, server-to-server) pass", () => {
  assert.equal(isCrossSiteWrite(w({})), false);
  assert.equal(isCrossSiteWrite(w({ origin: "", host: "dash.test" })), false);
  assert.equal(isCrossSiteWrite(w({ secFetchSite: "", host: "dash.test" })), false);
});
