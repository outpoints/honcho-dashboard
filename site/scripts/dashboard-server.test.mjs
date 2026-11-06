// End-to-end tests against a real Next.js server and a stub Honcho upstream.
//
// 1. Large bodies. Next.js buffers only the first 10 MB of a request body for any
//    path the `src/proxy.ts` matcher covers (`experimental.proxyClientMaxBodySize`)
//    and truncates silently. SDK uploads enter through `/v3/*` (rewritten to
//    `/api/honcho/v3/*`), so both entry paths must stay out of the matcher: a
//    12.6 MB upload must reach the upstream byte-complete, with a password set
//    and without.
// 2. The auth gate. With no DASHBOARD_PASSWORD the page renders the app straight
//    away and never waits on /api/auth/status.
//
// One `next dev` server per auth mode, run one after the other: `next dev` locks
// the project directory, so two cannot run at once (and `npm test` runs test
// files in parallel, which is why everything that starts a server lives here).
// Set UPLOAD_TEST_COMMAND=start to run `next start` against an existing
// `npm run build` instead.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { initialAuthStatus } from "../src/lib/auth/gate.ts";

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = resolve(SITE_DIR, "node_modules/next/dist/bin/next");
const SERVER_START_TIMEOUT_MS = 120_000;
const NEXT_COMMAND = process.env.UPLOAD_TEST_COMMAND === "start" ? "start" : "dev";
const UPLOAD_BYTES = 12_600_000;
const PASSWORD = "e2e-test-password";
const SECRET = "s".repeat(48);
const UPLOAD_PATH = "/workspaces/w1/sessions/s1/messages/upload";
const WAITING = "checking session";

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

