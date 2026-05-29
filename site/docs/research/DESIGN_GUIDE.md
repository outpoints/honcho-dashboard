# DESIGN_GUIDE — honcho-dashboard

**Binding.** Every UI change must follow this guide. It is the consolidated visual-system
contract; the per-page/functional specs (`BEHAVIORS.md`), color extraction (`COLOR_AUDIT.md`),
and dropdown spec (`DROPDOWN.md`) sit alongside it.

**Source of truth:** the design baseline is the `site-clone` git branch. Its core design files —
`src/app/globals.css`, `src/components/{Modal,Panel,ConfirmModal,atoms}.tsx` — are the canonical
implementation. If a change would diverge from them, stop and reconcile first. New screens **reuse**
these primitives; they do not invent parallel shells.

Aesthetic in one line: **a dark, monospace, terminal/IDE-style control panel** — flat, square,
bordered, low-chrome, with a single blue accent and restrained motion.

---

## 1. Tokens — never hardcode

All color/typography comes from `@theme` tokens in `globals.css`. Use the Tailwind classes that map
to them (`bg-surface`, `text-text-muted`, `border-border`, `text-accent`, …). **Never** introduce a
raw hex/rgb literal or an off-palette Tailwind color (`bg-gray-800`, `text-blue-600`, etc.).

| Role | Token / class | Value |
|---|---|---|
| Page background | `bg-void` | `#050505` |
| Panel / card / modal surface | `bg-surface` | `#0a0a0a` |
| Default border | `border-border` | `#1a1a1a` |
| Hover / emphasized border | `border-border-light` | `#262626` |
| Primary text | `text-text-primary` | `#ededed` |
| Muted / secondary text | `text-text-muted` | `#737373` |
| Accent (the only brand color) | `text-accent` / `bg-accent` | `#3c82f7` |
| Semantic | `red/orange/yellow/cyan/blue/purple/pink-{300..500}` | for status only |

**Fonts:** body & UI are `--font-mono` (JetBrains Mono) — already the default; don't set font
families per-component. `--font-pixel` (VT323, class `font-pixel`) is reserved for large stat numerals
(`StatTile`). **Type scale:** UI text is small — default to `text-xs` (12px) and the `text-[NNpx]`
escape hatch already in use (`text-[11px]`, `text-[10px]`, `text-[9px]`). Don't use `text-sm`+ for
chrome; reserve larger sizes for headings/values.

---

## 2. Voice & naming

- **Labels, buttons, tab names, panel titles, field labels → `SCREAMING_SNAKE_CASE`**
  (`SCHEDULE_DREAM`, `WORKSPACE_CONFIG`, `PEER_ID`, `VIEW_PEERS`, `NEW_WORKSPACE`).
- **Descriptions, hints, helper text, empty-state copy → sentence case**, muted, small
  (`text-text-muted`, `text-[10px]`/`text-[11px]`).
- Panel/modal titles render inside brackets via the component chrome (`[ TITLE ]`) — pass the bare
  `SCREAMING_SNAKE` string, the bracket is added for you.
- Monospace identifiers (ids, URLs) use `font-mono` and usually `text-accent`.

---

## 3. Layout primitives

- **`Panel`** (`components/Panel.tsx`) is the section container everywhere: titled header with a
  status dot + `─ □ ×` window chrome, `bg-surface border border-border`, `p-3` body. Group related
  content — including form sections inside a modal — in `Panel`s. Use `status="idle"` for neutral
  sections, `"active"` (default, accent dot) for live ones, `"processing"` (pulsing) for in-flight.
- **Page shell:** `PageHeader` (title + subtitle + right-aligned `actions`) at top, content in
  `space-y-3`, `StatusBar` at the bottom of every page. Match an existing page (`WorkspacesPage`,
  `ReasoningPage`) rather than reinventing.
- **Spacing:** vertical rhythm is `space-y-3` between blocks, `space-y-1.5`/`gap-2` inside. Flat and
  square — **no `rounded-*`**, no drop shadows except the modal's, no gradients.

---

## 4. Popups & modals — MANDATORY pattern

> **Every popup uses the `Modal` component** (`components/Modal.tsx`). This is non-negotiable.

- **Never** use `window.prompt`, `window.confirm`, `window.alert`, or a hand-rolled
  `fixed inset-0` overlay. (This is exactly the Schedule-Dream regression we fixed — a native
  `window.prompt` instead of a `Modal`.)
- `Modal` gives you: backdrop (`bg-void/80 backdrop-blur-sm`), centered `bg-surface` card
  (`max-w-2xl` default; pass `className="max-w-3xl"` to widen), `[ TITLE ]` header with close `×`,
  Escape-to-close, and a footer slot.
