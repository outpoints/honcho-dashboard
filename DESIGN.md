---
name: Honcho Self-Hosted Dashboard
description: A dark, monospace, terminal-style control panel for operating a self-hosted Honcho memory server.
colors:
  void: "#050505"
  surface: "#0a0a0a"
  border: "#1a1a1a"
  border-light: "#262626"
  text-primary: "#ededed"
  text-muted: "#737373"
  accent: "#3c82f7"
  accent-secondary: "#a6c6e6"
  status-danger: "oklch(70.4% 0.191 22.216)"
  status-warn: "oklch(85.2% 0.199 91.936)"
  status-dream: "oklch(71.4% 0.203 305.504)"
  status-cyan: "oklch(78.9% 0.154 211.53)"
  status-blue: "oklch(70.7% 0.165 254.624)"
typography:
  display:
    fontFamily: "VT323, monospace"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.05em"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.025em"
  body:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.333
    letterSpacing: "normal"
    fontFeature: "'ss01', 'ss02'"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.625rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.void}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "32px"
  button-solid:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.void}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "32px"
  chip-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
  input-text:
    backgroundColor: "{colors.void}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  input-text-focus:
    backgroundColor: "{colors.void}"
    textColor: "{colors.text-primary}"
  checkbox:
    backgroundColor: "{colors.void}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    size: "16px"
  checkbox-checked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.void}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "12px"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "16px"
---

# Design System: Honcho Self-Hosted Dashboard

## 1. Overview

**Creative North Star: "The Memory Console"**

This is an operator's console onto a self-hosted memory server, not a marketing
dashboard. Every panel is a readout: a window onto workspaces, peers, sessions,
conclusions, runtime, and queue health. The aesthetic borrows from terminals and
IDEs — flat surfaces, square corners, hairline borders, monospace everywhere,
bracketed window chrome (`[ TITLE ]` with `─ □ ×` controls), and a single blue
signal color that means "live / selected / acting" and nothing else. The mood is
confidence and control: the operator should trust the numbers and feel the tool
stay out of the way.

Density is high and deliberate. Type runs small (12px is the default, dropping to
11/10/9px for chrome and labels) because operators scan tables, counts, and ids,
not prose. Color is rationed: the near-black neutral ramp (`#050505` → `#262626`)
carries almost the entire surface, the blue accent appears only on interactive and
live elements, and the semantic palette (red / yellow / purple / cyan / blue /
pink) is reserved strictly for status and type classification. Motion is short and
functional — entrances fade in with a few pixels of travel, buttons nudge 2% on
hover, a status dot pulses while processing — never choreography.

This system explicitly rejects consumer-SaaS gloss: no rounded cards, no drop
shadows (the modal is the single exception), no gradients, no pastel
illustrations, no hero-metric tiles with gradient numbers. It also rejects
dishonesty — the UI shows only what Honcho actually exposes and degrades to an
explicit "unavailable" state rather than faking a metric or a control.

**Key Characteristics:**
- Dark, flat, square, hairline-bordered — terminal/IDE control panel, not a card grid.
- Monospace throughout (JetBrains Mono); small type by default; pixel font for big numerals only.
- One blue accent for interactive/live/selected state; everything else is the neutral ramp.
- SCREAMING_SNAKE labels, sentence-case hints; bracketed `[ TITLE ]` panel chrome.
- Subtle, functional motion; every data view renders loading, empty, and error.

## 2. Colors

A near-monochrome neutral ramp on near-black, with one blue signal accent and a
reserved semantic palette for status.

### Primary
- **Signal Blue** (`#3c82f7`): The only brand color. Interactive elements (primary
  buttons, links, focused input borders), the current selection, active tabs, live
  status dots, and monospace identifiers (ids, URLs). Its scarcity is what makes it
  read as "this is live / this is actionable."

### Secondary
- **Faded Sky** (`#a6c6e6`): A desaturated companion to Signal Blue for secondary
  accent text and softer highlights where full accent would shout. Used sparingly.

### Neutral
- **Void** (`#050505`): The page background and the inset background of inputs,
  pill-tab tracks, and the modal backdrop tint. The darkest surface.
- **Surface** (`#0a0a0a`): Every panel, card, and modal body. One step above Void so
  panels read as raised planes without any shadow.
- **Border** (`#1a1a1a`): The default hairline border and divider on every panel,
  header, footer, and table row. Also the muted-chip background.
- **Border Light** (`#262626`): Hover / emphasized borders and the resting border on
  low-emphasis controls (secondary buttons, the modal card edge).
- **Text Primary** (`#ededed`): Primary readable text, values, headings.
- **Text Muted** (`#737373`): Labels, hints, secondary text, window-chrome glyphs.

### Semantic (status only)
- **Danger Red** (`oklch(70.4% 0.191 22.216)`): Errors and destructive hover states.
- **Warn Yellow** (`oklch(85.2% 0.199 91.936)`): Warnings, processing dots, the
  resting state of destructive buttons (yellow → red on hover).
