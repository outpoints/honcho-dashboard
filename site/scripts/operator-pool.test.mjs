import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  READ_ONLY_FALLBACK_WARNING,
  READ_ONLY_PG_OPTION,
  isUnsupportedStartupParameter,
  normalizeDsn,
  operatorPoolTarget,
  withReadOnlyFallback,
  withReadOnlyOption,
} from "../src/lib/operator/pool.ts";

/** What pg would actually send as the startup `options`, parsed by pg itself. */
function effective(dsn, writes) {
  const target = operatorPoolTarget(dsn, writes);
  const params = new pg.Client({ ...target }).connectionParameters;
  return { target, params };
}

const RO = READ_ONLY_PG_OPTION;

test("writes on: the DSN is used as given, with no read-only option", () => {
  const { target, params } = effective("postgresql://u:p@db:5432/honcho", true);
  assert.deepEqual(target, { connectionString: "postgresql://u:p@db:5432/honcho" });
  assert.equal(params.options, undefined);
});

test("writes on: the psycopg prefix is still normalized and DSN options are kept untouched", () => {
  const dsn = "postgresql+psycopg://u:p@db/honcho?options=-c%20statement_timeout%3D5s";
  const { target, params } = effective(dsn, true);
  assert.equal(target.connectionString, "postgresql://u:p@db/honcho?options=-c%20statement_timeout%3D5s");
  assert.equal(params.options, "-c statement_timeout=5s");
});

test("writes off: pg sends default_transaction_read_only=on", () => {
  const { params } = effective("postgresql://u:p@db:5432/honcho", false);
  assert.equal(params.options, RO);
  assert.equal(params.host, "db");
  assert.equal(params.port, 5432);
  assert.equal(params.database, "honcho");
  assert.equal(params.user, "u");
  assert.equal(params.password, "p");
});

test("writes off: psycopg-style DSN gets the option too", () => {
  const { target, params } = effective("postgresql+psycopg://u:p@db:5432/honcho", false);
  assert.ok(target.connectionString.startsWith("postgresql://"));
  assert.equal(params.options, RO);
});

test("writes off: an existing DSN options value is merged, not clobbered", () => {
  const { params } = effective(
    "postgresql://u:p@db/honcho?options=-c%20statement_timeout%3D5s%20-c%20search_path%3Dpublic",
    false,
  );
  assert.equal(params.options, `-c statement_timeout=5s -c search_path=public ${RO}`);
});

test("writes off: our setting comes last so a DSN that turns it off cannot win", () => {
  const { params } = effective(
    "postgresql://u:p@db/honcho?options=-c%20default_transaction_read_only%3Doff",
    false,
  );
  assert.equal(params.options, `-c default_transaction_read_only=off ${RO}`);
});

test("writes off: already read-only options are not duplicated", () => {
  const dsn = `postgresql://u:p@db/honcho?options=${encodeURIComponent(RO)}`;
  assert.equal(effective(dsn, false).params.options, RO);
  assert.equal(
    effective(`postgresql://u:p@db/honcho?options=${encodeURIComponent("-c a=b " + RO)}`, false).params.options,
    `-c a=b ${RO}`,
  );
  // Idempotent when fed its own output.
  const once = operatorPoolTarget("postgresql://u:p@db/honcho", false).connectionString;
  assert.equal(effective(once, false).params.options, RO);
});

test("writes off: other DSN parameters, credentials and special characters survive", () => {
  const dsn = "postgresql://us%40er:p%2Fss%3Aw%23rd@db.example:6543/my%20db?sslmode=verify-full&application_name=honcho%20dash";
  const { params } = effective(dsn, false);
  assert.equal(params.options, RO);
  assert.equal(params.user, "us@er");
  assert.equal(params.password, "p/ss:w#rd");
  assert.equal(params.host, "db.example");
  assert.equal(params.port, 6543);
  assert.equal(params.database, "my db");
  assert.ok(params.ssl);
  assert.equal(params.application_name, "honcho dash");
});

test("writes off: IPv6 hosts and socket-style DSNs keep working", () => {
  const v6 = effective("postgresql://u:p@[::1]:5432/honcho", false).params;
  assert.equal(v6.options, RO);
  assert.equal(v6.port, 5432);

  const sock = effective("postgresql:///honcho?host=/var/run/postgresql", false).params;
  assert.equal(sock.options, RO);
  assert.equal(sock.host, "/var/run/postgresql");
  assert.equal(sock.database, "honcho");

  // Credentials with an empty host only parse with pg's placeholder-host trick.
  const sockCreds = effective("postgresql://u:p@/honcho?host=/var/run/postgresql", false);
  assert.ok(!sockCreds.target.connectionString.includes("___DUMMY___"));
  assert.equal(sockCreds.params.options, RO);
  assert.equal(sockCreds.params.host, "/var/run/postgresql");
  assert.equal(sockCreds.params.user, "u");
});

test("writes off: a non-URL socket DSN falls back to config options", () => {
  const { target, params } = effective("/var/run/postgresql honcho", false);
  assert.deepEqual(target, { connectionString: "/var/run/postgresql honcho", options: RO });
  assert.equal(params.options, RO);
  assert.equal(params.host, "/var/run/postgresql");
});

test("withReadOnlyOption handles empty and padded values", () => {
  assert.equal(withReadOnlyOption(undefined), RO);
  assert.equal(withReadOnlyOption(null), RO);
  assert.equal(withReadOnlyOption(""), RO);
  assert.equal(withReadOnlyOption("   "), RO);
  assert.equal(withReadOnlyOption("  -c a=b  "), `-c a=b ${RO}`);
});

