# Honcho Self-Host Dashboard — Behaviors

## Global Layout
- **Body bg:** `#050505` (`--color-void`)
- **Surface bg:** `#0a0a0a` (`--color-surface`) — cards, sidebar
- **Border:** `#1a1a1a` (`--color-border`), border-light `#262626`
- **Text:** primary `#ededed`, muted `#737373`
- **Accent:** `#3c82f7` (blue), secondary `#a6c6e6`
- **Fonts:** JetBrains Mono (400/500/600/700) + VT323 (pixel, for big numbers/titles)
- **No smooth scroll library** — native scroll
- **Fixed canvas** at `inset-0 z-0 pointer-events-none` — dark grid pattern (rgb 17–26), approx 5px grid
- **`.grid-bg`** class on root div — supplemental CSS grid pattern
- **No CSS variables** in `:root` for runtime theming (all tokens compiled into Tailwind config)

## Page Topology
SPA with 12 nav routes, all rendered into the same shell:
1. `OVERVIEW` (default)
2. `WORKSPACES`
3. `PEERS`
4. `SESSIONS`
5. `MESSAGES`
6. `REASONING` (badge: 4)
7. `CONTEXT`
8. `WEBHOOKS`
9. `INSTANCE`
10. `DIAGNOSTICS` (4 inner tabs)
11. `INTEGRATIONS` (4 agents × 4 sub-tabs)
12. `CONFIG`

Layout structure (matches DOM):
```
body
  div#root
    div.min-h-screen.grid-bg.flex
      canvas.fixed.inset-0.z-0.pointer-events-none      ← background canvas
      aside.hidden.md:sticky.md:top-0.md:h-screen.md:flex.shrink-0.bg-surface.border-r.border-border.flex-col.w-48.relative.z-10
        div.p-3.border-b.border-border        ← logo + label header
        nav (12 menu items)
        div.p-3.border-t.border-border        ← instance_status mini panel
      div.flex-1.flex.flex-col.min-w-0.relative.z-10
        header.h-12.bg-surface.border-b.border-border.flex.items-center.justify-between.px-3.sm:px-4.relative.gap-3
        main.flex-1.p-3.sm:p-4.overflow-auto
          div                              ← page title area + content + bottom status bar
      div.fixed.bottom-4.right-4.z-50      ← (empty toast container)
```

## Header (h-12)
- Breadcrumb left: `terminal-icon  honcho / self-hosted / <current>` (last segment in accent blue)
- Search center: `search peers, sessions...` input + `⌘K` chip on right of input
- Right: bell icon (with small blue unread dot top-right), `admin` chip with user icon
- The breadcrumb's segments are buttons; the last one is non-clickable accent

## Sidebar (w-48)
- Logo button (top): 24×24 logo `img` + two-line label `HONCHO` (bold uppercase) / `SELF-HOSTED` (muted)
- 12 nav items: each is a button with icon + uppercase label; some have right-aligned badge (REASONING shows "4")
- Active item: `text-accent bg-accent/10` + a `> ` prefix in label and a blinking `█` cursor suffix
- Bottom block (border-t): `> instance_status` heading + 4 key/value rows (status, peers, queue, version)

## Status Bar (bottom of every page main)
- `mt-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface border border-border text-[10px] font-mono`
- Left: `■ instance: healthy | workspaces: 3 | peers: 1,304 | queue: 4 pending`
- Right: `postgres: connected | honcho: v3.0.5`

## Card Window Chrome
Every panel card has this header bar (`flex items-center justify-between px-3 py-2 border-b border-border`):
- Left: `■` (w-2 h-2 bg-accent square) + `[ TITLE ]` (text-muted, text-xs)
- Right: `─ □ ×` (three muted spans, text-xs)

Card body: `p-3` wrapper

## Section Title Bar (every page)
```
div.flex.flex-wrap.items-center.justify-between.gap-4.mb-4
  div.flex.items-center.gap-3
    h1.font-pixel.text-2xl.text-text-primary.tracking-wider   ← PAGE_NAME (VT323, uppercase)
    span.text-[10px].text-text-muted.bg-border.px-2.py-0.5   ← v3.0.5 badge
    span.flex.items-center.gap-1.px-1.5.py-0.5.bg-accent/10.border.border-accent/30   ← SELF-HOSTED chip with dot
      span.w-1.5.h-1.5.bg-accent
      span.text-[9px].text-accent.uppercase.tracking-wider
  div                  ← clock OR action buttons (e.g., REFRESH, RUN_CHECKS, NEW_X)
    span / button(s)
```
Subtitle line under heading: `> <prose>` in muted text-xs.

## Time Updates
- All page title bars show a live clock at top-right (e.g., `01:35:24`) that updates every second.
- Card timestamps show "last_updated: HH:mm:ss" or similar in muted text.

## OVERVIEW page
- 4-col stat grid: TOTAL_PEERS (1,304 / "across all workspaces"), ACTIVE_SESSIONS (3 / "5 total"), TOTAL_MESSAGES (252.6k / "+2.4k today"), CONCLUSIONS (90.5k / "4 reasoning pending")
- Two-column grid (8 / 4 lg):
  - Left col: MESSAGE_THROUGHPUT chart card, 3-stat sub-cards (WORKSPACES/PEERS/REASONING_QUEUE click-to-manage), REASONING_ACTIVITY heatmap card
  - Right col: RECENT_SESSIONS list, INSTANCE_STATUS panel
