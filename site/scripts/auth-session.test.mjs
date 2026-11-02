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
import {
  LOGIN_GLOBAL_MAX_FAILURES,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  LoginLimiter,
  clientKey,
} from "../src/lib/auth/rateLimit.ts";
import { processLogin } from "../src/lib/auth/login.ts";
import { readAuthConfig } from "../src/lib/auth/config.ts";
import { AUTH_REQUIRED_HEADER, isAuthRequiredResponse } from "../src/lib/auth/constants.ts";

const SECRET = "k".repeat(48);
const OTHER = "z".repeat(48);
const NOW = 1_800_000_000_000;
const PASSWORD = "correct horse";
const params = (o = {}) => ({ secret: SECRET, password: PASSWORD, ttlSeconds: 3600, ...o });

test("sign/verify round trip", async () => {
  const token = await signSession(params(), NOW);
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(await verifySession(params(), token, NOW), true);
  assert.equal(await verifySession(params(), token, NOW + 3599_000), true);
});

test("tokens are unique per call (random nonce)", async () => {
  const a = await signSession(params({ ttlSeconds: 60 }), NOW);
  const b = await signSession(params({ ttlSeconds: 60 }), NOW);
  assert.notEqual(a, b);
});

test("expired token is rejected, at and after the expiry second", async () => {
  const token = await signSession(params(), NOW);
  assert.equal(await verifySession(params(), token, NOW + 3600_000), false);
  assert.equal(await verifySession(params(), token, NOW + 99_999_000), false);
});

test("token signed with another secret is rejected", async () => {
  const token = await signSession(params({ secret: OTHER }), NOW);
  assert.equal(await verifySession(params(), token, NOW), false);
});

test("changing the password ends every existing session", async () => {
  const token = await signSession(params(), NOW);
  assert.equal(await verifySession(params(), token, NOW), true);
  for (const password of ["correct horse2", "Correct horse", " correct horse", "correct horse ", "x", "pässword"]) {
    assert.equal(await verifySession(params({ password }), token, NOW), false, JSON.stringify(password));
  }
  // The new password signs sessions of its own, which the old one rejects.
  const fresh = await signSession(params({ password: "new password" }), NOW);
  assert.equal(await verifySession(params({ password: "new password" }), fresh, NOW), true);
  assert.equal(await verifySession(params(), fresh, NOW), false);
});

test("unicode and long passwords sign and verify", async () => {
  for (const password of ["pässword-密码-🔑", "p".repeat(10_000)]) {
    const token = await signSession(params({ password }), NOW);
    assert.equal(await verifySession(params({ password }), token, NOW), true);
    assert.equal(await verifySession(params(), token, NOW), false);
  }
});

test("a password is not interchangeable with the secret", async () => {
  // Swapping the two values must not produce the same key.
  const token = await signSession({ secret: SECRET, password: OTHER, ttlSeconds: 3600 }, NOW);
  assert.equal(await verifySession({ secret: OTHER, password: SECRET, ttlSeconds: 3600 }, token, NOW), false);
});

test("a TTL change does not alter the signing key, only the accepted lifetime", async () => {
  const token = await signSession(params({ ttlSeconds: 60 }), NOW);
  assert.equal(await verifySession(params({ ttlSeconds: 86_400 }), token, NOW), true);
});

test("lowering the TTL rejects tokens that outlive it, with exact boundaries", async () => {
  const week = 168 * 3600;
  const day = 24 * 3600;
  const token = await signSession(params({ ttlSeconds: week }), NOW);
  const at = (secondsLater) => NOW + secondsLater * 1000;
  // Issued under 168 h, checked under a 24 h TTL: only the last 24 h remain valid.
  assert.equal(await verifySession(params({ ttlSeconds: day }), token, at(0)), false, "just issued");
  assert.equal(await verifySession(params({ ttlSeconds: day }), token, at(week - day - 1)), false, "1 s too early");
  assert.equal(await verifySession(params({ ttlSeconds: day }), token, at(week - day)), true, "exactly ttl remaining");
  assert.equal(await verifySession(params({ ttlSeconds: day }), token, at(week - 1)), true, "last second");
  assert.equal(await verifySession(params({ ttlSeconds: day }), token, at(week)), false, "expired");
  // Unchanged TTL: valid for the whole lifetime.
  assert.equal(await verifySession(params({ ttlSeconds: week }), token, at(0)), true);
  assert.equal(await verifySession(params({ ttlSeconds: week }), token, at(week - 1)), true);
  assert.equal(await verifySession(params({ ttlSeconds: week }), token, at(week)), false);
  // Raising the TTL never extends an existing token.
  assert.equal(await verifySession(params({ ttlSeconds: week * 2 }), token, at(week)), false);
});

test("TTL boundary: a fresh token is valid iff the verifying TTL is at least its own", async () => {
  const token = await signSession(params({ ttlSeconds: 3600 }), NOW);
  assert.equal(await verifySession(params({ ttlSeconds: 3600 }), token, NOW), true);
  assert.equal(await verifySession(params({ ttlSeconds: 3599 }), token, NOW), false);
  assert.equal(await verifySession(params({ ttlSeconds: 3599.9 }), token, NOW), false);
  assert.equal(await verifySession(params({ ttlSeconds: 3600.9 }), token, NOW), true);
  assert.equal(await verifySession(params({ ttlSeconds: 0 }), token, NOW), false);
});

