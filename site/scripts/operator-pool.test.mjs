import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  READ_ONLY_PG_OPTION,
  normalizeDsn,
  operatorPoolTarget,
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
