import assert from "node:assert/strict";
import test from "node:test";

import { HOP_BY_HOP, filterResponseHeaders } from "../src/lib/honcho/proxy-headers.ts";

test("drops content-encoding, content-length, transfer-encoding and set-cookie", () => {
  const out = filterResponseHeaders(
    new Headers({
      "content-encoding": "gzip",
      "content-length": "1234",
      "transfer-encoding": "chunked",
      "set-cookie": "a=b; Path=/",
      "content-type": "application/json",
    }),
  );
  assert.equal(out.has("content-encoding"), false);
  assert.equal(out.has("content-length"), false);
  assert.equal(out.has("transfer-encoding"), false);
  assert.equal(out.has("set-cookie"), false);
  assert.equal(out.get("content-type"), "application/json");
});

test("matching is case-insensitive", () => {
  const raw = new Headers();
  raw.append("Content-Encoding", "br");
  raw.append("Content-Length", "9");
  assert.equal([...filterResponseHeaders(raw)].length, 0);
});

test("drops upstream access-control-* headers", () => {
  const out = filterResponseHeaders(
    new Headers({
      "access-control-allow-origin": "*",
      "access-control-allow-credentials": "true",
      "x-request-id": "abc",
    }),
  );
  assert.equal([...out.keys()].some((k) => k.startsWith("access-control-")), false);
  assert.equal(out.get("x-request-id"), "abc");
});

test("keeps unrelated headers and does not mutate the input", () => {
  const input = new Headers({
    "content-type": "text/plain",
    etag: '"x"',
    "content-encoding": "gzip",
  });
  const out = filterResponseHeaders(input);
  assert.equal(out.get("etag"), '"x"');
  assert.equal(input.get("content-encoding"), "gzip");
  assert.notEqual(out, input);
});

test("empty headers yield empty headers", () => {
  assert.equal([...filterResponseHeaders(new Headers())].length, 0);
});

test("HOP_BY_HOP includes content-encoding", () => {
  assert.ok(HOP_BY_HOP.has("content-encoding"));
});
