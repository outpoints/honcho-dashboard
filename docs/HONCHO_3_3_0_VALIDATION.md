# Honcho 3.3.0 compatibility and upgrade guide

## Compatibility decision

Honcho 3.3.0 needs one dashboard fix and adds one feature worth exposing. The
older 3.0.x–3.2.x behavior is unchanged.

- **Saving workspace configuration no longer erases 3.3 instructions.**
  `PUT /v3/workspaces/{id}` merges top-level keys and replaces every section it
  receives. The old form rebuilt `reasoning`, `peer_card`, `summary`, and `dream`
  from its own fields, so a save on a 3.3 server would delete per-agent
  `custom_instructions` set through the SDK or another client. The form now
  overlays its fields onto the stored section and keeps every key it does not
  show. The same change fixes **reset to default**: the server drops `null` and
  keeps omitted keys, so a reset section is now sent as `{}` instead of being
  silently kept. A section removed in JSON mode is cleared the same way.
- **Instruction editing on verified 3.3.0+ servers.** The form adds shared
  `custom_instructions` and per-section instructions for summary, dream, peer card,
  and the new dialectic section. Reasoning, summary, dream, and dialectic can opt
  out of the shared text (`""`). Peer-card instructions add to the dream
  instructions and never inherit the shared value. On older or unverified servers
  these fields stay hidden and stored values are sent back unchanged. A 3.2 server
  ignores the nested keys and stores the top-level ones without using them, so the
  dashboard does not offer them there. Instruction fields start collapsed and show
  one line: the text, "inherits shared", "not set", or "no instructions". If the
  server rejects a save, for example over the instruction token cap, the fields it
  names open automatically.
- **Session clone warning.** Before 3.3.0, clone found its source by session name
  across all workspaces. The clone confirmation now warns on older or unverified
  servers.
- **SDK 2.6.0.** It adds only the configuration types for #1303. Requests are
  unchanged, and the dashboard writes workspace configuration through the raw
  client. Tests now assert the `honcho-typescript/2.6.0` host header.
- **Trace reader.** `llm.call.traced` now carries `custom_instructions_ref`. The
  metadata-only projection keeps this content hash and never reads the
  `__custom_instructions__` content record.
- **Reasoning config readout.** Queue payloads from 3.3 record
  `custom_instructions_source` (for example `workspace.summary`). REASONING_CONFIG
  shows it per agent when present, and shows nothing when it is absent.

The server enforces the instruction token cap
(`DERIVER_MAX_CUSTOM_INSTRUCTIONS_TOKENS`, default and maximum 2000, and `0`
disables custom instructions). The dashboard does not copy that limit and shows the
server's validation error instead.

## Server changes and dashboard impact

The parsed OpenAPI documents for `v3.2.2` and `v3.3.0` differ only in the
configuration schemas, an optional `cursor` query parameter on ten list endpoints
with matching `CursorPage_*` response schemas, and `info.version`. No endpoint was
added or removed.

