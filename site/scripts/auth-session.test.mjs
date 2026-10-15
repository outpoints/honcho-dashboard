import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_COOKIE_NAME,
  clearedSessionCookie,
  constantTimeEqual,
  isSecureRequest,
  parseCookie,
  sessionCookie,
  signSession,
  verifySession,
} from "../src/lib/auth/session.ts";
import { LoginLimiter, clientKey } from "../src/lib/auth/rateLimit.ts";
import { processLogin } from "../src/lib/auth/login.ts";
import { readAuthConfig } from "../src/lib/auth/config.ts";
import { AUTH_REQUIRED_HEADER, isAuthRequiredResponse } from "../src/lib/auth/constants.ts";

const SECRET = "k".repeat(48);
const OTHER = "z".repeat(48);
const NOW = 1_800_000_000_000;

test("sign/verify round trip", async () => {
  const token = await signSession(SECRET, 3600, NOW);
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(await verifySession(SECRET, token, NOW), true);
  assert.equal(await verifySession(SECRET, token, NOW + 3599_000), true);
});

test("tokens are unique per call (random nonce)", async () => {
  const a = await signSession(SECRET, 60, NOW);
  const b = await signSession(SECRET, 60, NOW);
  assert.notEqual(a, b);
});

test("expired token is rejected, at and after the expiry second", async () => {
  const token = await signSession(SECRET, 3600, NOW);
  assert.equal(await verifySession(SECRET, token, NOW + 3600_000), false);
  assert.equal(await verifySession(SECRET, token, NOW + 99_999_000), false);
});

test("token signed with another secret is rejected", async () => {
  const token = await signSession(OTHER, 3600, NOW);
  assert.equal(await verifySession(SECRET, token, NOW), false);
});

test("tampered signature is rejected", async () => {
  const token = await signSession(SECRET, 3600, NOW);
  const [exp, nonce, sig] = token.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(await verifySession(SECRET, `${exp}.${nonce}.${flipped}`, NOW), false);
  assert.equal(await verifySession(SECRET, `${exp}.${nonce}.${sig.slice(0, -2)}`, NOW), false);
  assert.equal(await verifySession(SECRET, `${exp}.${nonce}.${sig}AA`, NOW), false);
});

test("tampered expiry or nonce is rejected", async () => {
  const token = await signSession(SECRET, 60, NOW);
  const [exp, nonce, sig] = token.split(".");
  assert.equal(await verifySession(SECRET, `${Number(exp) + 100000}.${nonce}.${sig}`, NOW), false);
  assert.equal(await verifySession(SECRET, `${exp}.${nonce}x.${sig}`, NOW), false);
});

test("malformed tokens are rejected without throwing", async () => {
  const good = await signSession(SECRET, 3600, NOW);
  const bad = [
    undefined,
    null,
    "",
    "abc",
    "a.b",
    "a.b.c.d",
    "..",
    "1..",
    "NaN.x.y",
    "-5.x.y",
    "1e9.x.y",
    "1.x.!!!!",
    "1.x.%%%",
    "1.n.sig with spaces",
    `${good}.extra`,
    "x".repeat(10_000),
  ];
  for (const t of bad) assert.equal(await verifySession(SECRET, t, NOW), false, String(t).slice(0, 30));
});

test("a legacy-looking unsigned token (exp.nonce.empty) is rejected", async () => {
  assert.equal(await verifySession(SECRET, `${Math.floor(NOW / 1000) + 100}.abc.`, NOW), false);
});

