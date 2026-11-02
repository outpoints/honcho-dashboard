import assert from "node:assert/strict";
import test from "node:test";
import { requireSession, rejectCrossSiteWrite } from "../src/lib/auth/server.ts";
import { signSession } from "../src/lib/auth/session.ts";

const SECRET = "k".repeat(48);
const PASSWORD = "pw";
const NOW = Date.now();

/** Run `fn` with the given dashboard auth env and restore the previous values. */
async function withEnv(env, fn) {
  const keys = ["DASHBOARD_PASSWORD", "DASHBOARD_SESSION_SECRET", "DASHBOARD_SESSION_TTL_HOURS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const errors = test.mock.method(console, "error", () => undefined);
  try {
    return await fn();
  } finally {
    errors.mock.restore();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete globalThis.__honchoDashboardAuthConfigErrorLogged;
  }
}

const ON = { DASHBOARD_PASSWORD: PASSWORD, DASHBOARD_SESSION_SECRET: SECRET };
const req = (method, headers = {}) => ({ method, headers: new Headers(headers) });
const sessionCookie = async () => `honcho_dashboard_session=${await signSession(SECRET, 3600, NOW)}`;

test("requireSession: auth off lets everything through, cross-site writes included", async () => {
  await withEnv({}, async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(await requireSession(req(method)), null, method);
      assert.equal(
        await requireSession(req(method, { "sec-fetch-site": "cross-site", origin: "https://evil.test", host: "dash.test" })),
        null,
        `${method} cross-site`,
      );
    }
  });
  await withEnv({ DASHBOARD_PASSWORD: "", DASHBOARD_SESSION_SECRET: SECRET }, async () => {
    assert.equal(await requireSession(req("POST", { "sec-fetch-site": "cross-site" })), null);
  });
});

test("requireSession: valid session passes for safe and same-origin unsafe requests", async () => {
  await withEnv(ON, async () => {
    const cookie = await sessionCookie();
    assert.equal(await requireSession(req("GET", { cookie })), null);
    assert.equal(await requireSession(req("GET", { cookie, "sec-fetch-site": "cross-site" })), null, "reads are not CSRF-checked");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(await requireSession(req(method, { cookie, "sec-fetch-site": "same-origin" })), null, method);
      assert.equal(await requireSession(req(method, { cookie, origin: "http://dash.test", host: "dash.test" })), null, method);
      assert.equal(await requireSession(req(method, { cookie })), null, `${method} without browser headers`);
    }
  });
});

test("requireSession: cross-site writes get 403, even with a valid session", async () => {
  await withEnv(ON, async () => {
    const cookie = await sessionCookie();
    const crossSite = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "https://evil.test", host: "dash.test" },
      { origin: "null", host: "dash.test" },
    ];
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const extra of crossSite) {
        for (const withCookie of [true, false]) {
          const res = await requireSession(req(method, { ...extra, ...(withCookie ? { cookie } : {}) }));
          assert.equal(res?.status, 403, `${method} ${JSON.stringify(extra)} cookie=${withCookie}`);
          assert.equal(res.headers.get("x-dashboard-auth"), null, "a 403 must not send the visitor to the login screen");
          assert.deepEqual(await res.json(), { error: "cross-site request rejected" });
        }
      }
    }
  });
});

test("requireSession: no or bad session gets 401 with the guard marker", async () => {
  await withEnv(ON, async () => {
    for (const headers of [{}, { cookie: "honcho_dashboard_session=garbage" }, { cookie: "other=1" }]) {
      const res = await requireSession(req("GET", headers));
      assert.equal(res?.status, 401);
      assert.equal(res.headers.get("x-dashboard-auth"), "required");
    }
    assert.equal((await requireSession(req("POST", { "sec-fetch-site": "same-origin" })))?.status, 401);
  });
});

test("requireSession: misconfigured auth fails closed with 500", async () => {
  await withEnv({ DASHBOARD_PASSWORD: PASSWORD }, async () => {
    const res = await requireSession(req("GET"));
    assert.equal(res?.status, 500);
    assert.match((await res.json()).error, /DASHBOARD_SESSION_SECRET must be set/);
    assert.equal((await requireSession(req("POST", { "sec-fetch-site": "cross-site" })))?.status, 403);
  });
});

test("rejectCrossSiteWrite does not look at auth config or cookies", () => {
  assert.equal(rejectCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site" }))?.status, 403);
  assert.equal(rejectCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin" })), null);
  assert.equal(rejectCrossSiteWrite(req("GET", { "sec-fetch-site": "cross-site" })), null);
});
