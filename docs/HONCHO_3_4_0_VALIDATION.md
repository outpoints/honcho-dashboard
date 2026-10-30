# Honcho 3.4.0 compatibility and upgrade guide

## Compatibility decision

Honcho 3.4.0 needs no dashboard fix: no endpoint was added or removed, and every
existing request and response still works. The dashboard adds support for what the
release exposes. Behavior on 3.0.x–3.3.x is unchanged.

- **SDK 2.7.0.** It adds `uid` to `Peer`, `Session`, the `Honcho` client, and their
  response types. Requests are unchanged. Tests now assert the
  `honcho-typescript/2.7.0` host header and add 3.4.0 to the contract matrix.
- **Server-assigned UID (#1394).** Workspace cards and expanded peer and session rows
  show `uid` with a copy button when the server returns it. Older servers omit it and
  nothing is shown. Peer and session search also match an exact pasted UID. `id`
  remains the identifier the dashboard uses everywhere.
- **Named-scope API keys (#1341).** On verified 3.4.0+ servers, the Scopes page has a
  SCOPE_KEY panel that mints a key for the selected scope with
  `POST /v3/keys?workspace_id=…&scope_id=…&expires_at=…`. Minting is behind the
  write-actions toggle and a confirmation. The key is shown once, kept only in that
  panel's state, and never stored, logged, or put in a toast. A `405` is explained as
  authentication being off on the server; `401`/`403` as the instance token not being
  an admin key. Older and unverified servers see a notice and no mint control.
- **Migration `a5f8da8f6d23` (#1409).** Diagnostics adds read-only database probes:
  the Alembic revision compared with the server version, any index Postgres marks
  INVALID, and the five `ix_queue_pending_*` indexes, including a specific message
  when `ix_queue_pending_observers` was skipped because `btree_gin` is missing.
- **Dreamer working memory (#1378).** The trace inspector now reads `dream.specialist`
  and `dialectic.completed` events as agent runs. It keeps counters and identifiers
  only: iterations and limit, iteration-limit hits, budget line, write window,
  refused searches, working-notes changes, pending entries, and conclusions shown
  since the last dream. Runs from older servers omit these counters, and the
  inspector says so instead of showing zero.

## Server changes and dashboard impact

The parsed OpenAPI documents for `v3.3.0` and `v3.4.0` differ only in `uid` on the
Workspace, Peer, and Session schemas, the optional `scope_id` query parameter on
`POST /v3/keys`, and `info.version`. `npm pack` of SDK 2.6.0 and 2.7.0 differs only in
the files the tag's `sdks/typescript` diff touches.

| Honcho change | Dashboard impact |
| --- | --- |
| `uid` on workspaces, peers, sessions (#1394) | Shown when present; exact-match search. |
| Named-scope keys (#1341) | SCOPE_KEY panel on Scopes, gated on 3.4.0+. A dashboard instance configured with a scope key is a restricted key: workspace-wide screens fail with the existing restricted-key states. |
| Dreamer and dialectic budget, brief, notes (#1378) | Server settings, all off by default. Agent-run counters in the trace inspector. |
| Resource-created CloudEvents (#1360) | None. Telemetry stays off unless `TELEMETRY_ENABLED`. The trace reader skips these events. |
| Queue indexes and `deletion_generation` (#1409) | Diagnostics probes. Nothing in the dashboard reads the new column. |
| Unused provider key warning (#1344) | Startup log line only. |
| `thinking_tool_choice_conflict` on the OpenAI transport (#1402) | Server config. An unknown value now fails config load. |
| `response_format` answers that fail their schema return 422 (#1379) | None. The dashboard does not send `response_format`. |
| Lone surrogates return 422, not 500 (#1387) | Error text improves; no client change. |
| Deriver and dialectic hardening (#538, #1373, #1390, #1393) | Fewer silently empty derivations; failures now surface in the Reasoning queue. |

## Upgrade procedure

1. **Check the migration.** Revision `a5f8da8f6d23` follows 3.3.0's `3e7a1c9d5b20`.
   It adds `deletion_generation` to three tables (catalog-only) and builds five
   partial indexes on `queue` concurrently. A build waits for open transactions that
   touched `queue` and for older snapshots anywhere in the database, and fails after
   60 minutes, leaving an INVALID index that the next run rebuilds. On a busy
   database, prebuild the indexes with the statements in Honcho's troubleshooting
   guide.
2. **Check `btree_gin`.** `ix_queue_pending_observers` needs it. If the migration role
   cannot create the extension, the migration skips that index and logs the
   statement to run later.
3. **Back up** the database and deployment configuration.
4. **Upgrade API and deriver** to the same `v3.4.0` image and run Honcho's migration
   step. Images from 3.2.2 onward still run against the new schema, so a rollback to
   3.2.2+ does not need a downgrade. This dashboard does not run migrations.
5. **Before minting scope keys,** upgrade every API replica. Older replicas reject the
   key's audience rather than widening its access.
6. **Reload the dashboard.** Diagnostics should show the schema revision matching
   3.4.0, no INVALID indexes, and 5/5 queue indexes. Workspace cards should show UIDs.

Two fixes landed on Honcho's main branch after the tag (#1435, provider-rejected
requests retried without a fallback; #1433, wildcard filters inside AND/OR/NOT). If
either affects you, wait for the next patch release.

## Verification

From `site/` with Node 24+:

```sh
npm run check
npm run start -- --hostname 127.0.0.1 --port 3108
# In another terminal, with an output directory outside the repository:
DASHBOARD_TEST_URL=http://127.0.0.1:3108 \
DASHBOARD_TEST_OUTPUT="$TMPDIR/honcho34-dashboard-review" \
node scripts/verify-honcho34-ui.mjs
```

`scripts/honcho34.test.mjs` covers UID mapping, the scope-key capability gate, request
shape, response validation and refusal messages, the release-head map, revision,
index, and queue-index probes, and agent-run projection (including that content
fields are dropped and that missing counters stay missing).

`verify-honcho34-ui.mjs` drives the production build against synthetic 3.4.0 and
3.3.0 servers on desktop and mobile with every request intercepted. It checks UIDs
appear only on 3.4, the scope-key request and that the key is not persisted, the
3.3 notice, Diagnostics probes and agent runs, and no unexpected requests, page
errors, or horizontal overflow. These are source and fixture checks; a live 3.4.0
server was not exercised.

## Sources

- [Honcho v3.4.0 release](https://github.com/plastic-labs/honcho/releases/tag/v3.4.0)
- [Tag comparison](https://github.com/plastic-labs/honcho/compare/v3.3.0...v3.4.0)
- [Queue index migration](https://github.com/plastic-labs/honcho/blob/v3.4.0/migrations/versions/)
- [Key router](https://github.com/plastic-labs/honcho/blob/v3.4.0/src/routers/keys.py)
- [Named-scope keys documentation](https://github.com/plastic-labs/honcho/blob/v3.4.0/docs/v3/documentation/features/advanced/scopes.mdx)
- [Dream and dialectic telemetry](https://github.com/plastic-labs/honcho/blob/v3.4.0/src/telemetry/events/dream.py)
- [TypeScript SDK changelog](https://github.com/plastic-labs/honcho/blob/v3.4.0/sdks/typescript/CHANGELOG.md)
