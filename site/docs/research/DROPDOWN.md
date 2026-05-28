# Select / Dropdown spec — transcribed from bundle function `rs`

## Trigger button
```
className="w-full bg-void border border-border px-3 py-2 text-sm text-text-primary
  outline-none focus:border-accent transition-colors duration-150
  flex items-center justify-between"
whileTap={{scale: 0.98}}
```
Trailing icon: `<ChevronDown size={12} className="text-text-muted" />`
- Icon wrapped in `<motion.span animate={{rotate: open ? 180 : 0}} transition={{type:"spring", stiffness:400, damping:22}}>`

## Panel
- Container: `absolute z-50 left-0 mt-1 bg-surface border border-border shadow-lg shadow-black/40`
- `style={{transformOrigin: "top", minWidth: "max(100%, max-content)"}}`
- AnimatePresence wrapper; the L4/V4 variants are simple opacity+scaleY entrance with stagger

## Row
```
className=`w-full text-left px-3 py-2 text-sm whitespace-nowrap
  ${selected ? "text-accent bg-accent/10" : "text-text-primary"}`
whileHover={{x: 3, backgroundColor: "rgba(26, 26, 26, 0.6)"}}
transition={{type: "spring", stiffness: 500, damping: 28}}
```
No check icon — the selected state is `text-accent bg-accent/10` plus the accent-tinted bg-accent/10.

## Behavior
- Click outside (mousedown listener) closes
- Click trigger toggles
- Click item: onChange(value), close
