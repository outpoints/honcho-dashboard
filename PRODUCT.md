# Product

## Register

product

## Users

Engineers and operators running a self-hosted Honcho memory server — often the
same person who deployed it. They're technical, comfortable in terminals and
IDEs, and privacy-conscious (self-hosting is the whole point). They may manage
multiple instances. Their context: inspecting and operating their own Honcho
instance — browsing the memory graph (workspaces → peers → sessions → messages →
conclusions), running semantic search, chatting with a peer using its memory,
scheduling dreams, and watching runtime / db / queue health — without dropping
to raw SQL or curl.

## Product Purpose

A fast, privacy-first web control panel for a self-hosted Honcho memory server —
a Next.js alternative to openconcho. Every screen talks to the live Honcho v3
API through a same-origin, allowlisted proxy, and a read-only operator layer
(runtime, db, logs, diagnostics) surfaces metrics the REST API doesn't expose.
Success: an operator runs their entire Honcho instance from this dashboard,
trusts what it shows, and never needs SQL or curl for routine work.

## Brand Personality

Terminal-native, precise, and unobtrusive. Three words: precise,
terminal-native, restrained. The interface reads like an IDE / control panel,
not a consumer SaaS product: monospace throughout, SCREAMING_SNAKE labels,
sentence-case hints, a single blue accent, flat and square. The emotional goal
is confidence and control — the tool is fast, honest, and stays out of the way.

## Anti-references

- Consumer-SaaS dashboard gloss: rounded cards, drop shadows, gradients, pastel
  illustrations, marketing-site polish applied to an operator tool.
- The hero-metric template (big gradient stat tiles) and identical icon-card grids.
- Faking data Honcho doesn't expose — no invented per-message status chips, no
  fake archive / pause / process-all buttons. Honesty beats a prettier-but-false UI.
- Glassmorphism, gradient text, side-stripe accent borders, decorative motion.
- Adding flourish to any screen still on mock data (real before pretty).

## Design Principles

1. **Real before pretty.** Wire a screen to the live API before adding UI
   flourish. A working CRUD beats another mock dashboard tile.
2. **Three states are the contract.** Every data path renders loading (skeleton),
   empty (a state that teaches the interface), and error (with a pointer to config).
   No happy-path-only screens.
3. **Honesty over flattery.** Show only what Honcho actually exposes; degrade
   gracefully when the operator DB isn't wired. Never fake a metric or a control.
4. **Reuse the primitives.** New screens compose Panel / Modal / atoms and @theme
   tokens — never parallel shells or raw HTML controls. Consistency is the feature.
5. **Stay out of the way.** Terminal-native restraint — dense, low-chrome, subtle
   motion. The tool disappears into the operator's task.

## Accessibility & Inclusion

- **WCAG AA contrast (firm).** Body text ≥4.5:1, large / UI text ≥3:1 against its
  background, enforced across the dark palette. Audit muted text especially:
  `text-text-muted` (#737373) on `bg-surface` (#0a0a0a) measures ≈4.2:1, just
  under AA for body-sized (12px) copy — bump toward the ink end where it carries
  real content.
- **Light/dark toggle (firm, near-term).** On the parity checklist. Treat the
  palette as themeable — semantic tokens that can swap, not hardcoded dark values.
- **Keyboard + focus (firm).** Full keyboard operability and visible focus states
  on every interactive control (Modal, Select, Tabs, buttons, Checkbox).
- **Reduced motion (recommended).** Pair each Framer Motion animation with a
  `prefers-reduced-motion: reduce` alternative (crossfade / instant). Cheap given
  motion is already subtle.
