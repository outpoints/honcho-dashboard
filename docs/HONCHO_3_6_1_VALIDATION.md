# Honcho 3.6.1 compatibility and upgrade guide

## Compatibility decision

Honcho 3.6.0 adds Representation History and multi-tenancy. 3.6.1 makes the 3.6
tenant migration run without blocking reads and writes and fixes deletion deadlocks.
The API of 3.6.1 equals 3.6.0's. The dashboard needs one query fix for the new
schema, adds a page for the new feature, and keeps 3.0.x–3.5.x behavior unchanged.

- **Dreams page (Representation History, #1542).** `#/dreams`, in the sidebar after
  REASONING, lists the workspace's dream runs newest first through
  `POST /dreams/list`: status, observer and observed peer, type and trigger, created
  and removed counts, whether the peer card changed, start time and duration. Opening
  a run reads `GET /dreams/{run_id}` and shows the conclusions it created with the
  conclusions each came from (behind SOURCES), the conclusions it removed as they read
  before (with the near-duplicate from the same dream that replaced one, when there
  is one), and the peer card's added, dropped and unchanged lines. A conclusion a later
  dream removed opens that dream in a modal with the conclusion marked, and BACK walks
  the trail. Current conclusions open in the provenance inspector. OBSERVER and OBSERVED
  filter on the server, travel in the hash (`#/dreams?observed=&observer=`, with `?peer=`
  as an alias),
  and a peer row's **DREAMS** button links there. A running dream polls every 5
  seconds, otherwise the list refreshes every 30. Failed, interrupted, running and
  pruned runs each explain what their changes mean. With write actions on,
  SCHEDULE_DREAM opens the same modal as Reasoning, prefilled from the filters.
  Nothing on the page writes.
- **SDK 2.9.0.** It adds `honcho.dreams()` and `honcho.getDream()`. Nothing the
  dashboard already called changed (`npm pack` of 2.8.0 and 2.9.0 differs only in the
  dream files and the version). Both new calls run the SDK's workspace get-or-create
  first, as every SDK call does, against the workspace already selected. Tests assert
  the `honcho-typescript/2.9.0` host header.
- **Capped list totals (#1500).** A list's `total` is now exact only up to
  `PAGINATION_COUNT_LIMIT` (100,000 by default). Past it the server reports the limit
  plus one, and on later pages a number just past the current page. The dashboard
  shows any total above 100,000 as **100,000+** wherever it prints a REST list total
  (Overview, Conclusions, a peer's sessions and conclusions, peer compare, session
  transcripts, CITED_BY, session learning). Paging is unaffected: Honcho keeps `pages`
  reaching the end of the list. Only servers known to predate the cap keep exact large
  totals.
- **Deletion and dream history.** On 3.6, deleting a conclusion also deletes its copy
  in dream history, and deleting a session deletes the copies of its conclusions, so
  dreams that created or removed them list them as unavailable. The conclusion delete,
  bulk delete and session remove confirmations say so on 3.6 servers. A conclusion
  restored from TRASH is a new conclusion and is not linked back.
- **Reasoning token totals (schema change).** 3.6 keys `messages` by
  `(tenant_id, id)` and drops the index on `id` alone. The Reasoning page joined queue
  items to messages by id for its token counts, which on 3.6 can no longer seek and
  reads the whole table on every poll. It now joins on the tenant too: the queue item's
  own, or the workspace's for single-tenant queue rows, which carry none. Checked with
  `EXPLAIN` on the 3.6.1 schema: the old join scans an index end to end, the new one
  seeks.
- **Queue retry.** 3.6's deriver claims from `queue_item_batches`, which triggers on
  `queue` keep current, including when a processed row is reopened. The operator retry
  (`processed = false, error = NULL`) therefore still works. This was exercised on a
  real 3.6.1 deriver (see Verification).
- **Diagnostics.** The schema map knows the 3.6 head `4f9c2a7e8d31` (3.6.0 and 3.6.1)
  and the 13 revisions between it and 3.5.0's head. A database on one of those
  revisions is reported as a main-branch build when the server reports 3.5.x, and as an
  upgrade that stopped part-way when it reports 3.6. Because 3.6.1 commits
  `e5fe7f8bcf62` step by step, `tenant_id` columns on the 3.5.0 head are reported as a
  stopped tenant migration too. On the 3.6 head, new probes check
  `queue_item_batches` and its three triggers (3.6 refuses to start without them), the
  tenant-scoped message search indexes (Honcho keeps the old ones when `btree_gin` is
  missing, and without `pg_trgm` only full-text search gets an index), and how many tenants
  the operator database role can see. Operator SQL filters by workspace name only, so
  several tenants sharing a database are flagged, and so is row-level security that
  hides rows from the role. The 3.4 queue-index probe still runs on 3.6.
- **Schema cache.** The operator layer's table and column checks now expire after five
  minutes instead of living as long as the process, so a dashboard left running across
  a Honcho upgrade picks up new columns (`tenant_id`, `deleted_at`).

### Detecting the features

| Capability | Schema evidence |
| --- | --- |
| Representation History | `DreamRunDetail` |
| Capped list totals | `Page_Conclusion_.total` described with `PAGINATION_COUNT_LIMIT` |

Without the evidence, a released 3.6.0 or later decides. An older or unparseable
version fails closed: no dream request is sent, and the page explains why. A `401` or
`403` from the dream routes is shown as a key that lacks workspace or admin access.

## Server changes and dashboard impact

The parsed OpenAPI documents for `v3.5.0` and `v3.6.1` differ in two paths
(`POST /dreams/list`, `GET /dreams/{run_id}`), nine `Dream*` schemas, and a description
on every `Page_*.total`. `v3.6.0` and `v3.6.1` publish identical schemas.

| Honcho change | Dashboard impact |
| --- | --- |
| Representation History (#1542) | DREAMS page, peer-row link, delete confirmations. |
| List totals capped at `PAGINATION_COUNT_LIMIT` (#1500) | Totals above 100,000 show as 100,000+. Page counts from a capped total show a `+` until the last page, where the server's total is exact. |
| `tenant_id` on every table, messages keyed `(tenant_id, id)` (#1264) | Reasoning token join keyed by tenant. Diagnostics tenant probe. |
| `queue_item_batches` claim aggregate and triggers (#1264) | Diagnostics probe. Operator retry unchanged and verified. |
| Tenant-scoped message search indexes, `btree_gin` (#1264) | Diagnostics probe. The operator message search still uses them. |
| Multi-tenancy, `/v3/tenants`, RLS (#1264, #1546) | None. Off by default. The tenant registry is a control-plane API the dashboard does not use. |
| Tombstoned parents hidden from reads (#1474, #1548, #1559) | None yet: nothing sets `deleted_at`. Operator SQL still checks each row's own tombstone. |
| Deriver worker cap, Redis fallback, queue status speed (#1264, #1550) | None. |
| `run_id` on representation and summary events, `trace_id` on their LLM calls (3.6.1, #1576) | None. FIND_TRACE in Diagnostics already matches any recorded value, so a batch's run id now lists its LLM calls. |
| Online tenant migration (3.6.1, #1574) | Diagnostics reports a stopped run. |
| Deletion deadlock fixes (3.6.1, #1577, #1580) | None. Deleting sessions and workspaces from the dashboard is safer during derivation. |

## Upgrade procedure

1. **Go straight to 3.6.1.** In 3.6.0, `e5fe7f8bcf62` rebuilt every tenant-scoped key in
   one transaction, blocking reads and writes until it finished. In 3.6.1 it commits
   after each step, builds indexes concurrently and validates new foreign keys
   separately, so the previous release keeps serving during the upgrade. Its index
   builds and validations run under a 60-minute `statement_timeout`. A run that stops
   can be run again.
2. **Leave `TENANT_ID` unset** unless you mean to name the instance's tenant: the
   migration stamps it on every row and it cannot change afterwards. Leave
   `MULTI_TENANT` off.
3. **Check extensions.** The message search indexes need `btree_gin` (the migrations
   create it when the role can). Without it Honcho keeps the old indexes and search
   works as before.
4. **Back up** the database and deployment configuration.
5. **Upgrade API and deriver together** to the `v3.6.1` image and run Honcho's
   migration step (14 revisions from 3.5.0). Images from 3.2.2 onward still run
   against the new schema, so they stay rollback targets. Source builds that want
   surprisal-based dream sampling now pass the `INSTALL_SURPRISAL=true` build argument.
6. **Reload the dashboard.** Diagnostics should show `4f9c2a7e8d31 · matches server
   3.6.1` and the 3.6 probes passing. DREAMS fills as dreams run. Runs from before the
   upgrade were never recorded. A source build from Honcho's `main` branch can sit one
   or more migrations past the release while still reporting 3.6.1. For the one known
   so far, `0e32bf9d5a22` (webhook event types), Diagnostics shows `past 3.6.1: a build
   from Honcho's main branch` and runs the same probes. For a newer one it skips the
   schema probes and says why.

Upgrading the dashboard first is safe: on a 3.5 server none of the new requests are
sent, and the Reasoning join falls back to the old form when `tenant_id` is absent.

## Verification

From `site/` with Node 24+:

```sh
npm run check
npm run start -- --hostname 127.0.0.1 --port 3108
# In another terminal, with an output directory outside the repository:
DASHBOARD_TEST_URL=http://127.0.0.1:3108 \
DASHBOARD_TEST_OUTPUT="$TMPDIR/honcho36-dashboard-review" \
node scripts/verify-honcho36-ui.mjs
```

`scripts/honcho36.test.mjs` covers schema-first detection (3.6.1, 3.5.0, a main build
with dream history only, unknown versions), total and page-count formatting, the dream
helpers (hash filters and run links, card diff and paired card changes, a run read as
added, rewritten and forgotten changes and their counts, grouping by start time,
trigger labels, the stuck-run threshold and polling, retention gaps, durations,
malformed replies), capability refusal, the SDK 2.9 request shapes through the proxy,
and every new schema probe, including a main build past 3.6.1.
`honcho-compatibility.test.mjs` adds 3.5.0 and 3.6.1 to the contract matrix.

`verify-honcho36-ui.mjs` drives the production build against synthetic 3.6.1, 3.5.0,
main-branch, unknown-version and restricted-key servers with every request
intercepted. It checks the DREAMS list grouped by start time, a run left running
flagged as possibly stuck, detail reads only for runs that removed something (and one
read shared when such a run opens), rewritten and forgotten counts, sources,
replacements, the paired card change, Escape closing a row, the summary line and its
forgotten filter, losses listed first, following a removed conclusion to the dream that
removed it with that conclusion marked, a run opened from its link, filters in the request body, CLEAR_FILTERS, scheduling from the
page with peers picked and the exact request body, the peer-row link, no dream request
where the capability is missing, the restricted message, 100,000+ totals, the delete
confirmation note, and no unexpected requests, page errors or horizontal overflow on a
phone.

The list reads a run's detail when the run removed something and is not pruned,
because only the detail says whether each removed conclusion was replaced
(`replaced_by`) or forgotten. Finished runs are read together once per set of runs, so
the summary line can count forgotten conclusions, and a live run reads its own detail
while it runs. That is at most one read per run on the page. Runs that removed nothing
load their detail when opened.

The summary line counts the loaded page only. Honcho's dream list filters by observer
and observed peer but not by status, so a failure on a later page is not counted until
that page is open. The line says which page it counts when there is more than one.

The same build was run against a real Honcho 3.6.1 API and deriver on the upstream
sandbox with synthetic data, upgraded in place from a seeded 3.5.0 database (14
migrations in seconds on a small database). Diagnostics reported the 3.6 head and all
new probes passing, a real dream recorded a run that the page listed, the Reasoning
page loaded with the new join, and a failed queue item retried through the UI was
reopened, entered `queue_item_batches` through the trigger, and was processed again by
the 3.6.1 deriver. The sandbox's mock model never calls the dream specialists' tools,
so its real runs have no changes. The created, removed, replaced, pruned, failed and
running runs used to exercise the detail view were written directly into the
sandbox's `dream_runs` and `dream_run_changes` tables in the shape the dreamer writes.

It was then checked read-only against a production deployment upgraded from 3.5.0: an
11 GB database, about 167,000 conclusions in one workspace, built from `main` one
migration past 3.6.1. All 15 migrations ran on the API's first start, and the deriver
restarted until they finished, because 3.6 refuses to start without
`queue_item_batches`. Every page loaded with no failed requests or page errors. The
harness would have blocked any write, and none was attempted. Diagnostics passed every
database probe.
The conclusion total read 100,000+ against a capped `total` of 100,001. DREAMS listed
no runs (none had run since the upgrade), and the peer-row link filtered it to that
peer. This check found the two cases above: the post-release migration skipped the
schema probes, and the pager read `page 1 / 4001` from the capped total.

## Known limitations

- The server does not publish its `PAGINATION_COUNT_LIMIT`. With a limit below the
  default, a capped total shows as that limit plus one rather than with a `+`.
- Operator SQL filters by workspace name. On a database shared by several tenants that
  reuse a workspace name, operator panels count their rows together. Diagnostics flags
  this. Honcho's REST reads are unaffected.
- Restoring a conclusion from TRASH creates a new conclusion, and dream history keeps
  showing the deleted one as unavailable.

## Sources

- [Honcho v3.6.1 release](https://github.com/plastic-labs/honcho/releases/tag/v3.6.1)
- [Honcho v3.6.0 release](https://github.com/plastic-labs/honcho/releases/tag/v3.6.0)
- [Tag comparison](https://github.com/plastic-labs/honcho/compare/v3.5.0...v3.6.1)
- [Dream history routes](https://github.com/plastic-labs/honcho/blob/v3.6.1/src/routers/dreams.py)
- [Tenant migration](https://github.com/plastic-labs/honcho/blob/v3.6.1/migrations/versions/e5fe7f8bcf62_add_tenant_id_primitive.py)
- [Claim aggregate migration](https://github.com/plastic-labs/honcho/blob/v3.6.1/migrations/versions/b7d2f4a81c39_add_queue_item_batches_aggregate.py)
- [Message search index migration](https://github.com/plastic-labs/honcho/blob/v3.6.1/migrations/versions/d4b8e2f7a913_tenant_scope_message_text_indexes.py)
- [Pagination](https://github.com/plastic-labs/honcho/blob/v3.6.1/src/utils/pagination.py)
- [TypeScript SDK changelog](https://github.com/plastic-labs/honcho/blob/v3.6.1/sdks/typescript/CHANGELOG.md)
