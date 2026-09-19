# Honcho 3.2 feature verification

Verified 2026-09-18 against the tagged Honcho `v3.2.0` API and SDK `2.5.0`.
The dashboard remains deployable before the server upgrade: evidence/provenance
require a verified 3.2+ version; backlog requires 3.1.2+. Older/unknown servers
retain established browsing and chat workflows.

## Automated checks

Run inside `site/` with Node 24+:

```sh
npm run check
```

Tests cover version boundaries, missing/unknown version metadata, evidence on
peer/workspace chat, session/scope parameters, null/empty evidence, 3.1's plain
chat contract, ordered/missing premises, workspace-wide backlinks, permissions,
404/503 errors, read-only evidence message retrieval, malformed chat evidence and
metrics, v1/v2 traces, sensitive-payload exclusion,
bounded file reads, and incomplete collector records.

For the browser regression suite, start a dashboard build locally and run:

```sh
DASHBOARD_TEST_URL=http://127.0.0.1:3108 node scripts/verify-honcho32-ui.mjs
```

This suite intercepts every API request and blocks unrecognized/external requests.
It does not reach your configured Honcho server or database. It exercises desktop
and mobile evidence, on-demand message text, parent/backlink navigation, missing
parents, missing-message retries without session creation, malformed evidence,
dropdown focus/arrow keys/Escape inside dialogs, workspace empty evidence, backlog, traces, and disabled features on 3.1
and unknown versions. Screenshots default to `/tmp/honcho32-dashboard-review`;
set `DASHBOARD_TEST_CAPTURES=0` to run only behavior checks.

## Actual 3.2 server verification

Used the upstream sandbox with Docker image `ghcr.io/plastic-labs/honcho:v3.2.0`
(digest `sha256:6369a1a8387f560fd71296866a5e109420e3442ce2ea9ffdcf9f38529de416c1`),
tagged source commit `2aa2ff6`, isolated database/volumes/network, and an offline
mock model/embedding provider. No production data, server, or paid model was used.
The isolated database was migrated to `a7c3e9f1b2d4`.

API checks passed:

- Single-conclusion lookup, two real parent conclusions, and reverse backlinks.
- Plain peer chat, populated peer evidence (nine conclusions for the tested pair),
  and valid empty workspace evidence with the mock provider.
- Streaming evidence only on the terminal SSE event.
- Missing and wrong-workspace conclusion lookups return 404.

Dashboard checks against that server passed:

- Peer chat opt-in produces an expandable evidence bundle (two self-conclusions).
- An evidence conclusion opens its provenance inspector.
- A seeded derived conclusion resolves both parents, and navigating to a parent
  shows the original conclusion among its backlinks.
- Fleet displays the actual service backlog snapshot through the dashboard proxy.

The upstream sandbox's premise-injection verification script uses an obsolete
internal function signature after writing its fixtures. The separate public-API
checks above verified the stored links; no Honcho runtime code was changed.

These checks establish API/UI interoperability. They do not test your real model's
answer quality or migrate your existing production database. The mock provider
does not produce nonempty workspace tool-call evidence; populated message/tool
rendering and workspace evidence are additionally covered by controlled fixtures.

## Upgrade sequence

The existing self-hosted server has since been upgraded to Honcho 3.2.0. The
release candidate was checked against that live server using a disposable
workspace. API checks covered workspace/peer/session/scope operations, file
upload, search, context, chat, conclusions, dreams, queue metrics, and operator
panels. Browser checks confirmed populated chat evidence, on-demand message
retrieval, tool-call details, real parent/backlink navigation, and single/bulk
retry of disposable tasks. Webhook create/list/test/delete and receipt at a
temporary public receiver passed after the server's `WEBHOOK_SECRET` was set.

Webhook queue completion does not prove delivery: Honcho can record a processed
task even when signing or the HTTP request fails. The dashboard now labels these
as processed events and directs operators to receiver receipts or server logs.
Legacy operator JSON fields remain available for compatibility; new clients use
`processed`, `pending`, `last_event`, and `queue_status`.

Production logs/call traces were not configured; their unavailable states were
checked live and trace rendering/parsing uses synthetic collector records. Live
verification does not establish that every third-party integration client is
configured, or guarantee model answer quality. The sequence below remains
guidance for other installations.

1. Build/deploy this dashboard update. It can run against your existing 3.1 API.
2. Back up your Honcho database/configuration, then upgrade the API and deriver
   together to 3.2 using your normal deployment procedure and run Honcho migrations.
   Source installs need Python 3.13+. Allow the source-link reconciler to backfill.
3. Refresh the dashboard after the upgrade so cached OpenAPI capabilities reload.
   Enable INCLUDE_EVIDENCE, send a peer/workspace query, and inspect a conclusion's
   PROVENANCE against your own data. Check Fleet, Scopes/context, and operator panels.
4. Configure a collector JSONL mount only if you want CALL_TRACES. Chat evidence,
   provenance, and backlog do not require it.

Sources: [server release notes](https://github.com/plastic-labs/honcho/blob/v3.2.0/CHANGELOG.md),
[SDK release notes](https://github.com/plastic-labs/honcho/blob/v3.2.0/sdks/typescript/CHANGELOG.md),
[trace schemas](https://github.com/plastic-labs/honcho/blob/v3.2.0/src/telemetry/events/trace.py),
[source-link migration](https://github.com/plastic-labs/honcho/blob/v3.2.0/migrations/versions/a7c3e9f1b2d4_add_document_sources_table.py).
