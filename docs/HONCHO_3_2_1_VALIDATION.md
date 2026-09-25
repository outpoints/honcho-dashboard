# Honcho 3.2.1 / SDK 2.5.1 compatibility

## Changes

The dashboard dependency and lockfile use TypeScript SDK 2.5.1. Honcho 3.2.1
adds `observer_id` and `observed_id` to chat evidence conclusions. The evidence
panel shows each returned observer/observed pair without another API request.
SDK types require these fields, but the dashboard keeps them optional because
3.2.0 omits them. Missing or null IDs remain unrecorded; malformed IDs produce a
retryable chat error before they reach React. Attribution is never inferred from
the selected peer, which would be incorrect for cross-peer workspace answers.

Explicit conclusions use `source_ids: []` on 3.2.1, versus `null` on 3.2.0 and
missing attribution on older servers. The SDK adapter preserves all supported
forms. Existing provenance logic treats null/empty parents consistently, without
issuing parent lookups for an empty set. No new endpoint or version gate is needed.

| Server | Dashboard behavior with SDK 2.5.1 |
| --- | --- |
| 3.0.x | Established browsing, peer chat and unscoped recall; no 3.1-only requests. |
| 3.1.0–3.1.1 | Scopes and workspace chat; evidence/provenance/backlog disabled. |
| 3.1.2 | Also enables service backlog metrics. |
| 3.2.0 | Evidence and provenance work; evidence peer attribution is unrecorded. |
| 3.2.1+ | Also displays evidence peer attribution and accepts empty parent arrays. |
| Unknown/restricted | Existing conservative capability and permission handling is preserved. |

The remaining 3.2.1 changes run on the server: evidence DB-session lifetime,
workspace-chat recall retries, deriver target attribution/escaping, Dreamer
argument validation, Redis Cluster connection cleanup, session-deletion memory
use, and a smaller runtime image. They need the server upgrade, not replacement
dashboard endpoints. No migration files changed between the 3.2.0 and 3.2.1 tags;
still run the normal Honcho migration step during deployment.

## Verification

From `site/` with Node 24+:

```sh
npm run check
npm run start -- --hostname 127.0.0.1 --port 3108
# In another terminal:
DASHBOARD_TEST_URL=http://127.0.0.1:3108 node scripts/verify-honcho32-ui.mjs
```

Contract tests cover 3.0.12, 3.1.0, 3.1.2, 3.2.0, and 3.2.1 response fixtures;
plain peer/workspace chat; populated evidence with and without pair IDs;
cross-peer attribution; missing/null/partial/malformed IDs; null/empty explicit
parents; proxy headers; and existing permission/provider failures.

The browser suite blocks all external/unrecognized requests and uses synthetic
data. It checks both 3.2.0 and 3.2.1 on desktop/mobile, including long peer IDs,
workspace attribution without extra lookups, empty parents, message retries,
provenance, backlog, and 3.0/3.1/unknown feature restrictions. Its captures are
local test artifacts, not replacements for the README screenshots.

### Before the server upgrade — 2026-09-25

- `npm run check` passed on Node 24.18.0: 34 tests, TypeScript, and production
  build. Seven pre-existing lint warnings remain in unchanged page components.
- The synthetic desktop/mobile browser suite passed on the production build,
  with no browser exceptions, unexpected requests, or page overflow. The design
  detector and bounded source/screenshot review found no issues in this addition.
- The live instance reported 3.2.0 and healthy. SDK 2.5.1 through the dashboard
  proxy passed peer/session/scope/conclusion listing, single-conclusion and
  empty-parent/backlink reads, service backlog metrics, plain peer chat, and plain
  workspace chat. Workspace evidence returned 20 conclusions and one tool call.
- Two peer-chat evidence requests through SDK/proxy returned HTTP 500; a direct
  API request for the same peer/query succeeded with 34 conclusions. Do not treat
  this as a fully passing peer-evidence baseline. Server logs were unavailable
  (`HONCHO_LOG_FILE` unconfigured), so the specific cause remains unconfirmed.
  The upstream 3.2.1 evidence DB-session fix is relevant but cannot be claimed as
  the confirmed remedy until this path is retested after the upgrade.