test("parseCookie finds the session among several cookies", () => {
  const header = `a=1; ${SESSION_COOKIE_NAME}=tok.en.sig; b=2`;
  assert.equal(parseCookie(header, SESSION_COOKIE_NAME), "tok.en.sig");
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}="quoted"`, SESSION_COOKIE_NAME), "quoted");
  assert.equal(parseCookie(`x${SESSION_COOKIE_NAME}=nope`, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}x=nope`, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}=`, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie("garbage", SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie(null, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie(undefined, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie("", SESSION_COOKIE_NAME), null);
});

test("constantTimeEqual compares content and length", async () => {
  assert.equal(await constantTimeEqual("hunter2", "hunter2"), true);
  assert.equal(await constantTimeEqual("hunter2", "hunter3"), false);
  assert.equal(await constantTimeEqual("hunter2", "hunter22"), false);
  assert.equal(await constantTimeEqual("", ""), true);
  assert.equal(await constantTimeEqual("", "x"), false);
  assert.equal(await constantTimeEqual("pässword", "pässword"), true);
});

test("cookie attributes", () => {
  const c = sessionCookie("t.o.k", 3600, false);
  assert.match(c, new RegExp(`^${SESSION_COOKIE_NAME}=t\\.o\\.k;`));
  for (const attr of ["Path=/", "Max-Age=3600", "HttpOnly", "SameSite=Lax"]) assert.ok(c.includes(attr), attr);
  assert.ok(!c.includes("Secure"));
  assert.ok(sessionCookie("t", 60, true).includes("Secure"));
  const cleared = clearedSessionCookie(true);
  assert.ok(cleared.includes("Max-Age=0") && cleared.includes("Secure") && cleared.includes("HttpOnly"));
  assert.ok(cleared.startsWith(`${SESSION_COOKIE_NAME}=;`));
});

test("isSecureRequest honours x-forwarded-proto first, then the URL", () => {
  assert.equal(isSecureRequest("https", "http:"), true);
  assert.equal(isSecureRequest("https, http", "http:"), true);
  assert.equal(isSecureRequest("http", "https:"), false);
  assert.equal(isSecureRequest(null, "https:"), true);
  assert.equal(isSecureRequest(undefined, "http:"), false);
});

test("limiter: reserve counts attempts synchronously, 10 allowed then blocked", () => {
  const l = new LoginLimiter();
  const t0 = 1_000_000;
  const results = Array.from({ length: 50 }, () => l.reserve("1.1.1.1", t0));
  assert.equal(results.filter((r) => !r.limited).length, 10);
  assert.equal(results.filter((r) => r.limited).length, 40);
  const blocked = l.check("1.1.1.1", t0 + 1000);
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 900);
  assert.equal(l.check("2.2.2.2", t0).limited, false, "other clients unaffected");
  assert.equal(l.check("1.1.1.1", t0 + 15 * 60 * 1000 + 10).limited, false, "window passes");
});

test("limiter: blocked reservations are not recorded and release frees one slot", () => {
  const l = new LoginLimiter(2, 1000);
  const a = l.reserve("k", 0);
  const b = l.reserve("k", 1);
  assert.equal(l.reserve("k", 2).limited, true);
  a.release();
  a.release(); // idempotent
  assert.equal(l.check("k", 3).limited, false);
  const c = l.reserve("k", 3);
  assert.equal(c.limited, false);
  assert.equal(l.reserve("k", 4).limited, true);
  b.release();
  c.release();
  assert.equal(l.check("k", 5).limited, false);
  l.reserve("k", 6); // old failures age out
  assert.equal(l.check("k", 2000).limited, false);
});

test("clientKey: last x-forwarded-for hop by default, n-th from the right when configured", () => {
  const h = (o) => new Headers(o);
  // The client-supplied value is on the left; the proxy appended the right-most.
  assert.equal(clientKey(h({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(h({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(h({ "x-forwarded-for": "6.6.6.6, 9.9.9.9, 10.0.0.1" }), 2), "9.9.9.9");
  assert.equal(clientKey(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), 5), "9.9.9.9", "fewer hops than configured");
  assert.equal(clientKey(h({ "x-forwarded-for": "a, ,b," })), "b");
  assert.equal(clientKey(h({ "x-real-ip": "8.8.8.8" })), "8.8.8.8");
  assert.equal(clientKey(h({ "x-forwarded-for": "  ", "x-real-ip": "8.8.8.8" })), "8.8.8.8");
  assert.equal(clientKey(h({})), "unknown");
});

test("clientKey: spoofing the left of x-forwarded-for does not change the key", () => {
  const key = (spoof) => clientKey(new Headers({ "x-forwarded-for": `${spoof}, 203.0.113.9` }));
  assert.equal(key("1.1.1.1"), key("2.2.2.2"));
});

const cfg = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET });
const loginReq = (password, ip, delayMs = 0) => ({
  url: "http://dash.test/api/auth/login",
  headers: new Headers({ "x-forwarded-for": `spoof, ${ip}` }),
  json: async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { password };
  },
});

test("processLogin: 50 concurrent slow wrong-password attempts yield 10 x 401 and 40 x 429", async () => {
  const limiter = new LoginLimiter();
  const res = await Promise.all(
    Array.from({ length: 50 }, () => processLogin(loginReq("bad", "5.5.5.5", 25), cfg, limiter)),
  );
  const count = (s) => res.filter((r) => r.status === s).length;
  assert.equal(count(401), 10);
  assert.equal(count(429), 40);
  assert.ok(Number(res.find((r) => r.status === 429).headers.get("retry-after")) > 0);
  // Even the correct password is refused while blocked; another client still works.
  assert.equal((await processLogin(loginReq("pw", "5.5.5.5"), cfg, limiter)).status, 429);
  assert.equal((await processLogin(loginReq("pw", "6.6.6.6"), cfg, limiter)).status, 204);
});

test("processLogin: success sets the cookie and does not consume the budget", async () => {
  const limiter = new LoginLimiter();
  for (let i = 0; i < 30; i++) {
    const res = await processLogin(loginReq("pw", "7.7.7.7"), cfg, limiter);
    assert.equal(res.status, 204);
  }
  const ok = await processLogin(loginReq("pw", "7.7.7.7"), cfg, limiter);
  assert.match(ok.headers.get("set-cookie"), /^honcho_dashboard_session=\d+\.[\w-]+\.[\w-]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
  assert.equal((await processLogin(loginReq("bad", "7.7.7.7"), cfg, limiter)).status, 401);
});

test("processLogin: concurrent mix of correct and wrong passwords from one IP", async () => {
  const limiter = new LoginLimiter();
  const res = await Promise.all(
    Array.from({ length: 30 }, (_, i) => processLogin(loginReq(i % 2 ? "pw" : "bad", "4.4.4.4", 10), cfg, limiter)),
  );
  // 10 reservations pass; 15 wrong ones are only partly admitted, never more than 10 attempts in total.
  const admitted = res.filter((r) => r.status !== 429).length;
  assert.equal(admitted, 10);
});

test("processLogin: malformed bodies and non-string passwords count as failures", async () => {
  const limiter = new LoginLimiter();
  const bad = [
    { ...loginReq("x", "3.3.3.3"), json: async () => { throw new Error("bad json"); } },
    { ...loginReq("x", "3.3.3.3"), json: async () => null },
    loginReq(12345, "3.3.3.3"),
    loginReq(undefined, "3.3.3.3"),
    loginReq(["pw"], "3.3.3.3"),
  ];
  for (const r of bad) assert.equal((await processLogin(r, cfg, limiter)).status, 401);
});

test("processLogin: disabled -> 404, misconfigured -> 500 and neither counts attempts", async () => {
  const limiter = new LoginLimiter();
  assert.equal((await processLogin(loginReq("pw", "1.2.3.4"), readAuthConfig({}), limiter)).status, 404);
  const broken = readAuthConfig({ DASHBOARD_PASSWORD: "pw" });
  const res = await processLogin(loginReq("pw", "1.2.3.4"), broken, limiter);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /DASHBOARD_SESSION_SECRET must be set/);
  assert.equal(limiter.check("1.2.3.4").limited, false);
});

test("trusted proxy count from config selects the right hop", async () => {
  const two = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_TRUSTED_PROXIES: "2" });
  const limiter = new LoginLimiter(1, 60_000);
  const req = (edge) => ({
    url: "http://dash.test/api/auth/login",
    headers: new Headers({ "x-forwarded-for": `1.1.1.1, 9.9.9.9, ${edge}` }),
    json: async () => ({ password: "bad" }),
  });
  assert.equal((await processLogin(req("10.0.0.1"), two, limiter)).status, 401);
  // Same client (second from the right), different edge proxy address: same bucket.
  assert.equal((await processLogin(req("10.0.0.2"), two, limiter)).status, 429);
});

test("guard 401 marker: only the dashboard's own 401 counts as auth-required", () => {
  const res = (status, marker) =>
    new Response("{}", { status, headers: marker ? { [AUTH_REQUIRED_HEADER]: marker } : {} });
  assert.equal(isAuthRequiredResponse(res(401, "required")), true);
  assert.equal(isAuthRequiredResponse(res(401)), false, "Honcho 401 has no marker");
  assert.equal(isAuthRequiredResponse(res(403, "required")), false);
  assert.equal(isAuthRequiredResponse(res(200, "required")), false);
  assert.equal(isAuthRequiredResponse(res(401, "nope")), false);
});
