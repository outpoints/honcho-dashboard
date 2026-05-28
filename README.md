# Honcho Self-Hosted Dashboard

Self-hosted Honcho dashboard built with Next.js 16, Tailwind CSS v4, and Framer Motion.

The Next.js app lives in [`site/`](./site).

## Quick start

```bash
cd site
npm install
npm run dev
```

Open <http://localhost:3000>.

## Repo layout

```
.
├── site/              # Next.js application
│   ├── src/           # app routes, components, lib, types
│   ├── public/        # images, fonts, seo
│   ├── docs/research/ # BEHAVIORS / COLOR_AUDIT / DROPDOWN specs
│   └── package.json
├── .github/workflows/ # CI (runs inside site/)
└── LICENSE            # GPL-3.0
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

- **Next.js 16** (App Router, React 19, TypeScript strict)
- **Tailwind CSS v4** with custom `@theme` tokens
- **Framer Motion** for entrance / hover / tap / layout animations
- **Lucide React** icons
- **JetBrains Mono** + **VT323** fonts via `next/font/google`

## Routes

Hash-based router inside `AppShell`: `#/overview`, `#/workspaces`, `#/peers`, `#/sessions`,
`#/messages`, `#/reasoning`, `#/context`, `#/webhooks`, `#/instance`, `#/diagnostics`,
`#/integrations`, `#/config`.

## License

GPL-3.0