- **Footer convention:** right-aligned, secondary action first then primary, e.g.
  `<Button variant="secondary">CANCEL</Button>` + `<Button variant="primary">SAVE</Button>`.
  Disable both while the request is in flight and show a progress label (`SAVING…`, `SCHEDULING…`).
- **Destructive confirmations → `ConfirmModal`** (`components/ConfirmModal.tsx`), not a bare `Modal`.
- Tall content scrolls inside the body (`max-h-[60vh] overflow-y-auto`), the footer stays pinned.

Canonical examples to copy: `EDIT_PEER` (PeersPage), `WORKSPACE_CONFIG` (WorkspaceConfigModal),
`CREATE_WORKSPACE` (WorkspacesPage), `SCHEDULE_DREAM` (ReasoningPage).

---

## 5. Forms & inputs — use the atoms, not raw HTML

Build forms from `atoms.tsx`. Don't drop in unstyled `<input>`/`<button>`/`<select>`.

| Need | Use | Notes |
|---|---|---|
| Labeled field wrapper | `Field` | `label` (SCREAMING_SNAKE) + optional `hint` (sentence case) |
| Text / number input | `TextInput` | `bg-void border-border`, focus → `border-accent` |
| Multiline | `<textarea>` with the shared classes | copy from an existing modal verbatim |
| Boolean / on-off | **`Checkbox`** | square, accent-filled, with label + optional hint |
| Dropdown | `Select` | see `DROPDOWN.md`; never a native `<select>` |
| Segmented choice | `ToggleButton` (pills) or `PillTabs` | e.g. type filters, FORM↔JSON |
| Tabbed sections | `Tabs` | underline-style |

**Booleans use `Checkbox`.** The `Toggle` (switch) atom is unused and currently renders incorrectly
(knob/label overlap) — do **not** use it until it is fixed. For settings that have a server default,
show the effective value, mark inherited state with a muted `Chip` (`default`), and offer a `reset`.

---

## 6. Buttons

`Button` (`atoms.tsx`) only. Variants (see `COLOR_AUDIT.md` for exact colors):
`primary` (accent outline → fills on hover), `solid` (filled accent), `secondary`/`ghost` (muted,
for cancel/low-emphasis), `outline`, `warning`/`danger` (yellow→red, destructive). Label text is
`SCREAMING_SNAKE`; pass `icon` (a Lucide name from `icons.tsx`) for leading glyphs. Disable + show a
`…` progress label during async work.

---

## 7. Status, feedback, and the three states

- **`Chip`** for inline status/tags — tones map to the semantic palette (`accent`, `purple`, `warn`,
  `danger`, `muted`, …). Type/level coloring is consistent across the app (e.g. dream = purple).
- **Toasts** via `useToast().push({ type, message })` for action results — not `alert`.
- **Loading / empty / error are not optional.** Every data-backed view renders all three: skeletons
  (`animate-pulse` bars) while loading, a `Panel` empty state with an icon + CTA when there's no data,
  and a red error line (with a pointer to `#/config`) on failure. Audit each new fetch path for these.

---

## 8. Motion

Framer Motion only, and subtle. Reuse the existing easing (`EASE = [0.25,0.46,0.45,0.94]`), short
durations (~0.15–0.25s), small offsets (fade + a few px of `y`/`x`). Hover/tap on buttons is a tiny
scale (1.02 / 0.98). Don't add large, bouncy, or attention-grabbing animations — especially on pages
still on mock data.

---

## 9. Hard rules (anti-patterns that fail review)

1. No `window.prompt/confirm/alert` — use `Modal` / `ConfirmModal` / toasts.
2. No raw `<input>`, `<button>`, `<select>`, or hand-rolled overlays — use the atoms.
3. No hardcoded colors or off-palette Tailwind colors — use `@theme` tokens only.
4. No `rounded-*`, gradients, or shadows (except the modal's own).
5. No new fonts or `text-sm`+ for chrome — monospace, small.
6. No `Toggle` switch (broken) — use `Checkbox`.
7. Labels/titles/buttons in `SCREAMING_SNAKE`; descriptions in sentence case.
8. Never hardcode the Honcho base URL/token in a component — read from the config store.

## 10. Pre-ship checklist

- [ ] Reused `Panel` / `Modal` / atoms — no parallel shells or raw HTML controls.
- [ ] All color/type via tokens; SCREAMING_SNAKE labels, sentence-case hints.
- [ ] Any popup is a `Modal`/`ConfirmModal` with the cancel-then-primary footer + progress label.
- [ ] Loading, empty, and error states all render.
- [ ] `npm run check` passes (lint + typecheck + build).