/** Stub Honcho: records the size and hash of every request body it receives. */
async function startUpstream() {
  const received = [];
  const server = createServer((req, res) => {
    const hash = createHash("sha256");
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    req.on("end", () => {
      received.push({ url: req.url, bytes, sha256: hash.digest("hex") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, received, port: server.address().port };
}

async function startDashboard(env, upstreamPort) {
  const port = await freePort();
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_ENV; // `next dev`/`next start` set it
  childEnv.NEXT_TELEMETRY_DISABLED = "1";
  childEnv.HONCHO_PROXY_BASE_URL = `http://127.0.0.1:${upstreamPort}`;
  const child = spawn(process.execPath, [NEXT_BIN, NEXT_COMMAND, "-p", String(port)], {
    cwd: SITE_DIR,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  let exited = false;
  child.once("exit", () => (exited = true));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  for (;;) {
    if (exited) throw new Error(`next dev exited early:\n${log}`);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`next dev did not start in time:\n${log}`);
    }
    try {
      const res = await fetch(`${base}/api/healthz`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    base,
    log: () => log,
    stop: () =>
      new Promise((r) => {
        if (exited) return r();
        child.once("exit", () => r());
        child.kill();
      }),
  };
}

const body = randomBytes(UPLOAD_BYTES);
const bodyHash = createHash("sha256").update(body).digest("hex");

async function upload(base, path, headers = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...headers },
    body,
  });
}

const ENTRY_PATHS = [
  ["/api/honcho entry", `/api/honcho/v3${UPLOAD_PATH}`],
  ["/v3 SDK entry", `/v3${UPLOAD_PATH}`],
  // Next rewrites case-insensitively, so this reaches the same handler.
  ["mixed-case /V3 entry", `/V3${UPLOAD_PATH}`],
];

/** Start a stub upstream and a dashboard for the enclosing describe block. */
function useDashboard(env) {
  const ctx = {};
  before(async () => {
    ctx.upstream = await startUpstream();
    ctx.dash = await startDashboard(env, ctx.upstream.port);
  }, { timeout: SERVER_START_TIMEOUT_MS + 10_000 });
  after(async () => {
    await ctx.dash?.stop();
    if (ctx.upstream) {
      ctx.upstream.server.closeAllConnections();
      await new Promise((r) => ctx.upstream.server.close(r));
    }
  });
  return ctx;
}

test("initialAuthStatus: no password means no question for the server", () => {
  assert.deepEqual(initialAuthStatus(false), { enabled: false, authenticated: true });
  assert.equal(initialAuthStatus(true), null);
});

describe("auth off", () => {
  const ctx = useDashboard({ DASHBOARD_PASSWORD: "", DASHBOARD_SESSION_SECRET: "" });

  test("a 12.6 MB upload reaches the upstream byte-complete on every entry path", { timeout: 120_000 }, async () => {
    const { upstream, dash } = ctx;
    for (const [label, path] of ENTRY_PATHS) {
      upstream.received.length = 0;
      const res = await upload(dash.base, path);
      assert.equal(res.status, 200, `${label}: status`);
      assert.equal(upstream.received.length, 1, `${label}: one upstream call`);
      assert.equal(upstream.received[0].bytes, UPLOAD_BYTES, `${label}: upstream byte count`);
      assert.equal(upstream.received[0].sha256, bodyHash, `${label}: upstream body hash`);
    }
    assert.doesNotMatch(dash.log(), /exceeded/i, "Next logged a body-size truncation warning");
  });

  test("the page renders the app straight away, with no waiting state", async () => {
    const html = await (await fetch(`${ctx.dash.base}/`)).text();
    assert.doesNotMatch(html, new RegExp(WAITING), "must not show the session-check screen");
    assert.doesNotMatch(html, /AUTH_ERROR/);
    assert.match(html, /<main[ >]/, "the app shell is in the first response");
    // The route still answers truthfully for anyone who asks.
    const status = await (await fetch(`${ctx.dash.base}/api/auth/status`)).json();
    assert.deepEqual(status, { enabled: false, authenticated: true });
  });
});

describe("auth on", () => {
  const ctx = useDashboard({ DASHBOARD_PASSWORD: PASSWORD, DASHBOARD_SESSION_SECRET: SECRET });

  test("authenticated 12.6 MB uploads are byte-complete, anonymous ones are refused", { timeout: 120_000 }, async () => {
    const { upstream, dash } = ctx;
    const login = await fetch(`${dash.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(login.status, 204);
    const cookie = login.headers.get("set-cookie").split(";")[0];

    for (const [label, path] of ENTRY_PATHS) {
      upstream.received.length = 0;
      const res = await upload(dash.base, path, { cookie });
      assert.equal(res.status, 200, `${label}: status`);
      assert.equal(upstream.received.length, 1, `${label}: one upstream call`);
      assert.equal(upstream.received[0].bytes, UPLOAD_BYTES, `${label}: upstream byte count`);
      assert.equal(upstream.received[0].sha256, bodyHash, `${label}: upstream body hash`);

      // Same path without a session: refused, and nothing reaches the upstream.
      upstream.received.length = 0;
      const anon = await upload(dash.base, path);
      assert.equal(anon.status, 401, `${label}: anonymous status`);
      assert.equal(anon.headers.get("x-dashboard-auth"), "required", `${label}: guard marker`);
      assert.equal(upstream.received.length, 0, `${label}: anonymous request must not reach upstream`);
    }
    assert.doesNotMatch(dash.log(), /exceeded/i, "Next logged a body-size truncation warning");
  });

  test("a cross-site write to the Honcho proxy is refused by the route handler", async () => {
    const { upstream, dash } = ctx;
    const login = await fetch(`${dash.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    for (const path of [`/api/honcho/v3/workspaces/list`, `/v3/workspaces/list`, `/V3/workspaces/list`]) {
      upstream.received.length = 0;
      const res = await fetch(`${dash.base}${path}`, {
        method: "POST",
        headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 403, path);
      assert.equal(upstream.received.length, 0, `${path}: must not reach upstream`);
    }
  });

  test("login behind a Host-rewriting proxy: the dashboard's own header passes, a bare mismatching Origin needs X-Forwarded-Host", async () => {
    // Same shape as plain HTTP behind an nginx that rewrites Host and sends no
    // X-Forwarded-Host: Origin is the public name, Host is the upstream address.
    const attempt = (extra) =>
      fetch(`${ctx.dash.base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://dash.example", ...extra },
        body: JSON.stringify({ password: PASSWORD }),
      });
    assert.equal((await attempt({})).status, 403, "no dashboard header");
    assert.equal((await attempt({ "x-forwarded-host": "dash.example" })).status, 204);
    assert.equal((await attempt({ "x-honcho-dashboard": "1" })).status, 204, "what the login form sends");
  });

  test("other casings of the passthroughs do not skip the guard", async () => {
    const { upstream, dash } = ctx;
    for (const path of ["/V3/workspaces/list", "/HEALTH", "/OpenAPI.json", "/API/honcho/v3/workspaces/list", "/Api/Honcho/v3/x"]) {
      upstream.received.length = 0;
      const res = await fetch(`${dash.base}${path}`, { method: path.includes("list") ? "POST" : "GET" });
      assert.notEqual(res.status, 200, `${path}: anonymous request must not succeed`);
      assert.equal(upstream.received.length, 0, `${path}: anonymous request must not reach upstream`);
    }
  });

  test("the page starts at the session check and never renders the app unauthenticated", async () => {
    const html = await (await fetch(`${ctx.dash.base}/`)).text();
    assert.match(html, new RegExp(WAITING));
    assert.doesNotMatch(html, /<main[ >]/, "no app content before login");
    assert.doesNotMatch(html, /AUTH_ERROR/);
    const status = await (await fetch(`${ctx.dash.base}/api/auth/status`)).json();
    assert.deepEqual(status, { enabled: true, authenticated: false });
  });
});
