// End-to-end regression test: large request bodies must reach Honcho intact.
//
// Next.js buffers only the first 10 MB of a request body for any path the
// `src/proxy.ts` matcher covers (`experimental.proxyClientMaxBodySize`) and
// truncates silently. SDK uploads enter through `/v3/*` (rewritten to
// `/api/honcho/v3/*`), so both entry paths must stay out of the matcher.
//
// This starts a real `next dev` server against a stub upstream, once with
// DASHBOARD_PASSWORD unset and once with it set, and posts a 12.6 MB body.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = resolve(SITE_DIR, "node_modules/next/dist/bin/next");
const UPLOAD_BYTES = 12_600_000;
const PASSWORD = "upload-test-password";
const SECRET = "s".repeat(48);
const UPLOAD_PATH = "/workspaces/w1/sessions/s1/messages/upload";
const SERVER_START_TIMEOUT_MS = 120_000;
// `next dev` by default; UPLOAD_TEST_COMMAND=start runs the production server
// against an existing `npm run build` instead.
const NEXT_COMMAND = process.env.UPLOAD_TEST_COMMAND === "start" ? "start" : "dev";

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

/** Run `fn` against a fresh stub upstream and dashboard, stopping both afterwards. */
async function withDashboard(env, fn) {
  const upstream = await startUpstream();
  let dash;
  try {
    dash = await startDashboard(env, upstream.port);
    await fn(upstream, dash);
  } finally {
    await dash?.stop();
    upstream.server.closeAllConnections();
    await new Promise((r) => upstream.server.close(r));
  }
}

describe("12.6 MB upload reaches the upstream byte-complete", () => {
  test("auth off", { timeout: 240_000 }, () =>
    withDashboard({ DASHBOARD_PASSWORD: "", DASHBOARD_SESSION_SECRET: "" }, async (upstream, dash) => {
    for (const [label, path] of ENTRY_PATHS) {
      upstream.received.length = 0;
      const res = await upload(dash.base, path);
      assert.equal(res.status, 200, `${label}: status`);
      assert.equal(upstream.received.length, 1, `${label}: one upstream call`);
      assert.equal(upstream.received[0].bytes, UPLOAD_BYTES, `${label}: upstream byte count`);
      assert.equal(upstream.received[0].sha256, bodyHash, `${label}: upstream body hash`);
    }
    assert.doesNotMatch(dash.log(), /exceeded/i, "Next logged a body-size truncation warning");
    }),
  );

  test("auth on: authenticated upload is byte-complete, anonymous upload is refused", { timeout: 240_000 }, () =>
    withDashboard({ DASHBOARD_PASSWORD: PASSWORD, DASHBOARD_SESSION_SECRET: SECRET }, async (upstream, dash) => {
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
    // Other casings of the passthroughs must not skip the guard either.
    for (const path of ["/V3/workspaces/list", "/HEALTH", "/OpenAPI.json", "/API/honcho/v3/workspaces/list", "/Api/Honcho/v3/x"]) {
      upstream.received.length = 0;
      const res = await fetch(`${dash.base}${path}`, { method: path.includes("list") ? "POST" : "GET" });
      assert.notEqual(res.status, 200, `${path}: anonymous request must not succeed`);
      assert.equal(upstream.received.length, 0, `${path}: anonymous request must not reach upstream`);
    }
    assert.doesNotMatch(dash.log(), /exceeded/i, "Next logged a body-size truncation warning");
    }),
  );
});
