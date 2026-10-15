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

test("login limiter blocks after 10 failures and releases after 15 minutes", () => {
  const l = new LoginLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) l.fail("1.1.1.1", t0 + i);
  assert.equal(l.check("1.1.1.1", t0 + 10).limited, false);
  l.fail("1.1.1.1", t0 + 9);
  const blocked = l.check("1.1.1.1", t0 + 1000);
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 900);
  assert.equal(l.check("2.2.2.2", t0 + 1000).limited, false, "other clients unaffected");
  assert.equal(l.check("1.1.1.1", t0 + 15 * 60 * 1000 + 10).limited, false);
});

test("login limiter: old failures age out and reset clears", () => {
  const l = new LoginLimiter(3, 1000);
  l.fail("a", 0);
  l.fail("a", 100);
  l.fail("a", 2000); // first two are outside the window now
  assert.equal(l.check("a", 2001).limited, false);
  l.fail("a", 2002);
  l.fail("a", 2003);
  assert.equal(l.check("a", 2004).limited, true);
  l.reset("a");
  assert.equal(l.check("a", 2005).limited, false);
});

test("clientKey: first x-forwarded-for hop, then x-real-ip, then unknown", () => {
  const h = (o) => new Headers(o);
  assert.equal(clientKey(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1", "x-real-ip": "8.8.8.8" })), "9.9.9.9");
  assert.equal(clientKey(h({ "x-real-ip": "8.8.8.8" })), "8.8.8.8");
  assert.equal(clientKey(h({ "x-forwarded-for": "  " , "x-real-ip": "8.8.8.8" })), "8.8.8.8");
  assert.equal(clientKey(h({})), "unknown");
});