test("sub-second clock values use whole seconds on both sides", async () => {
  const token = await signSession(params({ ttlSeconds: 60 }), NOW + 999);
  assert.equal(await verifySession(params({ ttlSeconds: 60 }), token, NOW + 999), true);
  assert.equal(await verifySession(params({ ttlSeconds: 60 }), token, NOW + 59_999), true);
  assert.equal(await verifySession(params({ ttlSeconds: 60 }), token, NOW + 60_000), false);
});

test("a token with an absurdly distant expiry is refused even if correctly signed", async () => {
  const farFuture = await signSession(params({ ttlSeconds: 10 * 365 * 86_400 }), NOW);
  assert.equal(await verifySession(params({ ttlSeconds: 365 * 86_400 }), farFuture, NOW), false);
});

test("tampered signature is rejected", async () => {
  const token = await signSession(params(), NOW);
  const [exp, nonce, sig] = token.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(await verifySession(params(), `${exp}.${nonce}.${flipped}`, NOW), false);
  assert.equal(await verifySession(params(), `${exp}.${nonce}.${sig.slice(0, -2)}`, NOW), false);
  assert.equal(await verifySession(params(), `${exp}.${nonce}.${sig}AA`, NOW), false);
});

test("tampered expiry or nonce is rejected", async () => {
  const token = await signSession(params({ ttlSeconds: 60 }), NOW);
  const [exp, nonce, sig] = token.split(".");
  assert.equal(await verifySession(params(), `${Number(exp) + 100000}.${nonce}.${sig}`, NOW), false);
  assert.equal(await verifySession(params(), `${exp}.${nonce}x.${sig}`, NOW), false);
});

test("malformed tokens are rejected without throwing", async () => {
  const good = await signSession(params(), NOW);
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
  for (const t of bad) assert.equal(await verifySession(params(), t, NOW), false, String(t).slice(0, 30));
});