test("normalizeDsn only rewrites the psycopg scheme prefix", () => {
  assert.equal(normalizeDsn("postgresql+psycopg://u@h/d"), "postgresql://u@h/d");
  assert.equal(normalizeDsn("postgres://u@h/d"), "postgres://u@h/d");
  assert.equal(normalizeDsn("postgresql://u@h/d?x=postgresql+psycopg://"), "postgresql://u@h/d?x=postgresql+psycopg://");
});

// ---- Poolers that refuse the startup option (PgBouncer before 1.26) ----

/** The exact errors pg surfaces from PgBouncer, captured against real images. */
const PGB_118 = Object.assign(new Error("unsupported startup parameter: options"), { code: "08P01" });
const PGB_122 = Object.assign(
  new Error("unsupported startup parameter in options: default_transaction_read_only"),
  { code: "08P01" },
);

test("isUnsupportedStartupParameter matches both PgBouncer messages and nothing else", () => {
  assert.equal(isUnsupportedStartupParameter(PGB_118), true);
  assert.equal(isUnsupportedStartupParameter(PGB_122), true);
  assert.equal(isUnsupportedStartupParameter({ message: "Unsupported Startup Parameter in options: x" }), true);
  assert.equal(isUnsupportedStartupParameter(Object.assign(new Error("protocol violation"), { code: "08P01" })), false);
  assert.equal(isUnsupportedStartupParameter(Object.assign(new Error("unknown startup option in options"), { code: "08P01" })), true, "08P01 plus a startup-option message, other wording");
  assert.equal(isUnsupportedStartupParameter(Object.assign(new Error("unknown startup option in options"), { code: "42601" })), false, "not the protocol SQLSTATE");
  assert.equal(isUnsupportedStartupParameter(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), false);
  assert.equal(isUnsupportedStartupParameter(new Error("password authentication failed for user")), false);
  assert.equal(isUnsupportedStartupParameter(null), false);
  assert.equal(isUnsupportedStartupParameter("unsupported startup parameter: options"), false);
});

/** A fake pool: `fail` makes every query reject with that error. */
function fakePool(name, fail) {
  const pool = {
    name,
    calls: [],
    ended: 0,
    async query(text, values) {
      pool.calls.push([text, values]);
      if (fail) throw fail;
      return { rows: [{ from: name, text }], rowCount: 1 };
    },
    async end() {
      pool.ended += 1;
    },
  };
  return pool;
}

test("withReadOnlyFallback: a refused startup option swaps to the plain pool once and retries the query", async () => {
  const ro = fakePool("ro", PGB_122);
  const plain = fakePool("plain");
  let opened = 0;
  const warnings = [];
  const pool = withReadOnlyFallback(ro, () => (opened += 1, plain), (m) => warnings.push(m));

  assert.equal(pool.fellBack, false);
  const first = await pool.query("select 1", [1]);
  assert.equal(first.rows[0].from, "plain");
  assert.equal(pool.fellBack, true);
  assert.equal(opened, 1);
  assert.deepEqual(warnings, [READ_ONLY_FALLBACK_WARNING]);
  assert.match(READ_ONLY_FALLBACK_WARNING, /PgBouncer before 1\.26/);
  assert.match(READ_ONLY_FALLBACK_WARNING, /track_extra_parameters/);
  assert.equal(ro.ended, 1, "the refused pool is closed");
  assert.deepEqual(plain.calls, [["select 1", [1]]], "the failed query is retried once, with its values");

  const second = await pool.query("select 2");
  assert.equal(second.rows[0].from, "plain");
  assert.equal(ro.calls.length, 1, "later queries never touch the refused pool");
  assert.equal(opened, 1);
  assert.equal(warnings.length, 1);
});

test("withReadOnlyFallback: concurrent failures share one swap and one warning", async () => {
  const ro = fakePool("ro", PGB_118);
  const plain = fakePool("plain");
  let opened = 0;
  const warnings = [];
  const pool = withReadOnlyFallback(ro, () => (opened += 1, plain), (m) => warnings.push(m));
  const results = await Promise.all([pool.query("a"), pool.query("b"), pool.query("c")]);
  assert.deepEqual(results.map((r) => r.rows[0].text).sort(), ["a", "b", "c"]);
  assert.equal(opened, 1);
  assert.equal(warnings.length, 1);
  assert.equal(ro.ended, 1);
});

test("withReadOnlyFallback: any other error propagates and nothing is swapped", async () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  const ro = fakePool("ro", refused);
  let opened = 0;
  const pool = withReadOnlyFallback(ro, () => (opened += 1, fakePool("plain")), () => {});
  await assert.rejects(pool.query("select 1"), refused);
  assert.equal(opened, 0);
  assert.equal(pool.fellBack, false);
  assert.equal(ro.ended, 0);
});

test("withReadOnlyFallback: errors after the swap propagate too, and end() closes the live pool", async () => {
  const ro = fakePool("ro", PGB_122);
  const plain = fakePool("plain", Object.assign(new Error("permission denied for table queue"), { code: "42501" }));
  const pool = withReadOnlyFallback(ro, () => plain, () => {});
  await assert.rejects(pool.query("update queue set error = null"), /permission denied/);
  assert.equal(pool.fellBack, true);
  await pool.end();
  assert.equal(plain.ended, 1);
  assert.equal(ro.ended, 1);
});

test("withReadOnlyFallback: a healthy pool is left alone", async () => {
  const ro = fakePool("ro");
  let opened = 0;
  const pool = withReadOnlyFallback(ro, () => (opened += 1, fakePool("plain")), () => {});
  const r = await pool.query("select 1");
  assert.equal(r.rows[0].from, "ro");
  assert.equal(opened, 0);
  assert.equal(pool.fellBack, false);
});