- MESSAGE_THROUGHPUT card body:
  - Top row: `> REAL-TIME MEMORY OPERATIONS` label + `■ LIVE` chip; right: 1H/6H/24H/7D pill toggles
  - Big number `4,819` + `+13.6% vs prev period` accent
  - 4 inline stat tiles (READS 3,079, WRITES 1,740, AVG_LATENCY 18.4ms, PEAK_OPS 246) — each with small icon
  - SVG line chart (viewBox 0 0 776.66 280): area fill + stroke for READS (#60A5FA, w 1.5), area + stroke for WRITES (#3C82F7, w 2), grid lines #1A1A1A, x-axis line #262626, 8 axis labels
  - Bottom: legend pills READS / WRITES / DELETES + "last_updated:" timestamp
- REASONING_ACTIVITY card body:
  - `> 52 week reasoning passes heatmap` label
  - Right: `total: 16,948` `avg: 46.6` `peak: 99` (numbers in primary)
  - Grid of 52 cols × 7 rows = 364 cells, each w-2.5 h-2.5 with varying bg-accent opacity (0..100)
  - Legend bottom: `less ▢▢▢▢▢ more` + `52 weeks · 7 days`

## WORKSPACES page
- Subtitle: `> top-level containers for organizing peers, sessions, and data`
- Top-right action: `+ NEW_WORKSPACE` (blue outline button)
- 3-card grid (md:grid-cols-2 lg:grid-cols-3): each card has window chrome + stats + config keys + VIEW_PEERS button row + gear + trash + footer (created/id)

## PEERS page
- Subtitle: `> users and agents that interact within sessions`
- Top-right action: `+ NEW_PEER`
- Filter row: search input (flex-1) | `workspace: [all ▼]` dropdown | `[ALL][USER][AGENT]` segmented toggle
- Peer rows (stacked, gap-2): icon tile | name @workspace | REASONING chip (optional, only for users w/ reasoning) | row of muted stats (sessions/msgs/conclusions) | right: `last active` label + datetime | gear icon | chevron-right

## SESSIONS page
- Subtitle: `> interaction threads between peers within workspaces`
- Top-right: `+ NEW_SESSION`
- Filter row: search | workspace dropdown | `[ALL][ACTIVE][IDLE][ARCHIVED]` segmented toggle
- Session rows: branch icon | sess_id @workspace | status chip (ACTIVE blue / IDLE yellow / ARCHIVED muted) | SUMMARY chip (optional) | stats (peers / msgs / tokens) | right: avatar stack | last message label + datetime | chevron-right
- Click a session row → expands inline below to show SESSION_PEERS (removable chips), RECENT_MESSAGES (4 inline message preview), config row, action buttons (VIEW_MESSAGES / ARCHIVE / REMOVE_SESSION)

## MESSAGES page
- Subtitle: `> view and create messages within sessions`
- Filters: search content | `session: [all_sessions ▼]` | filter icon | `[all_reasoning ▼]`
- 2-col grid (8/4): left MESSAGE_STREAM (scrollable), right COMPOSE_MESSAGE + MESSAGE_STATS
- MESSAGE_STREAM rows: avatar tile (user or bot) | name + sess_id + datetime | content body (sql blocks shown) | status chip (completed green / skipped muted / processing) + tokens + #msg_id
- Has a colored vertical left border per message (blue/purple variants)
- Compose panel empty state: pencil icon + "Select a session to compose messages"
- MESSAGE_STATS card: total_displayed / pending_reasoning / processing / completed

## REASONING page
- Subtitle: `> background inference tasks that build peer representations`
- Top-right: `PAUSE_QUEUE` + `▶ PROCESS_ALL` (blue)
- 5-card stat row: QUEUED 3 / PROCESSING 1 (highlighted blue) / COMPLETED 2 / FAILED 1 (red) / TOKENS_PENDING 7,442
- Filter row: `status: [all ▼]` / `type: [all ▼]` / `workspace: [all ▼]`
- 2-col grid (8/4): left REASONING_QUEUE (rows with status icon + type chip + peer + msgs + tokens + time + close X for cancelable, error rows highlighted red with error msg), right REASONING_TYPES legend (EXP/DED/IND/ABD/SUM/PCD/CON each with color-coded chip + description), CONCLUSIONS_STATS (counts by type), BATCHING_CONFIG

## CONTEXT page
- Subtitle: `> assemble LLM-ready context from peer representations, conclusions, summaries, and messages`
- Right of subtitle: `📚 4,650 / 4,000 tokens` (red over-limit indicator)
- Filter row: `SESSION [all_sessions ▼]` | `PEER [all_peers ▼]` | `TOKEN_LIMIT [slider 0-???] [4000]` | `GENERATE_CONTEXT` (blue)
- 2-col grid: left CONTEXT_LAYERS (4 layer rows with icon + name + token count + items + eye-toggle + visual bar), right CONTEXT_PREVIEW (empty state with eye icon), HOW_CONTEXT_WORKS (PCD/CON/SUM/MSG legend), LAYER_STATS
- Below layers card: `total_enabled 4,650 / 4,000 tokens` red bar overflow warning

## WEBHOOKS page
- Subtitle: `> webhook endpoint management for self-hosted Honcho instance`
- Top-right: `+ NEW_WEBHOOK`
- 3-stat row: ACTIVE 2 / INACTIVE 1 / FAILURES 7 (yellow/red)
- WEBHOOK_ENDPOINTS card: URL + event chips + last/created timestamps + (optional) `⚠ N failures` chip + actions: power/edit/trash
- Bottom 2-col: EVENT_TYPES (bullet list) + SELF_HOSTED_INFO

## INSTANCE page
- Subtitle: `> self-hosted Honcho instance status and management`
- Top-right: `↻ REFRESH`
- Big status banner: green check + `ALL_SYSTEMS_OPERATIONAL` + "Last checked..." + right: uptime
- 2-col (8/4): left SERVICE_STATUS (6 service cards in 2-col grid: api_server, postgres, reasoning_workers, vector_store, background_queue, storage; each with HEALTHY chip), INSTANCE_STATS (workspaces/peers/sessions/messages/conclusions/db_size/vectors/queue in 4-col), right VERSION_INFO, ADMIN_ACTIONS (EXPORT_BACKUP / REINDEX_VECTORS / FLUSH_CACHE buttons + timestamps), CONNECTION_INFO

## DIAGNOSTICS page
- Subtitle: `> troubleshooting and health monitoring for self-hosted Honcho`
- Top-right: `↻ RUN_CHECKS`
- Yellow banner: `⚠ 2 WARNINGS - REVIEW RECOMMENDED` + `10/12 checks passing` + right chips: `✓ 10  ⚠ 2  ✗ 0`
- Tab bar: `[✓ HEALTH_CHECKS] [>_ LOGS] [⚙ CONFIG_VALIDATION] [📋 TROUBLESHOOTING]` (active has accent underline+bg)
- HEALTH_CHECKS: 3-col grid of 12 check cards (each with status icon + name + description + timing + timestamp; warning cards have yellow border)
- LOGS: SYSTEM_LOGS card with search input + `[all levels ▼]` + `[all sources ▼]` + entries count; rows with timestamp + level chip + source + message + chevron (clickable for expand)
- CONFIG_VALIDATION: rows with check icon + key + REQUIRED chip + category chip + status + value (right)
- TROUBLESHOOTING: `category:` filter pills + expandable accordion entries with chevron

## INTEGRATIONS page
- 4 agent cards in horizontal tab row: `Hermes / OpenClaw / Claude Code / MCP` (each with avatar icon, name, active one highlighted)
- Right: `Search integrations...` + `</> DOCS` button
- Below: agent detail panel — `Avatar | Name + role chip | description | feature pills`
- 4 sub-tabs: `Overview / Tools / Setup / Self-Hosted`
- OVERVIEW: 2-col (Purpose+WhereFits / MCP Compatibility+Configuration)
- TOOLS: 2-col grid of tool cards (icon + name + description, with LLM chip on some)
- SETUP: numbered steps list + configuration options table
- SELF-HOSTED: 4-col req cards (endpoint/auth/protocol/api_key) + setup notes + JSON config block
- Bottom: SELF_HOSTED_REQUIREMENTS + QUICK_LINKS cards
- Each agent has theme color: Hermes=blue, OpenClaw=red, Claude=red/orange, MCP=blue

## CONFIG page
- Subtitle: `> instance configuration and settings`
- 2-col grid: left 4 config cards (LLM_CONFIGURATION, REASONING_CONFIGURATION, DATABASE_CONFIGURATION, FEATURE_FLAGS), right CURRENT_CONFIG summary + CONFIG_HIERARCHY + ENVIRONMENT vars
- LLM_CONFIGURATION: dropdown + text input; REASONING_CONFIGURATION: 3 number inputs; DATABASE_CONFIGURATION: postgres_url input; FEATURE_FLAGS: toggle switches per flag

## Modal Pattern
- Centered card, ~720px wide, on dark overlay (rgba(0,0,0,0.6) backdrop + blur)
- Header: `[ TITLE ]` (accent square + muted text) | `×` close
- Body: form fields w/ labels, sometimes pill selectors
- Footer: `CANCEL` (muted outline) + primary action (blue solid)
- Esc closes
- Form variants seen: CREATE_WORKSPACE, CREATE_PEER, CREATE_WEBHOOK, CREATE_SESSION (multi-step wizard with breadcrumbs `1. WORKSPACE — 2. PEERS`)

## Interactive
- Active nav item has `█` cursor blink at end of label (typewriter effect)
- Cards do not visually animate on hover (constant)
- Buttons hover: `bg-accent → hover:text-void` invert pattern
- Stat values use VT323 (pixel) font; everything else JetBrains Mono
- Time clock updates every second
- Chart timeframe (1H/6H/24H/7D) clicked → re-renders chart data