test("a legacy-looking unsigned token (exp.nonce.empty) is rejected", async () => {
  assert.equal(await verifySession(params(), `${Math.floor(NOW / 1000) + 100}.abc.`, NOW), false);
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

test("limiter defaults: 10 per client and 30 overall per 15 minutes", () => {
  assert.equal(LOGIN_MAX_FAILURES, 10);
  assert.equal(LOGIN_GLOBAL_MAX_FAILURES, 30);
  assert.equal(LOGIN_WINDOW_MS, 15 * 60 * 1000);
});

test("limiter: rotating the client key cannot exceed the global cap", () => {
  const l = new LoginLimiter();
  const t0 = 5_000_000;
  // 100 attempts, each from a "new" address (what a spoofed X-Forwarded-For does).
  const results = Array.from({ length: 100 }, (_, i) => l.reserve(`10.0.0.${i}`, t0 + i));
  assert.equal(results.filter((r) => !r.limited).length, LOGIN_GLOBAL_MAX_FAILURES);
  assert.equal(results.filter((r) => r.limited).length, 100 - LOGIN_GLOBAL_MAX_FAILURES);
  // A client that has never been seen is refused too, until the window passes.
  const fresh = l.check("203.0.113.1", t0 + 1000);
  assert.equal(fresh.limited, true);
  assert.ok(fresh.retryAfterSeconds > 0 && fresh.retryAfterSeconds <= 900);
});

test("limiter: the global cap lifts on its own as failures age out", () => {
  const l = new LoginLimiter();
  const t0 = 9_000_000;
  for (let i = 0; i < LOGIN_GLOBAL_MAX_FAILURES; i++) l.reserve(`k${i}`, t0 + i * 1000);
  assert.equal(l.check("new", t0 + 30_000).limited, true);
  // Retry-After points at the moment the oldest counted failure leaves the window.
  assert.equal(l.check("new", t0 + 30_000).retryAfterSeconds, Math.ceil((t0 + LOGIN_WINDOW_MS - (t0 + 30_000)) / 1000));
  // One millisecond before the oldest ages out: still blocked. At the boundary: one slot frees.
  assert.equal(l.check("new", t0 + LOGIN_WINDOW_MS - 1).limited, true);
  assert.equal(l.check("new", t0 + LOGIN_WINDOW_MS).limited, false);
  assert.equal(l.reserve("new", t0 + LOGIN_WINDOW_MS).limited, false);
  assert.equal(l.reserve("new2", t0 + LOGIN_WINDOW_MS).limited, true, "only one slot freed");
  // Everything recovers once the whole window has passed.
  const later = t0 + 2 * LOGIN_WINDOW_MS;
  assert.equal(l.check("new2", later).limited, false);
  assert.equal(Array.from({ length: 10 }, () => l.reserve("same", later)).filter((r) => !r.limited).length, 10);
});

test("limiter: one client stops at its own limit and leaves room for others", () => {
  const l = new LoginLimiter();
  const t0 = 1_000;
  const flood = Array.from({ length: 100 }, () => l.reserve("attacker", t0));
  assert.equal(flood.filter((r) => !r.limited).length, LOGIN_MAX_FAILURES);
  assert.equal(l.check("operator", t0).limited, false, "the operator can still log in");
  const operator = Array.from({ length: 20 }, () => l.reserve("operator", t0));
  assert.equal(operator.filter((r) => !r.limited).length, LOGIN_MAX_FAILURES, "and still gets its own 10");
});

test("limiter: blocked reservations do not count against the global cap", () => {
  const l = new LoginLimiter(2, 1000, 5);
  for (let i = 0; i < 50; i++) l.reserve("one", 0); // 2 admitted, 48 refused
  // 3 global slots remain, not 0: refused attempts were never recorded.
  assert.equal(l.reserve("a", 1).limited, false);
  assert.equal(l.reserve("b", 1).limited, false);
  assert.equal(l.reserve("c", 1).limited, false);
  assert.equal(l.reserve("d", 1).limited, true);
});

test("limiter: a successful login releases its global slot too", () => {
  const l = new LoginLimiter(10, 1000, 2);
  const a = l.reserve("a", 0);
  l.reserve("b", 0);
  assert.equal(l.reserve("c", 1).limited, true);
  a.release();
  a.release(); // idempotent: must not free a second slot
  assert.equal(l.reserve("c", 2).limited, false);
  assert.equal(l.reserve("d", 3).limited, true);
});

test("limiter: the stricter limit decides Retry-After", () => {
  const l = new LoginLimiter(2, 10_000, 3);
  l.reserve("a", 0);
  l.reserve("a", 1_000); // "a" is now at its own cap, oldest failure at t=0
  l.reserve("b", 6_000); // third global failure; the global oldest is also t=0
  const a = l.check("a", 6_000);
  assert.equal(a.limited, true);
  assert.equal(a.retryAfterSeconds, 4);
  // "c" is only blocked globally.
  assert.equal(l.check("c", 6_000).limited, true);
  assert.equal(l.check("c", 10_000).limited, false);
});

test("limiter: custom caps are honoured and reset() only forgets the client", () => {
  const l = new LoginLimiter(3, 1000, 4);
  for (let i = 0; i < 3; i++) l.reserve("a", 0);
  assert.equal(l.check("a", 1).limited, true);
  l.reset("a");
  assert.equal(l.check("a", 1).limited, false, "per-client count is gone");
  assert.equal(l.reserve("a", 1).limited, false);
  assert.equal(l.reserve("a", 1).limited, true, "but its earlier failures still count globally");
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

test("processLogin: the issued cookie verifies under the config and dies with a password change", async () => {
  const res = await processLogin(loginReq("pw", "8.8.8.8"), cfg, new LoginLimiter());
  assert.equal(res.status, 204);
  const token = /session=([^;]+)/.exec(res.headers.get("set-cookie"))[1];
  assert.equal(await verifySession(cfg, token), true);
  const changed = readAuthConfig({ DASHBOARD_PASSWORD: "pw2", DASHBOARD_SESSION_SECRET: SECRET });
  assert.equal(await verifySession(changed, token), false);
  const shorter = readAuthConfig({ DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET, DASHBOARD_SESSION_TTL_HOURS: "24" });
  assert.equal(await verifySession(shorter, token), false, "168 h token under a 24 h TTL");
});

test("processLogin: rotating a spoofed X-Forwarded-For hits the global cap, the right password is refused, and it recovers", async () => {
  const limiter = new LoginLimiter();
  let clock = 50_000_000;
  const now = () => clock;
  // No reverse proxy: the client controls the only X-Forwarded-For entry.
  const spoofed = (password, i) => ({
    url: "http://dash.test/api/auth/login",
    headers: new Headers({ "x-forwarded-for": `198.51.100.${i % 250}` }),
    json: async () => ({ password }),
  });
  const statuses = [];
  for (let i = 0; i < 40; i++) statuses.push((await processLogin(spoofed("bad", i), cfg, limiter, now)).status);
  assert.equal(statuses.filter((s) => s === 401).length, LOGIN_GLOBAL_MAX_FAILURES);
  assert.equal(statuses.filter((s) => s === 429).length, 40 - LOGIN_GLOBAL_MAX_FAILURES);

  // Even the correct password is refused while the global cap holds, with Retry-After.
  const blocked = await processLogin(spoofed("pw", 200), cfg, limiter, now);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  // The attacker stops; once the failures age out the operator can log in again.
  clock += LOGIN_WINDOW_MS;
  assert.equal((await processLogin(spoofed("pw", 201), cfg, limiter, now)).status, 204);
});

test("processLogin: a correct login never uses up the global budget", async () => {
  const limiter = new LoginLimiter();
  for (let i = 0; i < 100; i++) {
    const res = await processLogin(loginReq("pw", `192.0.2.${i}`), cfg, limiter);
    assert.equal(res.status, 204, `login ${i}`);
  }
  assert.equal(limiter.check("anyone").limited, false);
});