### After the server upgrade — 2026-09-25

The operator upgraded Honcho; `/health` reported healthy and `/openapi.json`
reported **3.2.1**. Retesting used SDK **2.5.1** and the local dashboard production
build, routing through its real proxy to the existing live workspace and peer.
These results use real API/model responses, without fixture interception.

- The previously failing peer-evidence query passed twice through the SDK/service
  path and once through the browser. All three returned 34 attributed conclusions.
  HTTP 500 did not recur in these attempts.
- Browser workspace evidence returned 14 conclusions across two distinct peer
  pairs, 22 message references, and two tool calls. Every displayed observer/observed
  row exactly matched its API record. Opening an evidence message succeeded via GET.
- Plain peer and workspace chat passed with `include_evidence` omitted and no
  evidence controls attached to those answers.
- Five explicit conclusions returned empty source arrays. Single-conclusion lookup
  and empty-premise reads passed; the browser showed the explicit no-parents state.
  A real derived conclusion resolved one parent and one reverse backlink.
- Session/scope listing and service backlog metrics passed. Mobile evidence had no
  page overflow. Context's Scope, Session, and Peer selectors aligned in the browser.
- The browser run recorded zero JavaScript exceptions and zero HTTP errors.

The earlier peer-evidence blocker was not reproduced after upgrading. These are
bounded live smoke tests; they do not independently establish the old exception's
root cause, model answer quality, or every internal Redis/Dreamer bug fix. No
additional application-code fix was needed.

## Upgrade and live verification

1. Deploy this dashboard build while Honcho remains on 3.2.0; confirm browsing,
   search, plain chat, opt-in evidence and provenance still work.
2. Back up the Honcho database and deployment configuration, then update API and
   deriver to the same immutable `v3.2.1` tag and run the normal migration step.
   The smaller image makes scikit-learn optional: deployments with
   `DREAM.SURPRISAL.ENABLED` and an sklearn-backed tree need the `surprisal` extra.
   `rptree`, `covertree`, and `lsh` do not need it. If Anthropic extended thinking
   meets forced tool choice, the new `thinking_tool_choice_conflict` provider
   setting defaults to `throw`; select an upstream-supported override only if
   needed for that model configuration.
3. Reload the dashboard to refresh cached OpenAPI capabilities and confirm 3.2.1.
4. In peer and workspace Chat, enable **INCLUDE_EVIDENCE** and ask a question that
   retrieves existing memory. Expand **SHOW_EVIDENCE**: populated conclusions
   should show real **OBSERVER → OBSERVED** IDs. Workspace chat may show multiple
   pairs. Empty evidence is valid; use a known relevant question to verify pairs.
   Repeat the peer-evidence path that returned 500 on 3.2.0 through the dashboard;
   if it still fails, capture the matching server traceback before attributing
   the failure to the SDK, proxy, model provider, or evidence collector.
5. Open **PROVENANCE** for an explicit conclusion: its empty parent list should
   show the no-parents state. Check a derived conclusion's parent/backlink reads,
   on-demand evidence messages, and plain chat with evidence turned off.
6. Check Fleet/Reasoning queues, Scopes/context/search, and operator diagnostics.
   Verify model behavior and server logs for the workspace recall and derivation
   fixes. A successful dashboard smoke test does not prove every internal
   Redis/Dreamer/server failure case is fixed.

The dashboard update does not upgrade Honcho or change its configuration.

Sources: [Honcho changelog](https://honcho.dev/docs/changelog/introduction),
[tagged SDK changelog](https://github.com/plastic-labs/honcho/blob/v3.2.1/sdks/typescript/CHANGELOG.md),
[SDK evidence types](https://github.com/plastic-labs/honcho/blob/v3.2.1/sdks/typescript/src/types/api.ts),
[server/SDK changes](https://github.com/plastic-labs/honcho/compare/v3.2.0...v3.2.1).