- **Dream Purple** (`oklch(71.4% 0.203 305.504)`): Dream/reasoning classification.
- **Cyan / Blue / Pink / Orange** (`oklch(...)`): Reasoning task-type and level chips.
  Type-to-color mapping is consistent across the whole app.

### Named Rules
**The One Accent Rule.** Signal Blue is the *only* brand color and appears only on
interactive, live, or selected elements. It is never decoration. If a screen is
mostly blue, something is wrong.

**The Status-Only Palette Rule.** The semantic colors (red / yellow / purple / cyan
/ blue / pink / orange) are reserved for status and type classification. Never reach
for them to add visual interest; a non-status element is neutral or accent, never green.

**The No-Raw-Color Rule.** Every color comes from a `@theme` token (`bg-surface`,
`text-accent`, `border-border`, …). A raw hex, an `rgb()`, or an off-palette Tailwind
class (`bg-gray-800`, `text-blue-600`) is prohibited.

## 3. Typography

**Display Font:** VT323 (with `monospace` fallback) — a pixel font, reserved for large stat numerals.
**Body / UI Font:** JetBrains Mono (with `ui-monospace, monospace` fallback) — carries everything else.
**Label / Mono Font:** JetBrains Mono — ids and URLs use it at accent color.

**Character:** One monospace family does almost all the work; hierarchy comes from
size, weight, and case, not from pairing competing typefaces. VT323 is the single
exception — a retro pixel face used *only* for big readout numbers, where its blockiness
reads as "instrument display." JetBrains Mono runs with stylistic sets `ss01`/`ss02` enabled.

### Hierarchy
- **Display** (VT323, 400, `1.875rem`/`text-3xl`, line-height 1.2): StatTile numerals only — the big numbers on overview/metric readouts.
- **Headline** (JetBrains Mono, 600, ~`0.875rem`): Page titles in `PageHeader`. Used sparingly.
- **Title** (JetBrains Mono, 500, `0.75rem`/`text-xs`): Panel titles inside `[ ... ]`, modal titles, section labels.
- **Body** (JetBrains Mono, 400, `0.75rem`/`text-xs`, line-height ~1.33): Default UI text, values, table cells, input text. Prose blocks cap at 65–75ch; dense tables may run wider.
- **Label** (JetBrains Mono, 400, `0.625rem`/`text-[10px]`, letter-spacing `0.05em`, UPPERCASE): Field labels, chips, eyebrow counts. Drops to `text-[9px]` for chips.

### Named Rules
**The SCREAMING_SNAKE Rule.** Labels, buttons, tab names, panel titles, and field
labels are `SCREAMING_SNAKE_CASE` (`SCHEDULE_DREAM`, `PEER_ID`, `NEW_WORKSPACE`).
Descriptions, hints, and helper text are sentence case, muted, and small. Never mix the two.

**The Small-Type Rule.** UI chrome defaults to `text-xs` (12px) and steps down via the
`text-[11px]` / `text-[10px]` / `text-[9px]` escape hatches. `text-sm` and larger are
prohibited for chrome — reserve them for headings and values. Monospace small type is the texture.

**The Bracket Rule.** Panel and modal titles render inside brackets via the component
chrome (`[ TITLE ]`). Pass the bare `SCREAMING_SNAKE` string; the brackets are added for you.

## 4. Elevation

This system is flat by default. Depth is conveyed by tonal layering, not shadows:
Void (`#050505`) is the floor, Surface (`#0a0a0a`) is the raised panel, and a hairline
Border (`#1a1a1a`) draws the edge. There are no resting shadows anywhere in the app.

### Shadow Vocabulary
- **Modal lift** (`box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5)` / Tailwind `shadow-2xl`):
  The single sanctioned shadow, used only on the centered modal card to separate it from
  the blurred backdrop (`bg-void/80 backdrop-blur-sm`).

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat. The only shadow in the system is the
modal's lift; the only blur in the system is the modal backdrop. If a card, panel, or
button has a shadow, it is wrong. Square corners only — `rounded-*` is prohibited.

## 5. Components

### Buttons
- **Shape:** Square (`rounded: 0`), 1px border, uppercase tracked label. `md` is 32px tall (`px-3 h-8 text-xs`), `sm` is 28px (`px-2 h-7 text-[10px]`).
- **Primary:** Accent outline on transparent (`border-accent text-accent`) that *fills* on hover (`hover:bg-accent hover:text-void`). The default create/confirm action.
- **Solid:** Filled accent (`bg-accent text-void`), hover `bg-accent/90`. For the single highest-emphasis action.
- **Secondary / Ghost:** Muted, `border-border-light text-text-muted`, hover lifts to `text-text-primary`. Cancel and low-emphasis actions.
- **Outline:** `text-text-primary` on transparent with `border-border-light`, hover `border-accent`.
- **Warning / Danger:** There is no red-baseline button. Destructive intent rests yellow (`border-yellow-500/40 text-yellow-300 bg-yellow-500/10`) and shifts to red on hover. `danger` aliases `warning`.
- **Hover / Tap:** `scale: 1.02` on hover, `0.98` on tap (Framer Motion, 0.1s); `transition-colors duration-150`. Disabled is `opacity-50` + `cursor-not-allowed`.
- **Async:** Disable and show a `…` progress label while a request is in flight (`SAVING…`, `SCHEDULING…`).

