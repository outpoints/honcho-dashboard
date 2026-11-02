import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, resolveRequestToken } from "../src/lib/honcho/defaultTarget.ts";
import { getSdk, invalidateSdk, sdkDefaultHeaders } from "../src/lib/honcho/sdk.ts";

const BASE = "http://honcho.synthetic.invalid:18100/";
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

/** Make one SDK call through `getSdk` and return the headers it sent. */
async function sentHeaders(t, opts) {
  invalidateSdk();
  const seen = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    seen.push(new Headers(init.headers));
    return json({ id: "ws", metadata: {}, configuration: {} });
  });
  await getSdk(opts, "ws").getMetadata();
  assert.ok(seen.length > 0, "the SDK made no request");
  return seen;
}

test("a saved token is sent as X-Honcho-Token on every SDK call, next to the base URL", async (t) => {
  const seen = await sentHeaders(t, { baseUrl: BASE, token: "browser-token" });
  for (const headers of seen) {
    assert.equal(headers.get("x-honcho-token"), "browser-token");
    assert.equal(headers.get("x-honcho-base-url"), "http://honcho.synthetic.invalid:18100");
  }
});

test("a saved token still travels as Authorization, as before", async (t) => {
  const [headers] = await sentHeaders(t, { baseUrl: BASE, token: "browser-token" });
  assert.equal(headers.get("authorization"), "Bearer browser-token");
});

test("without a token no X-Honcho-Token is sent, so the server token can apply", async (t) => {
  for (const token of [undefined, ""]) {
    const seen = await sentHeaders(t, { baseUrl: BASE, token });
    for (const headers of seen) {
      assert.equal(headers.has("x-honcho-token"), false, `token=${JSON.stringify(token)}`);
      assert.equal(headers.get("x-honcho-base-url"), "http://honcho.synthetic.invalid:18100");
    }
    t.mock.restoreAll();
  }
});

test("without a token the SDK keeps its placeholder apiKey so it still sends requests", async (t) => {
  const [headers] = await sentHeaders(t, { baseUrl: BASE });
  assert.equal(headers.get("authorization"), "Bearer unused-token-please-server-ignore");
});

test("through the proxy's token rule: a saved token beats HONCHO_PROXY_TOKEN, no token gets the server's", async (t) => {
  const origin = canonicalize(BASE);
  const sources = { proxyBaseUrl: BASE };
  const resolve = (headers) => resolveRequestToken(headers.get("x-honcho-token"), origin, sources, "server-token");

  const [withToken] = await sentHeaders(t, { baseUrl: BASE, token: "restricted-token" });
  assert.equal(resolve(withToken), "restricted-token");
  t.mock.restoreAll();

  const [withoutToken] = await sentHeaders(t, { baseUrl: BASE });
  assert.equal(resolve(withoutToken), "server-token");
});

test("instances are cached per base URL and token, so a changed token is not served a stale client", () => {
  invalidateSdk();
  const a = getSdk({ baseUrl: BASE, token: "one" }, "ws");
  assert.equal(getSdk({ baseUrl: BASE, token: "one" }, "ws"), a);
  assert.notEqual(getSdk({ baseUrl: BASE, token: "two" }, "ws"), a);
  assert.notEqual(getSdk({ baseUrl: BASE }, "ws"), a);
});

test("sdkDefaultHeaders strips trailing slashes and omits the token header when unset", () => {
  assert.deepEqual(sdkDefaultHeaders({ baseUrl: "http://h.invalid:1///" }), { "X-Honcho-Base-Url": "http://h.invalid:1" });
  assert.deepEqual(sdkDefaultHeaders({ baseUrl: "http://h.invalid:1", token: "t" }), {
    "X-Honcho-Base-Url": "http://h.invalid:1",
    "X-Honcho-Token": "t",
  });
});
