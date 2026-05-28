# Color Audit — extracted from compiled JS bundle

## Button variants (verbatim from bundle)

| variant | classes |
|---|---|
| primary | `border border-accent text-accent bg-transparent hover:bg-accent hover:text-void` |
| secondary | `border border-border-light text-text-muted bg-transparent hover:border-text-muted hover:text-text-primary` |
| warning | `border border-yellow-500/40 text-yellow-300 bg-yellow-500/10 hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-300` |
| ghost | (re-using muted patterns; safe as `secondary`) |

## Mapping in source

| Button | Original variant |
|---|---|
| VIEW_MESSAGES | primary |
| VIEW_SESSIONS | secondary |
| ARCHIVE / UNARCHIVE | secondary |
| **REMOVE_SESSION** | **warning** (yellow → red on hover) |
| NEW_X create CTAs | primary |
| CANCEL in modals | secondary |
| CREATE in modals | primary |

## Notes
- The original has NO red-baseline "danger" button. Destructive intent uses the
  yellow→red hover progression on `warning`. My clone's `danger` variant should
  be removed or aliased to `warning`.
- Reasoning task chips colors (purple/blue/cyan/orange/yellow/pink) match the
  existing implementation.
