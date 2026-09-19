import assert from "node:assert/strict";
import test from "node:test";
import { webhookQueueStatus } from "../src/lib/operator/webhookStatus.ts";

test("webhook queue states never imply a receiver confirmed delivery", () => {
  assert.equal(webhookQueueStatus(null, true), "processed");
  assert.equal(webhookQueueStatus(null, false), "pending");
  assert.equal(webhookQueueStatus(null, null), "unknown");
  assert.equal(webhookQueueStatus("timeout", true), "failed");
  assert.equal(webhookQueueStatus("timeout", false), "failed");
  assert.equal(webhookQueueStatus("", null), "failed");
});