### Chips
- **Style:** `inline-flex`, `px-1.5 py-0.5`, `text-[9px]` uppercase tracked. Tone sets a `/10` color background, the color at full strength for text, and a `/30` color border (e.g. `bg-accent/10 text-accent border-accent/30`). The `muted` tone is the exception: solid `bg-border text-text-muted`, no border.
- **State:** Tones map to the semantic palette (`accent`, `purple`, `warn`, `danger`, `cyan`, …). Type/level coloring is consistent app-wide (dream = purple).

### Inputs / Fields
- **Field:** `Field` wraps a control with a `text-[10px]` uppercase muted label and an optional sentence-case hint below.
- **Text Input:** `bg-void border border-border px-3 py-2 text-xs`, placeholder `text-text-muted`.
- **Focus:** Border shifts to `border-accent` (`outline-none`, `transition-colors duration-150`). No glow.
- **Checkbox:** A 16px square (`w-4 h-4 border`), `bg-void border-border-light` unchecked, `bg-accent border-accent text-void` with a check glyph when checked. **Booleans use `Checkbox`, never the `Toggle` switch** (the switch atom is broken).

### Navigation
- **Tabs:** Underline style — a row with a bottom border; the active tab is `text-accent` with an animated 1px accent underline (`layoutId` spring, stiffness 500 / damping 38). Inactive is `text-text-muted` → `text-text-primary` on hover.
- **PillTabs:** Segmented control on a `bg-void border-border p-1` track; the active pill is a solid accent block sliding under the label (`text-void` on accent). For binary/segmented choices (FORM↔JSON, type filters).
- **Sidebar:** Persistent left nav driven by `NAV_ITEMS`; hash-based routing (`#/overview`, …) inside `AppShell`.

### Panel (signature)
A titled section container used everywhere. `bg-surface border border-border`, no radius,
no shadow. Header (`px-3 py-2`, bottom border) carries a status dot + `[ TITLE ]` on the
left and `─ □ ×` window-chrome glyphs on the right (the `×` tints accent on hover). Body is
`p-3`. Status dot: `idle` = muted, `active` = accent, `processing` = pulsing yellow. Entrance:
fade + 10px rise, 0.25s, ease `[0.25,0.46,0.45,0.94]`.

### Modal (signature)
The mandatory pattern for **every** popup — never `window.prompt/confirm/alert`, never a
hand-rolled overlay. Backdrop is `bg-void/80 backdrop-blur-sm`; the card is `bg-surface
border border-border-light shadow-2xl`, `max-w-2xl` (widen via `className`). Header is the
same `[ TITLE ]` chrome with a close `×`; body is `p-4 space-y-4`; footer is right-aligned,
secondary-then-primary (`CANCEL` then `SAVE`), both disabled with a progress label during
async work. Escape closes. Destructive confirmations use `ConfirmModal`, not a bare `Modal`.

## 6. Do's and Don'ts

### Do:
- **Do** pull every color and font from `@theme` tokens (`bg-surface`, `text-accent`, `border-border`); keep type small and monospace.
- **Do** compose new screens from `Panel` / `Modal` / `ConfirmModal` / atoms — reuse the primitives, never build a parallel shell or drop in raw `<input>` / `<button>` / `<select>`.
- **Do** label in `SCREAMING_SNAKE_CASE` and write hints in sentence case; wrap popups in `Modal` with a cancel-then-primary footer and a `…` progress label.
- **Do** render loading (skeleton bars), empty (a `Panel` state with an icon + CTA that teaches the interface), and error (a red line pointing at `#/config`) for every data path.
- **Do** keep motion subtle and functional — fade + a few px, `scale: 1.02`/`0.98` on buttons, reuse `EASE = [0.25,0.46,0.45,0.94]`, durations ~0.15–0.25s. Pair each animation with a `prefers-reduced-motion` alternative.
- **Do** show only what Honcho actually exposes; degrade operator panels to an explicit "unavailable" state when the DB isn't wired.

### Don't:
- **Don't** apply consumer-SaaS gloss: no rounded cards, no drop shadows (the modal's lift is the only exception), no gradients, no pastel illustrations.
- **Don't** build the hero-metric template (big gradient stat tiles) or identical icon-card grids.
- **Don't** fake data Honcho doesn't expose — no invented per-message status chips, no fake archive / pause / process-all controls. Honesty beats a prettier-but-false UI.
- **Don't** use gradient text, glassmorphism as decoration, or side-stripe accent borders (`border-left` > 1px as a colored stripe).
- **Don't** use `text-sm`+ for chrome, introduce a new font, or use `rounded-*` anywhere.
- **Don't** use the `Toggle` switch (broken — knob/label overlap); booleans use `Checkbox`.
- **Don't** use `window.prompt/confirm/alert` or a hand-rolled `fixed inset-0` overlay — use `Modal` / `ConfirmModal` / toasts.
- **Don't** add flourish to any screen still on mock data. Real before pretty.
