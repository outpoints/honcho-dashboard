import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_DEFAULT_BASE_URL,
  advertisedBaseUrl,
  canonicalize,
  defaultBaseUrl,
  implicitAllowedBases,
  readRuntimeEnv,
  upgradeLegacySeed,
} from "../src/lib/honcho/defaultTarget.ts";

const RUNTIME = "http://honcho.synthetic.invalid:18100";
const PROXY = "http://proxy.synthetic.invalid:8000";
const BUILD = "http://build.synthetic.invalid:8000";

const seed = (baseUrl, extra = {}) => ({ id: "default", name: "local", baseUrl, ...extra });
const legacy = { baseUrl: LEGACY_DEFAULT_BASE_URL };

test("published image: the runtime NEXT_PUBLIC value beats the localhost build default", () => {
  const sources = { runtimePublicBaseUrl: RUNTIME, buildPublicBaseUrl: LEGACY_DEFAULT_BASE_URL };
  assert.equal(defaultBaseUrl(sources), RUNTIME);
  assert.equal(advertisedBaseUrl(sources), RUNTIME);
});

test("HONCHO_PROXY_BASE_URL keeps precedence over both NEXT_PUBLIC copies", () => {
  const sources = { proxyBaseUrl: PROXY, runtimePublicBaseUrl: RUNTIME, buildPublicBaseUrl: BUILD };
  assert.equal(defaultBaseUrl(sources), PROXY);
});

test("builds without a runtime value fall back to the build-time copy, as before", () => {
  assert.equal(defaultBaseUrl({ buildPublicBaseUrl: BUILD }), BUILD);
  assert.equal(defaultBaseUrl({ runtimePublicBaseUrl: "  ", buildPublicBaseUrl: BUILD }), BUILD);
  assert.equal(defaultBaseUrl({}), undefined);
  assert.equal(advertisedBaseUrl({}), null);
});

test("an empty HONCHO_PROXY_BASE_URL keeps its old meaning", () => {
  assert.equal(defaultBaseUrl({ proxyBaseUrl: "", buildPublicBaseUrl: BUILD }), "");
  assert.deepEqual(implicitAllowedBases({ proxyBaseUrl: "", buildPublicBaseUrl: BUILD }), []);
});

test("the implicit allowlist is a superset of every earlier release's", () => {
  const values = [undefined, "", PROXY, RUNTIME, BUILD, LEGACY_DEFAULT_BASE_URL];
  for (const proxyBaseUrl of values) {
    for (const runtimePublicBaseUrl of values) {
      for (const buildPublicBaseUrl of values) {
        const sources = { proxyBaseUrl, runtimePublicBaseUrl, buildPublicBaseUrl };
        const before = proxyBaseUrl ?? buildPublicBaseUrl;
        const after = implicitAllowedBases(sources);
        if (before) assert.ok(after.includes(before), JSON.stringify(sources));
        assert.equal(new Set(after).size, after.length, "no duplicates");
      }
    }
  }
});

test("the runtime NEXT_PUBLIC value is allowlisted without repeating it", () => {
  assert.deepEqual(
    implicitAllowedBases({ runtimePublicBaseUrl: RUNTIME, buildPublicBaseUrl: LEGACY_DEFAULT_BASE_URL }),
    [LEGACY_DEFAULT_BASE_URL, RUNTIME],
  );
});

test("runtime env reads use a computed key", () => {
  assert.equal(readRuntimeEnv({ NEXT_PUBLIC_HONCHO_BASE_URL: RUNTIME }, "NEXT_PUBLIC_HONCHO_BASE_URL"), RUNTIME);
});

test("browsers are only ever told a bare http(s) origin", () => {
  assert.equal(advertisedBaseUrl({ proxyBaseUrl: `${PROXY}/api/` }), PROXY);
  assert.equal(advertisedBaseUrl({ proxyBaseUrl: "http://user:pw@honcho.synthetic.invalid" }), null);
  assert.equal(advertisedBaseUrl({ proxyBaseUrl: "ftp://honcho.synthetic.invalid" }), null);
  assert.equal(advertisedBaseUrl({ proxyBaseUrl: "not a url" }), null);
  assert.equal(canonicalize("https://honcho.synthetic.invalid#x"), null);
});

test("an untouched legacy seed moves to the advertised default", () => {
  const other = { id: "inst_a", name: "prod", baseUrl: "https://prod.synthetic.invalid" };
  const next = upgradeLegacySeed([seed(LEGACY_DEFAULT_BASE_URL), other], legacy, RUNTIME);
  assert.deepEqual(next, [seed(RUNTIME), other]);
});

test("user-owned instances are never rewritten", () => {
  const cases = [
    [seed("http://localhost:8001")],
    [seed(LEGACY_DEFAULT_BASE_URL, { token: "user-token" })],
    [{ ...seed(LEGACY_DEFAULT_BASE_URL), name: "laptop" }],
    [{ ...seed(LEGACY_DEFAULT_BASE_URL), id: "inst_b" }],
    [],
  ];
  for (const instances of cases) {
    assert.equal(upgradeLegacySeed(instances, legacy, RUNTIME), null, JSON.stringify(instances));
  }
});

test("nothing changes without a different advertised default", () => {
  const instances = [seed(LEGACY_DEFAULT_BASE_URL)];
  assert.equal(upgradeLegacySeed(instances, legacy, null), null);
  assert.equal(upgradeLegacySeed(instances, legacy, LEGACY_DEFAULT_BASE_URL), null);
});

test("a seed carrying the build-time token still counts as untouched", () => {
  const withToken = { baseUrl: LEGACY_DEFAULT_BASE_URL, token: "build-token" };
  assert.deepEqual(
    upgradeLegacySeed([seed(LEGACY_DEFAULT_BASE_URL, { token: "build-token" })], withToken, RUNTIME),
    [seed(RUNTIME, { token: "build-token" })],
  );
  assert.equal(upgradeLegacySeed([seed(LEGACY_DEFAULT_BASE_URL)], withToken, RUNTIME), null);
});

test("source-built images whose seed already matches are left alone", () => {
  assert.equal(upgradeLegacySeed([seed(BUILD)], { baseUrl: BUILD }, BUILD), null);
});
