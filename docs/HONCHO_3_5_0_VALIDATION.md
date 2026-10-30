# Honcho 3.5.0 compatibility and upgrade guide

## Compatibility decision

Honcho 3.5.0 needs one behavior change in the dashboard and adds features it now
uses. Behavior on 3.0.x–3.4.x is unchanged.

- **Workspace configuration is replaced, not merged (#1458).** `PUT /v3/workspaces/{id}`
  now stores exactly the configuration sent (`model_dump(exclude_none=True)`). Every
  dashboard save already sent the whole configuration (the stored one with the form
  laid over it), so no setting is lost on 3.5, and released dashboards are safe too.
  What changes is clearing: before 3.5 a cleared section had to be sent as `{}` and a
  cleared top-level string as `""`, which a 3.5 server would store. On servers known
  to replace, the dashboard now leaves cleared keys out, the JSON editor says a
  removed key is deleted, and the save confirmation says the server replaces the
  stored configuration. Unknown and older servers keep the merge-safe body, which is
  also correct on 3.5.
- **SDK 2.8.0.** It adds `Session.scopes`, `Scope.sessionCount`, `Scope.removeSessions()`,
  `Conclusion.sourceMessageIds`, and the `scope` / `inNoScope` / `includeScopes` and
  `filters` / `includeSessionCount` list options. `session()` and the other calls the
  dashboard already used are unchanged. Tests assert the `honcho-typescript/2.8.0`
  host header.
- **Message citations (#935).** The conclusion inspector has a CITED_MESSAGES panel:
  the messages an explicit conclusion was derived from, in citation order, read through
  the non-creating message route in the conclusion's session. Long messages clamp
  behind SHOW_MORE. An opened message line (Messages and Sessions) has a **CITED_BY**
  button that lists, page by page, the conclusions anywhere in the workspace that cite
  it (`source_message_ids: {contains: <id>}`), each with INSPECT. Nothing is read until
  the button is pressed. Conclusion rows show the cited-message count, and the Peers
  conclusion table shows "N messages · WHY →" for explicit conclusions.
- **Scope membership on sessions (#1477).** The Sessions page lists sessions with
  `include_scopes` and shows each session's scopes. A SCOPE filter appears when any
  session belongs to a scope, with "in no scope" and each scope name.
- **Scope counts and name filters (#1478).** The Scopes registry lists scopes with
  `include_session_count` and shows each scope's member session count. The dashboard
  loads every scope, so it does not need the server-side name filter.
- **Bulk scope removal (#1480).** With write actions on, member sessions have checkboxes
  and a REMOVE_N button. Removal sends one request per 100 sessions after a
  confirmation that names the count and explains that Honcho removes all of a request
  or none. If a later request fails, the error says how many were already removed.
  Per-row REMOVE stays for older servers.
- **Migrations `d8c4f6a2b901` and `c4d8e2f6a1b3`.** Diagnostics knows the 3.5.0 head
  (`c4d8e2f6a1b3`, compatible back to 3.2.2) and names `d8c4f6a2b901`, which no
  release ends on, as a main-branch build between 3.4.1 and 3.5.0. The 3.4 queue-index
  probe still runs on both.
- **Tombstones (#1429, #1450).** Nothing sets `deleted_at` yet. The operator database
  queries (throughput, heatmap, conclusion and session stats, peer message counts) now
  skip rows whose own `deleted_at` is set wherever the column exists. Conclusion stats
  previously counted deleted conclusions, which have had the column for longer.

### Detecting the features

Each 3.5 feature is gated on evidence in the server's `/openapi.json` schema first,
then on a released version of 3.5.0 or later. A server built from Honcho's main
branch reports the last release in `info.version` while carrying some of these, so
a version check alone would hide them:

| Capability | Schema evidence |
| --- | --- |
| Message citations | `Conclusion.source_message_ids` |
| Session scopes | `WorkspaceSessionGet` |
| Scope session counts | `Scope.session_count` |
| Bulk scope removal | `ScopeSessionsRemove` |
| Configuration replace | `WorkspaceUpdate.configuration` described as replacing the configuration |

Without the evidence, an older or unparseable version fails closed: no 3.5 request is
sent and the existing workflow is unchanged.

## Server changes and dashboard impact

The parsed OpenAPI documents for `v3.4.1` and `v3.5.0` differ in three new schemas
(`ScopeGet`, `ScopeSessionsRemove`, `WorkspaceSessionGet`), three new properties
(`Conclusion.source_message_ids`, `Scope.session_count`, `Session.scopes`), the
`include_scopes` and `include_session_count` query parameters, and the new
`scopes/{scope_id}/sessions/remove` path. `npm pack` of SDK 2.7.0 and 2.8.0 differs only
in the files the tag's `sdks/typescript` diff touches.

| Honcho change | Dashboard impact |
| --- | --- |
| Workspace configuration replaced on update (#1458) | Exact body on replacing servers; merge-safe body elsewhere. |
| Message citations (#935) | CITED_MESSAGES in the inspector, CITED_BY on message lines, counts on rows. |
| Session list scope membership and filters (#1477) | Scope labels and a SCOPE filter on Sessions. |
| Scope list counts and name filters (#1478) | Session counts in the Scopes registry. |
| Bulk scope removal (#1480) | Multi-select removal on Scopes. |
| `DIALECTIC_MAX_QUERY_LENGTH` (#1443) | None. The dashboard sets no client-side length limit, so the server's configured limit applies; workspace chat stays at 10,000 characters. |
| Peer chat answers as a single turn (#1451) | None. |
| Streamed chat usually arrives as one chunk (#1443) | None. The typing indicator covers the wait. |
| Tombstone columns (#1429, #1450) | Operator SQL skips tombstoned rows. |
| Langfuse SDK 5 (#1452) | Server exporter only. Self-hosted Langfuse must be v4.59.0+. |
| Summary rejections counted, not reported (#1457) | None. |
| Scope re-add keeps memory; deletion lock order (#1479) | None. Makes remove-then-re-add on the Scopes page safe. |
| 422 instead of 500 for unstorable input (#1445, #1455, #1492) | Error text improves; no client change. |
| Short and long summaries both kept (#1493) | Fewer missing session summaries. |
| pypdf 6.21.2, PDF parsing off the event loop (#1476) | A malformed or empty PDF upload now returns 422. |

## Upgrade procedure

1. **Check the migrations.** `d8c4f6a2b901` follows 3.4's `a5f8da8f6d23` and adds a
   nullable `deleted_at` to workspaces, peers, sessions and messages (no default,
   backfill or index). `c4d8e2f6a1b3` adds the `conclusion_source_messages` table.
   Both are DDL only. Images from 3.2.2 onward still run against the new schema.
2. **Check Langfuse.** If Honcho exports traces to a self-hosted Langfuse, it must be
   v4.59.0 or later, and saved metadata filters may need updating.
3. **Back up** the database and deployment configuration.
4. **Upgrade API and deriver** to the same `v3.5.0` image and run Honcho's migration
   step. This dashboard does not run migrations.
5. **Reload the dashboard.** Diagnostics should show `c4d8e2f6a1b3 · matches server
   3.5.0`. Citations appear only on explicit conclusions derived after the upgrade:
   there is no backfill.

Upgrading the dashboard first is safe: on a 3.4 server none of the new requests are
sent.

## Verification

From `site/` with Node 24+:

```sh
npm run check
npm run start -- --hostname 127.0.0.1 --port 3108
# In another terminal, with an output directory outside the repository:
DASHBOARD_TEST_URL=http://127.0.0.1:3108 \
DASHBOARD_TEST_OUTPUT="$TMPDIR/honcho35-dashboard-review" \
node scripts/verify-honcho35-ui.mjs
```

`scripts/honcho35.test.mjs` covers schema-first capability detection (3.5.0, 3.4.1,
a main-branch build, and unknown versions), configuration bodies against replicas of
both the 3.5 replace and the 3.4 merge, the citation helpers and their capability
refusal, the SDK 2.8 adapters, list options, removal batching, and the schema-head map.

`verify-honcho35-ui.mjs` drives the production build against synthetic 3.5.0, 3.4.1
and main-branch servers with every request intercepted. It checks scope labels and the
scope filter, CITED_BY and that clicks inside it (or its inspector) don't close the
line, the CITED_MESSAGES panel and its non-creating read, scope counts, the exact bulk
removal request, the exact configuration body on each server, and no unexpected
requests, page errors, or horizontal overflow on a phone.

The same build was run against a real Honcho 3.5.0 API and deriver on the upstream
sandbox with synthetic data: the migration to `c4d8e2f6a1b3`, scope labels and the
scope filter, scope counts, a real bulk removal (then restored), CITED_BY and the
inspector on stored citations, a real configuration save read back exactly as sent,
and the Diagnostics schema and queue-index probes, with no failed requests or page
errors. The sandbox's mock model produces out-of-range citation indices that the
deriver correctly drops, so the citations used were written directly into the
sandbox's citation table.

A read-only check against a live server built from Honcho's main branch (reporting
3.4.1, with citations and configuration replace but not the scope list changes)
confirmed that the dashboard showed exactly those features. CITED_BY and the
inspector worked on real citations. An untouched configuration save sent each
workspace's stored configuration unchanged, with every write aborted in the browser.

## Sources

- [Honcho v3.5.0 release](https://github.com/plastic-labs/honcho/releases/tag/v3.5.0)
- [Tag comparison](https://github.com/plastic-labs/honcho/compare/v3.4.1...v3.5.0)
- [Workspace update](https://github.com/plastic-labs/honcho/blob/v3.5.0/src/crud/workspace.py)
- [Citation migration](https://github.com/plastic-labs/honcho/blob/v3.5.0/migrations/versions/c4d8e2f6a1b3_add_conclusion_source_messages_table.py)
- [Tombstone migration](https://github.com/plastic-labs/honcho/blob/v3.5.0/migrations/versions/d8c4f6a2b901_add_primitive_tombstones.py)
- [TypeScript SDK changelog](https://github.com/plastic-labs/honcho/blob/v3.5.0/sdks/typescript/CHANGELOG.md)
