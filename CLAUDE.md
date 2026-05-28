# CLAUDE.md — honcho-dashboard

## North star

Build a **Next.js alternative to [openconcho](https://github.com/offendingcommit/openconcho)** — a fast, privacy-first web UI for a self-hosted Honcho memory server. Same job, different stack: browse workspaces / peers / sessions / messages / conclusions, and chat with peers using their memory as context.

Today the site is a polished UI shell with **hardcoded mock data**. The job is to make every page talk to a real Honcho `v3` API and reach feature parity with openconcho before adding anything new.

Reference repo: <https://github.com/offendingcommit/openconcho> (React + Vite + TanStack Router + Tauri).

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
| `npm run check`     | lint + typecheck + build (run before commit) |

## Honcho API conventions

Honcho v3 uses **POST for list endpoints** (filter body in JSON), not GET. Endpoints we care about for parity:

- `POST /v3/workspaces/list` · `POST /v3/workspaces` · `PUT /v3/workspaces/{id}` · `DELETE /v3/workspaces/{id}`
- `GET  /v3/workspaces/{id}/queue/status` (poll ~10s on workspace detail)
- `POST /v3/workspaces/{id}/schedule_dream` · `POST /v3/workspaces/{id}/search`
- `POST /v3/workspaces/{id}/peers/list` · `POST /v3/workspaces/{id}/peers`
- `POST /v3/workspaces/{id}/sessions/list` (+ messages, summaries, context)
- `POST /v3/workspaces/{id}/conclusions/list` · `POST /v3/workspaces/{id}/conclusions/query` (semantic search)
- `POST /v3/workspaces/{id}/chat` (memory-augmented chat — peer is the implicit observer)
- `POST /v3/workspaces/{id}/webhooks`

Auth is `Authorization: Bearer <token>` header — optional in local dev (`AUTH_USE_AUTH=false`).

API client lives in `src/lib/honcho/`. **Never hardcode the base URL or token in components** — read from the config store. Config is stored client-side in `localStorage` under `honcho-dashboard:instances` + `honcho-dashboard:activeId` (multi-instance, matches openconcho's UX).

## Parity checklist vs openconcho

- [ ] Multi-instance config (localStorage) + Test Connection
- [ ] Workspaces list / detail / create / edit / delete — real API
- [ ] Queue-status polling on workspace detail
- [ ] Peers list + peer detail (representation, peer card, search-within-peer)
- [ ] Sessions list + session detail (messages, summaries, context tabs)
- [ ] Conclusions browser + **semantic search**
- [ ] **Memory-augmented chat** screen per peer (currently missing)
- [ ] Webhooks CRUD
- [ ] Workspace-wide search
- [ ] Pagination on every list page
- [ ] Light/dark theme toggle (today is dark-only)
- [ ] Deep-link friendly URLs (acceptable while hash routing; revisit if we ever Tauri-wrap)

When the checklist closes we are at parity; only then start divergent features.

## Working rules

- **Real before pretty.** Wire a page to the API before adding new UI flourishes. A working CRUD beats another mock dashboard tile.
- **Loading / empty / error states are not optional.** Every fetch path renders all three. CLAUDE.md global rules apply: AI-generated code defaults to happy path — audit each new page for failure modes.
- **Don't delete the mocks.** Keep `src/lib/data.ts` until each page no longer imports from it; remove per-section as you migrate.
- **Don't break the visual system.** Spacing, panel borders, monospace voice are intentional — see `docs/research/`. Match `atoms.tsx` / `Panel.tsx` rather than inventing new shells.
- **Hash router stays put** until parity is done.
- **Run `npm run check` before reporting a task done.**

## Out-of-scope (for now)

- Tauri / desktop wrapper (openconcho has it; we don't)
- Auth UX beyond bearer token (no signup / org management)
- New animations on pages still using mock data
- Switching to file-based routing or pnpm/Turbo monorepo

## Where to look first

- `site/src/components/AppShell.tsx` — routing + layout
- `site/src/lib/data.ts` — every mock you need to replace
- `site/src/types/honcho.ts` — domain types (extend, don't fork)
- `site/src/components/pages/*` — one file per route; this is where wiring happens
- `site/docs/research/` — UX behaviors locked down before the rebuild
