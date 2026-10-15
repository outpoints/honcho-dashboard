import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATOR_WRITES_DISABLED_REASON,
  OPERATOR_WRITES_ENV,
  operatorWritesEnabled,
} from "../src/lib/operator/writes.ts";

const withValue = (value) => ({ [OPERATOR_WRITES_ENV]: value });

test("env var name is HONCHO_OPERATOR_WRITES", () => {
  assert.equal(OPERATOR_WRITES_ENV, "HONCHO_OPERATOR_WRITES");
});

test("writes are disabled when the variable is unset", () => {
  assert.equal(operatorWritesEnabled({}), false);
  assert.equal(operatorWritesEnabled(withValue(undefined)), false);
});

test("writes are disabled for empty, false-like and unknown values", () => {
  for (const v of ["", " ", "0", "false", "FALSE", "no", "off", "disabled", "2", "truee", "y", "on"]) {
    assert.equal(operatorWritesEnabled(withValue(v)), false, `value ${JSON.stringify(v)}`);
  }
});

test("writes are enabled for 1/true/yes in any case", () => {
  for (const v of ["1", "true", "TRUE", "True", "yes", "YES", "Yes"]) {
    assert.equal(operatorWritesEnabled(withValue(v)), true, `value ${JSON.stringify(v)}`);
  }
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(operatorWritesEnabled(withValue(" true ")), true);
  assert.equal(operatorWritesEnabled(withValue("\tyes\n")), true);
});

test("other env vars do not enable writes", () => {
  assert.equal(operatorWritesEnabled({ HONCHO_DATABASE_URL: "postgres://x", WRITES: "true" }), false);
});

test("defaults to process.env", () => {
  const prev = process.env[OPERATOR_WRITES_ENV];
  try {
    delete process.env[OPERATOR_WRITES_ENV];
    assert.equal(operatorWritesEnabled(), false);
    process.env[OPERATOR_WRITES_ENV] = "true";
    assert.equal(operatorWritesEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env[OPERATOR_WRITES_ENV];
    else process.env[OPERATOR_WRITES_ENV] = prev;
  }
});

test("disabled reason names the variable", () => {
  assert.equal(
    OPERATOR_WRITES_DISABLED_REASON,
    "operator writes are disabled; set HONCHO_OPERATOR_WRITES=true to allow retrying reasoning tasks",
  );
});
