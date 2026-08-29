# CLAUDE.md — honcho-dashboard

## North star

A fast, privacy-first **operator dashboard for a self-hosted [Honcho](https://honcho.dev) memory server**, built with Next.js. Browse workspaces / peers / sessions / scopes / messages / conclusions, watch the reasoning (deriver) queue across the whole fleet, and chat with peers or the whole workspace using memory as context.

Every page talks to a real Honcho `v3` API. The product is mature: beyond a basic memory browser, it leans into operator and observability surfaces — Fleet, Reasoning internals, Instance/DB stats, Diagnostics, and throughput/heatmaps. The work now is **polish, craft, and divergent features**.

## Stack

- Next.js 16 (App Router, React 19, TypeScript strict) — Node `>=24`
- Tailwind CSS v4 with custom `@theme` tokens in `src/app/globals.css`
- Framer Motion (animations), Lucide (icons), Base UI (primitives)
- JetBrains Mono + VT323 fonts via `next/font/google`
- No state library yet — pages use `useState`. Bring in TanStack Query when wiring real fetches; do not pull Redux/Zustand without asking.

## Repo layout

```
.
├── site/                  # the Next.js app (everything below is relative to ./site)
│   ├── src/
│   │   ├── app/           # layout.tsx, page.tsx, globals.css
│   │   ├── components/    # AppShell, Header, Sidebar, atoms, ui/, pages/*
│   │   ├── lib/           # data.ts (mocks), nav.ts, utils.ts
│   │   └── types/         # honcho.ts (domain types)
│   ├── docs/research/     # BEHAVIORS / COLOR_AUDIT / DROPDOWN specs (read before changing UX)
│   └── public/            # images, fonts, seo
└── CLAUDE.md              # this file
```

Routing is **hash-based inside `AppShell`** (`#/overview`, `#/workspaces`, …). Add new top-level screens by appending to `NAV_ITEMS` in `src/lib/data.ts`, adding a `RouteKey` in `src/types/honcho.ts`, and registering a page in `RENDER` inside `src/components/AppShell.tsx`. Don't switch to file-based routing without discussion — too much UI is wired through `AppShell`.

## Commands (run inside `site/`)

| Command             | When to use                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Local dev server (http://localhost:3000)     |
| `npm run lint`      | ESLint                                       |
| `npm run typecheck` | `tsc --noEmit`                               |
| `npm run build`     | Production build                             |
| `npm run capture:screenshots` | Capture PII-free repo screenshots (server required) |
| `npm run test`      | Focused Node tests                          |
| `npm run check`     | lint + typecheck + test + build (before commit) |

## Releasing

Versioned with semver. The single source of truth is `site/package.json` (`version`);
keep it in sync with the README `## Changelog`.

To cut a release:

1. Bump `site/package.json` `version` and add a matching `## Changelog` entry in the
   README — in the **same commit** as the work being released.
2. Add `.github/release-notes/vX.Y.Z.md` with **What changed**, **Compatibility**,
   **Upgrade**, and any applicable **Known limitation** section. The release workflow
   publishes this file verbatim after the container image succeeds.
3. Run `npm run check` and commit.
4. After the commit is on `main`, tag it `vX.Y.Z` (strict semver, leading `v`) and push
   the tag. The GHCR workflow (`.github/workflows/docker-release.yml`) builds and
   publishes the multi-arch Docker image on native AMD64 and ARM64 runners, then
   assembles the release manifest — so **only tag once the release commit is merged**,
   and never reuse or move a published tag. If infrastructure interrupts a build,
   manually dispatch the same workflow with the existing immutable tag; it checks out
   that tag rather than rebuilding from the current branch.

`1.0.0` is the first stable release. From here, use
standard semver: patch for fixes, minor for backward-compatible features, major for
breaking changes. Tagging publishes a public image — treat it as irreversible.

## Honcho API conventions

Honcho v3 uses **POST for list endpoints** (filter body in JSON), not GET. Endpoints we care about:

- `POST /v3/workspaces/list` · `POST /v3/workspaces` · `PUT /v3/workspaces/{id}` · `DELETE /v3/workspaces/{id}`
- `GET  /v3/workspaces/{id}/queue/status` (poll ~10s on workspace detail)
- `POST /v3/workspaces/{id}/schedule_dream` · `POST /v3/workspaces/{id}/search`
- `POST /v3/workspaces/{id}/peers/list` · `POST /v3/workspaces/{id}/peers`
- `POST /v3/workspaces/{id}/sessions/list` (+ messages, summaries, context)
- `POST /v3/workspaces/{id}/scopes` · `POST /scopes/list` · membership `add / list / remove` · `GET /status` (Honcho 3.1+)
- `POST /v3/workspaces/{id}/sessions/{session_id}/messages/upload` (multipart file upload)
- `POST /v3/workspaces/{id}/conclusions/list` · `POST /v3/workspaces/{id}/conclusions/query` (semantic search)
- `POST /v3/workspaces/{id}/chat` (Honcho 3.1 workspace-wide memory chat)
- `POST /v3/workspaces/{id}/peers/{peer_id}/chat` (peer dialectic; accepts a named scope on Honcho 3.1+)
- `POST /v3/workspaces/{id}/webhooks`

Auth is `Authorization: Bearer <token>` header — optional in local dev (`AUTH_USE_AUTH=false`).

API client lives in `src/lib/honcho/`. **Never hardcode the base URL or token in components** — read from the config store. Config is stored client-side in `localStorage` under `honcho-dashboard:instances` + `honcho-dashboard:activeId` (multi-instance).

Use `@honcho-ai/sdk` 2.4+ for scopes, scope-aware search/context, peer scope
recall, and workspace chat. The raw scope-list call is reserved for the
side-effect-free compatibility probe; do not reintroduce raw 3.1 feature paths.

Honcho 3.1-only UI must use `useHonchoCapabilities()` from
`src/lib/honcho/useCapabilities.ts`. A known pre-3.1 server must not receive
scope or workspace-chat requests. Keep upgrade (`404` / `405`), restricted-key
(`401` / `403`), and unknown-version states distinct, and preserve the existing
unscoped workflow in every case.

Repository screenshots must contain synthetic data only. Follow `docs/SCREENSHOTS.md`
before replacing any image referenced by the README.

## Working rules

- **Real before pretty.** Wire a page to the API before adding new UI flourishes. A working CRUD beats another mock dashboard tile.
- **Loading / empty / error states are not optional.** Every fetch path renders all three. CLAUDE.md global rules apply: AI-generated code defaults to happy path — audit each new page for failure modes.
- **Don't delete the mocks.** Keep `src/lib/data.ts` until each page no longer imports from it; remove per-section as you migrate.
- **Follow the design guide.** `site/docs/research/DESIGN_GUIDE.md` is binding for every UI change — read it before touching components. Key rules: reuse `Panel`/`Modal`/atoms (never raw HTML controls or hand-rolled overlays), **all popups use `Modal`/`ConfirmModal` (never `window.prompt/confirm/alert`)**, booleans use `Checkbox` (not the broken `Toggle`), colors/type come from `@theme` tokens only, labels in `SCREAMING_SNAKE` and hints in sentence case. The `site-clone` branch is the canonical design baseline.
- **Mutations confirm before write.** Every create/update/delete/save against the live instance funnels through `useConfirm()` (`src/components/confirm.tsx`) and is gated by the `useWriteActions()` master toggle (`src/lib/writeActions.ts`, default off, set in CONFIG). Reads never confirm. New mutating UI must follow this — see DESIGN_GUIDE.md §4.
- **Hash router stays put** for now — too much UI is wired through `AppShell`; revisit only with discussion.
- **Run `npm run check` before reporting a task done.**

## Out-of-scope (for now)

- Tauri / desktop wrapper
- Auth UX beyond bearer token (no signup / org management)
- New animations on pages still using mock data
- Switching to file-based routing or pnpm/Turbo monorepo

## Where to look first

- `site/src/components/AppShell.tsx` — routing + layout
- `site/src/lib/data.ts` — every mock you need to replace
- `site/src/types/honcho.ts` — domain types (extend, don't fork)
- `site/src/components/pages/*` — one file per route; this is where wiring happens
- `site/docs/research/DESIGN_GUIDE.md` — **binding** visual-system contract (read before any UI change); `BEHAVIORS / COLOR_AUDIT / DROPDOWN` — per-page + component specs

## Design context (impeccable)

- `PRODUCT.md` (repo root) — strategic context: register (`product`), users, purpose, brand personality, anti-references, design principles, accessibility commitments. Read it before design work.
- `DESIGN.md` (repo root) — visual system in impeccable format (palette, type, components), scanned from the real `@theme` tokens + components. The binding day-to-day contract is still `site/docs/research/DESIGN_GUIDE.md`; DESIGN.md is its strategic sibling for design tooling.
- The `/impeccable` skill reads both. Run `/impeccable critique <surface>` or `/impeccable audit <area>` for reviews; `/impeccable live` for in-browser variants (configured in `.impeccable/live/config.json`).
