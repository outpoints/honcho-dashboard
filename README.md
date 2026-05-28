# Honcho Self-Hosted Dashboard

A self-hosted operator dashboard for [Honcho](https://honcho.dev). Built with Next.js 16,
Tailwind CSS v4, Framer Motion, and the official [`@honcho-ai/sdk`](https://www.npmjs.com/package/@honcho-ai/sdk).

The Next.js app lives in [`site/`](./site).

## Architecture

Three layers, each with a single job:

1. **`@honcho-ai/sdk` — native data flows.**
   Workspaces, peers, sessions, messages, conclusions queries, contexts, chat, queue
   status, dream scheduling, search — everything the SDK exposes goes through it.
   See `site/src/lib/honcho/sdk.ts` for the per-(instance, workspace) client cache.

2. **A thin raw client — only for verified SDK gaps.**
   Files: `site/src/lib/honcho/client.ts`. Only endpoints the SDK doesn't reach are
   exposed there, each labeled with its gap reason:
   - `/health`, `/openapi.json` — not in SDK
   - Workspace `list / create / delete` — the SDK is workspace-scoped and
     get-or-creates on first use, which is the wrong UX for management screens
   - Workspace-wide conclusion `list / query / delete` — SDK organizes
     conclusions by `(observer, observed)` peer pair
   - Webhook `list / create / delete / test` — no SDK methods

3. **Operator modules — for self-hosted runtime, db, config, logs, diagnostics.**
   `site/src/lib/operator/*` + `site/src/app/api/operator/*` route handlers.
   These are the metrics Honcho's REST API does not expose (uptime, db size,
   pgvector status, throughput timeseries, log tail, etc.). They read the same
   Postgres database Honcho uses **read-only** — Honcho itself is not modified.
   Every module degrades to `{ available: false, reason: ... }` when its
   configuration env var is not set, so the UI renders cleanly without them.

   | Module                  | Env required                  | What it exposes |
   |-------------------------|-------------------------------|-----------------|
   | `runtime`               | none (`HONCHO_RUNTIME_START_TS` optional) | dashboard uptime, Node version, optional Honcho uptime |
   | `db`                    | `HONCHO_DATABASE_URL`         | db size, pgvector status, table sizes, throughput buckets, 52-week heatmap, conclusion stats |
   | `logs`                  | `HONCHO_LOG_FILE`             | tail of Honcho log file (JSON or plain) |
   | `config`                | none                          | safe env-var snapshot (secrets redacted) |
   | `diagnostics`           | combines all of the above     | composite probe with timings and per-category status |

### Request routing

The browser never talks to Honcho directly — every Honcho call goes through the same-origin
proxy at `/api/honcho/[...path]` so there is no CORS dance and so the proxy can enforce a
**server-side allowlist** of upstream Honcho URLs (`HONCHO_PROXY_ALLOWED_BASES`). This applies
to both the SDK and the raw client; the SDK is configured with `baseURL = window.location.origin + "/api/honcho"`.

## Quick start (local dev)

```bash
cd site
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_HONCHO_BASE_URL
npm run dev
```

Open <http://localhost:3000>.

## Quick start (Docker)

```bash
docker compose up --build
```

A minimal `docker-compose.yml` is included at the repo root. To wire the operator modules,
set these in the environment that runs Compose:

```bash
HONCHO_BASE_URL=http://honcho:8000              # base URL the dashboard proxies to
HONCHO_DATABASE_URL=postgresql://...            # read-only Postgres DSN (operator/db)
HONCHO_LOG_FILE=/var/log/honcho/honcho.log      # mounted in container (operator/logs)
HONCHO_RUNTIME_START_TS=2026-05-22T00:00:00Z    # optional, lets us report Honcho uptime
HONCHO_PROXY_ALLOWED_BASES=http://honcho:8000   # multi-instance allowlist
```

The dashboard container exposes port `3000`. If you co-locate it with Honcho on the same
Docker network, the proxy can talk to Honcho via the internal service name.

## Repo layout

```
.
├── site/                       # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/honcho/[...path]/route.ts   # same-origin proxy w/ allowlist
│   │   │   └── api/operator/{runtime,db,config,logs,diagnostics}/route.ts
│   │   ├── components/         # AppShell + pages
│   │   ├── lib/
│   │   │   ├── honcho/         # sdk.ts, client.ts (gaps), adapters.ts, config.ts, useQuery.ts
│   │   │   └── operator/       # runtime.ts, db.ts, logs.ts, config.ts, diagnostics.ts, client.ts
│   │   └── types/honcho.ts
│   ├── docs/research/          # BEHAVIORS / COLOR_AUDIT / DROPDOWN specs
│   ├── Dockerfile              # multi-stage build (node:24-alpine, standalone output)
│   ├── .env.example
│   └── package.json
├── docker-compose.yml          # dashboard + (optional) Honcho on the same network
├── CLAUDE.md
├── .github/workflows/          # CI runs inside site/
└── LICENSE                     # GPL-3.0
```

## Scripts (run inside `site/`)

| Command             | Description                |
| ------------------- | -------------------------- |
| `npm run dev`       | Start the dev server       |
| `npm run build`     | Production build           |
| `npm run start`     | Run the production build   |
| `npm run lint`      | ESLint                     |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm run check`     | lint + typecheck + build   |

## Stack

- **Next.js 16** (App Router, React 19, TypeScript strict, standalone output)
- **`@honcho-ai/sdk`** v2 for native Honcho data flows
- **`pg`** for the read-only operator DB connection
- **Tailwind CSS v4** with custom `@theme` tokens
- **Framer Motion** for entrance / hover / tap / layout animations
- **Lucide React** icons
- **JetBrains Mono** + **VT323** fonts via `next/font/google`

## Routes

Hash-based router inside `AppShell`: `#/overview`, `#/workspaces`, `#/peers`, `#/sessions`,
`#/messages`, `#/reasoning`, `#/context`, `#/webhooks`, `#/instance`, `#/diagnostics`,
`#/integrations`, `#/config`.

## Credits

- **Original dashboard design** by **nodaylight** (Discord) — the visual
  language, layout, and component aesthetic this project rebuilds against the
  live Honcho API are based on the demo at
  <https://honcho-dashboard-gamma.vercel.app/>.
- **[`@honcho-ai/sdk`](https://www.npmjs.com/package/@honcho-ai/sdk)** — the
  official TypeScript SDK from the Honcho team powers every native data flow
  in this dashboard (workspaces, peers, sessions, messages, contexts, chat,
  queue, search, dream scheduling). The thin raw client at
  `site/src/lib/honcho/client.ts` is only used for endpoints the SDK doesn't
  cover (health, `/openapi.json`, workspace create/list/delete, workspace-wide
  conclusions, webhooks).
- **[Honcho](https://honcho.dev)** — the self-hosted memory server this is
  a dashboard for.

## License

GPL-3.0
