// Every API route handler must call requireSession(), so that a route added
// later cannot ship unguarded. proxy.ts is not enough on its own: it does not
// see /api/honcho or /v3 (large bodies), and it is only a first layer. The
// only routes that may skip it are /api/auth/* (login must work without a
// session) and /api/healthz (container health check).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src/app/api");
const UNGUARDED = ["auth/", "healthz/"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function routeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

const rel = (file) => relative(API_DIR, file).split("\\").join("/");
const guarded = routeFiles(API_DIR).filter((f) => !UNGUARDED.some((p) => rel(f).startsWith(p)));

/** Names exported as HTTP handlers, mapped to the function that implements them. */
function handlers(src) {
  const out = new Map();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)\b/g)) {
    if (METHODS.includes(m[1])) out.set(m[1], m[1]);
  }
  for (const m of src.matchAll(/export\s+const\s+([A-Z]+)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    if (METHODS.includes(m[1])) out.set(m[1], m[2]);
  }
  for (const m of src.matchAll(/export\s+const\s+([A-Z]+)\s*=\s*(?:async\s*)?\(/g)) {
    if (METHODS.includes(m[1])) out.set(m[1], m[1]);
  }
  return out;
}

/** Source of `function name` / `const name = ...` up to the next top-level declaration. */
function bodyOf(src, name) {
  const start = src.search(new RegExp(`(?:function\\s+${name}\\b|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\()`));
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export\s+)?(?:async\s+)?(?:function|const)\s/);
  return next < 0 ? rest : rest.slice(0, next);
}

test("the route scan finds the routes it is supposed to guard", () => {
  const found = guarded.map(rel);
  assert.ok(found.includes("honcho/[...path]/route.ts"), found.join(", "));
  assert.ok(found.includes("operator/db/route.ts"), found.join(", "));
  assert.ok(found.length >= 7, `expected at least 7 guarded routes, got ${found.length}`);
  assert.ok(!found.some((f) => f.startsWith("auth/") || f.startsWith("healthz/")));
});

test("every API route handler calls requireSession()", () => {
  const failures = [];
  for (const file of guarded) {
    const src = readFileSync(file, "utf8");
    const exported = handlers(src);
    if (exported.size === 0) {
      failures.push(`${rel(file)}: exports no recognisable HTTP handler`);
      continue;
    }
    for (const [method, fn] of exported) {
      if (!/\bawait\s+requireSession\(/.test(bodyOf(src, fn))) {
        failures.push(`${rel(file)}: ${method} does not await requireSession()`);
      }
    }
  }
  assert.deepEqual(failures, [], "guard every route with requireSession() (src/lib/auth/server.ts), then return its response when non-null");
});

test("the guard is checked before the handler does any work", () => {
  for (const file of guarded) {
    const src = readFileSync(file, "utf8");
    for (const [, fn] of handlers(src)) {
      const body = bodyOf(src, fn);
      const guard = body.indexOf("requireSession(");
      const before = body.slice(0, Math.max(guard, 0)).replace(/\bawait\s+$/, "");
      assert.ok(guard >= 0 && !/\bawait\b/.test(before), `${rel(file)}: ${fn} awaits something before requireSession()`);
    }
  }
});
