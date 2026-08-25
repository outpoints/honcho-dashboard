import assert from "node:assert/strict";
import test from "node:test";
import { Page } from "@honcho-ai/sdk";
import { supportedUploadContentType } from "../src/lib/honcho/fileUpload.ts";
import { buildSearchFilters } from "../src/lib/honcho/searchFilters.ts";
import { orderSearchResults } from "../src/lib/honcho/searchOrdering.ts";
import {
  listAllSessions,
  SESSION_LIST_PAGE_SIZE,
} from "../src/lib/honcho/sessionListing.ts";
import { parseOptionalJsonObject } from "../src/lib/json.ts";

test("buildSearchFilters emits UTC date and metadata filters", () => {
  assert.deepEqual(
    buildSearchFilters({
      fromDate: "2026-08-01",
      toDate: "2026-08-24",
      metadataJson: '{"source":"docs"}',
    }),
    {
      ok: true,
      filters: {
        created_at: {
          gte: "2026-08-01T00:00:00.000Z",
          lte: "2026-08-24T23:59:59.999Z",
        },
        metadata: { source: "docs" },
      },
    },
  );
});

test("buildSearchFilters rejects inverted and impossible dates", () => {
  assert.deepEqual(buildSearchFilters({ fromDate: "2026-08-25", toDate: "2026-08-24" }), {
    ok: false,
    error: "From date must be on or before the to date.",
  });
  assert.deepEqual(buildSearchFilters({ fromDate: "2026-02-30" }), {
    ok: false,
    error: "From date is invalid.",
  });
});

test("optional JSON object parser rejects malformed and non-object values", () => {
  assert.deepEqual(parseOptionalJsonObject("[1,2]", "Metadata"), {
    ok: false,
    error: "Metadata must be a JSON object.",
  });
  assert.deepEqual(parseOptionalJsonObject("{oops", "Metadata"), {
    ok: false,
    error: "Metadata must be valid JSON.",
  });
});

test("upload type inference supports documented files and rejects binary media", () => {
  assert.equal(supportedUploadContentType("notes.md", ""), "text/plain");
  assert.equal(supportedUploadContentType("report.pdf", "application/pdf"), "application/pdf");
  assert.equal(supportedUploadContentType("data.json", "application/octet-stream"), "application/json");
  assert.equal(supportedUploadContentType("photo.jpg", "image/jpeg"), null);
});

test("search ordering preserves relevance and supports stable chronological order", () => {
  const messages = [
    { id: "relevance-first", created_at: "2026-08-20T12:00:00.000Z" },
    { id: "newest", created_at: "2026-08-24T12:00:00.000Z" },
    { id: "same-time-a", created_at: "2026-08-22T12:00:00.000Z" },
    { id: "same-time-b", created_at: "2026-08-22T12:00:00.000Z" },
    { id: "invalid", created_at: "not-a-date" },
  ];

  assert.deepEqual(orderSearchResults(messages, "relevance").map(({ id }) => id), [
    "relevance-first",
    "newest",
    "same-time-a",
    "same-time-b",
    "invalid",
  ]);
  assert.deepEqual(orderSearchResults(messages, "newest").map(({ id }) => id), [
    "newest",
    "same-time-a",
    "same-time-b",
    "relevance-first",
    "invalid",
  ]);
  assert.deepEqual(orderSearchResults(messages, "oldest").map(({ id }) => id), [
    "relevance-first",
    "same-time-a",
    "same-time-b",
    "newest",
    "invalid",
  ]);
});

test("session listing follows every Honcho page beyond the first 100", async () => {
  const total = 247;
  const allSessions = Array.from({ length: total }, (_, index) => ({
    id: `session-${String(index + 1).padStart(3, "0")}`,
  }));
  const requestedPages = [];
  const pageResponse = (page, size) => ({
    items: allSessions.slice((page - 1) * size, page * size),
    total,
    page,
    size,
    pages: Math.ceil(total / size),
  });
  const firstPage = Page.from(pageResponse(1, SESSION_LIST_PAGE_SIZE), async (page, size) => {
    requestedPages.push(page);
    return pageResponse(page, size);
  });
  const requestedOptions = [];
  const client = {
    async sessions(options) {
      requestedOptions.push(options);
      return firstPage;
    },
  };

  const result = await listAllSessions(client);

  assert.deepEqual(requestedOptions, [{ size: 100, reverse: true }]);
  assert.deepEqual(requestedPages, [2, 3]);
  assert.equal(result.length, total);
  assert.equal(result.at(-1)?.id, "session-247");
});
