# Theme: Light / Dark Toggle

This document describes how the Agentic Kanban UI handles light and dark
themes, how colours are tokenised via CSS custom properties, how the user's
choice is persisted, and how the "no-flash" apply-before-paint technique
works.

## Architecture overview

```
theme.js  (blocking <script> in <head>)
  │
  ├── 1. apply-before-paint ─ sets html.dark / removes it (synchronous)
  │
  ── 2. Tailwind config ───── colours = var(--…) references
          ↓
        cdn.tailwindcss.com consumes config at load-time

theme.css  (<link> after theme.js)
  │
  ├── :root { … }              light palette (CSS vars)
  ├── html.dark { … }          dark palette (CSS vars override)
  ── html, body { background: var(--bg) }
```

## CSS variable tokens

All colours are defined as CSS custom properties (variables). There are two
palette blocks:

| Block | Selector | Purpose |
|-------|----------|---------|
| Light (default) | `:root` | Colours for light mode |
| Dark | `html.dark` | Colours for dark mode |

### Colour tokens

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | `#F5F6F8` | `#0E0F13` | Page background |
| `--panel` | `#FFFFFF` | `#15171D` | Card / panel surface |
| `--panel2` | `#ECEEF2` | `#1B1E26` | Secondary surface (inputs, badges) |
| `--border` | `#D5D8DE` | `#262932` | Borders |
| `--borderlt` | `#BFC3CC` | `#30343F` | Lighter borders (hover) |
| `--text` | `#1A1D24` | `#E6E8EC` | Primary text |
| `--muted` | `#5F6672` | `#8A8F98` | Secondary / muted text |
| `--accent` | `#4263EB` | `#5B7CFA` | Primary accent (buttons, links) |

### Semantic state tokens

Workflow-state and evidence colours are also tokens (one hue per state),
with darker shades for light backgrounds to ensure AA contrast:

| Token | Light | Dark |
|-------|-------|------|
| `--st_todo` | `#5F6672` | `#8A8F98` |
| `--st_prog` | `#2F5AC7` | `#4D8DF0` |
| `--st_impl` | `#4C5FD8` | `#7C83FA` |
| `--st_self` | `#0A8D68` | `#2DD4BF` |
| `--st_selffail` | `#B96B00` | `#F5A524` |
| `--st_human` | `#7C3AED` | `#A877F5` |
| `--st_reject` | `#C8321E` | `#F2683C` |
| `--st_done` | `#0A9660` | `#34D399` |
| `--ev_pass` | `#0A9660` | `#34D399` |
| `--ev_fail` | `#C8321E` | `#F4564E` |
| `--ev_warn` | `#B96B00` | `#F5A524` |

## How to add or override a colour

1. Declare the variable in both `:root` and `html.dark` in `theme.css`.
2. Reference it in `theme.js` as `'var(--your-token)'` inside the Tailwind
   `colors` object.
3. Use Tailwind utility classes as usual: `bg-your-token`, `text-your-token`,
   `border-your-token`.

The Tailwind Play CDN resolves `var(--…)` at runtime, so toggling `.dark` on
`<html>` re-themes the entire UI without a page reload.

## Theme toggle CTA

The toggle button lives in the top-right of the header (all pages):

```html
<button id="theme-toggle" title="Toggle theme">
  <i class="ph ph-moon text-[15px]"></i>
</button>
```

`theme.js` wires it at `DOMContentLoaded`:

1. Reads `localStorage.getItem('ak-theme')`.
2. Toggles `html.classList.toggle('dark')`.
3. Persists the new value to `localStorage`.
4. Swaps the icon: dark → `ph-moon`, light → `ph-sun`.

### Icon convention

| Current mode | Icon shown | Meaning |
|-------------|------------|---------|
| Dark | Moon | "currently dark" |
| Light | Sun | "currently light" |

## Apply-before-paint (no flash)

`theme.js` runs a synchronous IIFE at the **top** of the file, before any
rendering:

```js
(function () {
  var stored = localStorage.getItem('ak-theme');
  var prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored || (prefersDark ? 'dark' : 'light'); // default dark
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
})();
```

Resolution order:

1. **`localStorage`** — explicit user choice (highest priority).
2. **`prefers-color-scheme`** — OS preference (dark → `'dark'`, otherwise → `'light'`).
3. **`'light'`** — fallback when OS preference is not dark.

Because this runs in a blocking `<script>` inside `<head>`, it executes
before the browser paints, eliminating the "flash of wrong theme" (FOUT).

## Persisting across pages

All 7 HTML pages load `theme.js` in `<head>`, so:

- The apply-before-paint logic runs on every page load.
- The toggle CTA handler works on every page that has the button.
- `localStorage` survives navigation between pages.

## Reduced-motion

All animated effects (heartbeat pulse, shimmer, drawer transition) are
disabled when `prefers-reduced-motion: reduce` is set. Theme toggling is a
simple class swap with no animation, so it is unaffected by this setting.

## Files

| File | Purpose |
|------|---------|
| `design-system/theme.css` | CSS var tokens, `:root` + `html.dark` palettes |
| `design-system/theme.js` | Tailwind config (var refs), apply-before-paint, CTA handler |
| `design-system/index.html` | Board page — toggle CTA with `id="theme-toggle"` |
| `tests/ui/theme-toggle.spec.ts` | Playwright spec — toggle, persist, icon |
| `docs/ui/TASK-018/` | Screenshots (light, dark, CTA close-up) |
| `docs/ui/theme.md` | This document |
