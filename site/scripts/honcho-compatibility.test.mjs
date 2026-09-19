import assert from "node:assert/strict";
import test from "node:test";
import { getSdk, invalidateSdk } from "../src/lib/honcho/sdk.ts";
import { toApiConclusion } from "../src/lib/honcho/adapters.ts";
import { honcho } from "../src/lib/honcho/client.ts";
import { HonchoApiError } from "../src/lib/honcho/types.ts";

// Response contracts from plastic-labs/honcho v3.1.0 and v3.2.0,
// src/schemas/api.py (Conclusion) and the peer/workspace chat routes.
const baseConclusion = {
  id: "conclusion-1",
  content: "Prefers morning meetings",
  observer_id: "user-1",
  observed_id: "user-1",
  session_id: null,
  level: "deductive",
  created_at: "2026-09-15T00:00:00Z",
};
const opts = { baseUrl: "http://honcho.test:8000", token: "synthetic-test-token" };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

for (const version of ["3.1.0", "3.2.0"]) {
  test(`dashboard SDK and raw client preserve Honcho ${version} contracts`, async (t) => {
    invalidateSdk();
    t.after(invalidateSdk);
    const conclusion = version === "3.2.0"
      ? { ...baseConclusion, source_ids: ["source-1", "source-2"], times_derived: 4 }
      : baseConclusion;
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      const path = new URL(String(url), "http://localhost").pathname.replace(/^\/api\/honcho/, "");
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ path, body, headers: new Headers(init.headers) });
      if (path === "/v3/workspaces") return json({ id: "workspace-1" });
      if (path === "/v3/workspaces/workspace-1/peers") return json({ id: "user-1", workspace_id: "workspace-1" });
      if (path.endsWith("/chat")) {
        // Fail if an SDK upgrade silently opts the existing UI into 3.2-only options.
        assert.equal(Object.hasOwn(body, "include_evidence"), false);
        return json({ content: "Morning is best" });
      }
      if (path.endsWith("/conclusions/query")) return json([conclusion]);
      if (path.endsWith("/conclusions/list")) {
        return json({ items: [conclusion], page: 1, size: 25, total: 1, pages: 1 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const sdk = getSdk(opts, "workspace-1");
    const peer = await sdk.peer("user-1");
    assert.equal(await peer.chat("When?", { reasoningLevel: "low" }), "Morning is best");
    assert.equal(await sdk.chat("When?", { reasoningLevel: "low" }), "Morning is best");
    const queried = (await peer.conclusions.query("meetings", 50)).map(toApiConclusion);
    assert.deepEqual(queried, [{
      ...conclusion,
      source_ids: conclusion.source_ids ?? null,
      times_derived: conclusion.times_derived ?? 1,
    }]);
    const listed = await honcho.conclusions.list(opts, "workspace-1", { size: 25 });
    assert.deepEqual(listed.items, [conclusion]);
    assert.ok(calls.every(({ headers }) => headers.get("X-Honcho-Base-Url") === opts.baseUrl));
    const sdkCalls = calls.filter(({ path }) => !path.endsWith("/conclusions/list"));
    assert.ok(sdkCalls.every(({ headers }) => headers.get("authorization") === `Bearer ${opts.token}`));
    assert.ok(sdkCalls.every(({ headers }) => headers.get("X-Honcho-Host")?.startsWith("honcho-typescript/2.5.0")));
    const query = calls.find(({ path }) => path.endsWith("/conclusions/query"));
    assert.deepEqual(query.body, {
      query: "meetings", top_k: 50,
      filters: { observer_id: "user-1", observed_id: "user-1" },
    });
  });
}

test("raw client retains restricted-key errors and Honcho 3.2 provider-unavailable details", async (t) => {
  for (const status of [403, 503]) {
    const detail = status === 403 ? "Workspace access required" : "LLM provider unavailable";
    const mock = t.mock.method(globalThis, "fetch", async () => json({ detail }, status));
    await assert.rejects(honcho.conclusions.query(opts, "workspace-1", { query: "meetings" }), (error) => {
      assert.ok(error instanceof HonchoApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, `HTTP ${status}: ${detail}`);
      return true;
    });
    mock.mock.restore();
  }
});

test("SDK chat surfaces Honcho 3.2 provider failures instead of returning an empty answer", async (t) => {
  invalidateSdk();
  t.after(invalidateSdk);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(String(url)).pathname === "/v3/workspaces") return json({ id: "workspace-1" });
    return json({ detail: "LLM provider unavailable" }, 503);
  });
  await assert.rejects(getSdk(opts, "workspace-1").chat("When?"), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /LLM provider unavailable/);
    return true;
  });
});