| Honcho change | Dashboard impact |
| --- | --- |
| Shared and per-agent `custom_instructions` (#1303) | Workspace config form, see above. Session configuration is read-only in the dashboard. |
| Custom-instruction telemetry (#1309) | Trace reader keeps `custom_instructions_ref`. CloudEvents schema stays v2. |
| Opt-in cursor pagination (#1326) | The dashboard does not send `cursor` and receives the unchanged `Page`. With Honcho's cache on, `total` on page 2+ can be up to `CACHE_PAGINATION_COUNT_TTL_SECONDS` (default 60) old. |
| Session-peer and webhook list ordering (#1326) | Those pages no longer skip or repeat rows. No client change. |
| Message search trigram index (#1335) | Search and the `ILIKE` fallback get faster after the migration. Instance table sizes include the new index. |
| Session clone scoped to the workspace (#1284) | Clone is safe on 3.3.0+. Older servers get a warning. |
| Expiring JWTs fixed (#1025) | A dashboard instance configured with an expiring key now works until expiry, then gets `401 JWT expired`. |
| `/openapi.json` no longer lists `api.honcho.dev` first (#1103) | None. The dashboard reads only `info.version`. |
| Summary cap changes (#1318) | Server settings. See the startup check below. |
| ChromaDB vector store (#868) | Optional server backend. Instance vector and pgvector readouts describe Postgres only. |
| `python -m src.migrate` advisory lock (#1268) | Server deployment only. |

## Upgrade procedure

1. **Check settings that block startup.** If `SUMMARY_MODEL_CONFIG__MAX_OUTPUT_TOKENS`
   is set below 6000, raise it or lower `SUMMARY_MAX_TOKENS_SHORT` and
   `SUMMARY_MAX_TOKENS_LONG` (new defaults 1500 and 6000). Otherwise settings fail
   to load. Remove `DIALECTIC_HISTORY_TOKEN_LIMIT` and `DREAM_HISTORY_TOKEN_LIMIT`.
   They are ignored now.
2. **Size the migration.** Revision `3e7a1c9d5b20` follows 3.2.2's `b8d2f4a6c9e1`
   and builds `ix_messages_content_trgm` concurrently. Plan disk for about 1.5× the
   `messages` table:

   ```sql
   SELECT pg_size_pretty(pg_relation_size('messages'));
   SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';
   ```

   The build waits for open transactions that touched `messages` and for any older
   snapshot. It fails after 60 minutes and leaves an invalid index that the next
   run rebuilds. On a large or busy database, build it first with the statement in
   Honcho's troubleshooting guide. If the role cannot create `pg_trgm`, the
   migration skips the index and logs the statement.
3. **Back up** the database and deployment configuration.
4. **Upgrade API and deriver** to the same immutable `v3.3.0` image or tag and run
   Honcho's migration step. This dashboard does not run migrations or upgrade
   Honcho.
5. **Reload the dashboard** and confirm `/openapi.json` reports 3.3.0. Workspace
   config should show SHARED_INSTRUCTIONS and DIALECTIC.
6. **Smoke test.** Open a workspace config and switch to JSON to check what will be
   sent before saving. Run Search with punctuation, clone a test session, chat with a
   peer and the workspace, and check REASONING_CONFIG after new messages are
   derived.

## Verification

From `site/` with Node 24+:

```sh
npm run check
npm run start -- --hostname 127.0.0.1 --port 3108
# In another terminal, choose an output directory outside the repository:
DASHBOARD_TEST_URL=http://127.0.0.1:3108 \
DASHBOARD_TEST_OUTPUT="$TMPDIR/honcho33-dashboard-review" \
node scripts/verify-honcho33-ui.mjs
```

`scripts/honcho33.test.mjs` replays the server's top-level merge and `null`
dropping against the form output. It covers untouched round-trips, keys hidden on
unverified servers, inherit / explicit-none / custom states, reset-to-default
clearing, JSON removals, interval validation, collapsed-field summaries, mapping
422 locations to fields, the proxied PUT body, and trace projection. The 422
locations match Honcho 3.3.0's own models and exception handlers for workspace
update and create. The contract matrix in `honcho-compatibility.test.mjs` adds 3.3.0.

`verify-honcho33-ui.mjs` drives the production build on desktop and mobile against
synthetic 3.3.0, 3.2.2, and unknown-version servers. It checks the saved PUT body
for untouched and edited forms, collapsed summaries, expanding and collapsing with
edits, rejected saves opening the named fields, hidden-key preservation,
instruction sources on Reasoning, and the clone warning, with no unexpected requests, page errors, or
horizontal overflow.

These are source and fixture checks.

### Live read-only check, 2026-10-14

The production build ran against a live self-hosted Honcho 3.3.0 instance after
its migration (`3e7a1c9d5b20` applied, `ix_messages_content_trgm` valid). Every
PUT, DELETE, PATCH, operator POST, and create-style POST was intercepted and
aborted, so nothing was written.

- All 17 screens loaded with no API errors, page errors, or external requests.
- Workspace config showed the 3.3 fields. An untouched save for each of the 5
  workspaces produced a body identical to the stored configuration.
- An edited save produced the expected body, and every key exists in the live
  server's OpenAPI schema.
- Session clone showed no pre-3.3 warning.
- Search and a low-level peer chat returned 200 with real results.
- REASONING_CONFIG rendered from live queue payloads.
- Stored workspace configurations were identical before and after the run.

Because writes were intercepted, the server's handling of a real instruction
save was not exercised.

## Sources

- [Honcho v3.3.0 release](https://github.com/plastic-labs/honcho/releases/tag/v3.3.0)
- [Tag comparison](https://github.com/plastic-labs/honcho/compare/v3.2.2...v3.3.0)
- [Configuration schemas](https://github.com/plastic-labs/honcho/blob/v3.3.0/src/schemas/configuration.py)
- [Workspace update merge](https://github.com/plastic-labs/honcho/blob/v3.3.0/src/crud/workspace.py)
- [Instruction resolution](https://github.com/plastic-labs/honcho/blob/v3.3.0/src/utils/config_helpers.py)
- [Trigram index migration](https://github.com/plastic-labs/honcho/blob/v3.3.0/migrations/versions/3e7a1c9d5b20_index_messages_content_trgm.py)
- [Trace event schemas](https://github.com/plastic-labs/honcho/blob/v3.3.0/src/telemetry/events/trace.py)
- [TypeScript SDK changelog](https://github.com/plastic-labs/honcho/blob/v3.3.0/sdks/typescript/CHANGELOG.md)
