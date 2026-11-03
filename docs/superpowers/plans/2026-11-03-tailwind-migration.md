# Tailwind Migration Implementation Plan

> **For agentic workers:** Use executing-plans inline. Preserve the approved design. Do not delegate, modify tests, run tests, or commit.

**Goal:** Replace the viewer's handwritten component stylesheet with Tailwind utilities without changing appearance or behavior.

**Architecture:** Add Tailwind CSS 4 and its Vite plugin. Keep only theme tokens, browser defaults, focus styling, and scrollbar styling in the CSS entrypoint. Move layout, responsive rules, state styling, and event colors into React utility classes. Extract the repeated connection indicator into a small `StatusDot` component.

**Tech Stack:** React, TypeScript, Tailwind CSS 4, Vite 8.

---

### Task 1: Tailwind integration

**Files:** `package.json`, `package-lock.json`, `frontend/vite.config.ts`, `frontend/src/styles.css`.

- [x] Run `npm install -D tailwindcss@^4.3.4 @tailwindcss/vite@^4.3.4`.
- [x] Register the Vite plugin:

```ts
import tailwindcss from "@tailwindcss/vite";
```

```ts
plugins: [tailwindcss()],
```

- [x] Replace component selectors in `styles.css` with `@import "tailwindcss" source(".")`, an `@theme` block for existing colors/fonts, and a small `@layer base` block. Use `--spacing: 4px` to preserve existing pixel spacing with the 14px document font. Preserve dark color scheme, button defaults, focus indicators, selection colors, hidden elements, and scrollbars.

### Task 2: Shell and navigation utilities

**Files:** `frontend/src/App.tsx`, `frontend/src/SessionTabs.tsx`, `frontend/src/Icon.tsx`, new `frontend/src/StatusDot.tsx`.

- [x] Replace application classes with utilities, preserving viewport height, compact header, equal-width columns, collapse behavior, independent event scrolling, and the empty full-width bottom bar. The shell uses `grid grid-rows-[auto_minmax(0,1fr)_32px] h-screen supports-[height:100dvh]:h-dvh overflow-hidden`.
- [x] Preserve the current 760px and 480px responsive behavior using arbitrary breakpoint variants. Use `data-[pane-open=false]:grid-cols-1` and `aria-expanded:`/`aria-selected:` variants for state styles.
- [x] Add an optional `className` size override to `Icon` and move SVG stroke/fill styling into utility classes. Keep all existing icon paths.
- [x] Add `StatusDot` with existing 6px dimensions and connection colors. Use the root `group/app` and `group-data-[connection=live]/app:` variants for live state, and replace both existing indicators with the shared component.
- [x] Retain tab IDs, titles, ARIA attributes, roving focus, horizontal reveal behavior, selection ordering, and session URL handling.

### Task 3: Feed and event utilities

**Files:** `frontend/src/EventFeed.tsx`, `frontend/src/EventCard.tsx`.

- [x] Convert feed heading, count, wrapping toolbar, search, filters, empty state, and footer to utility classes. Keep all IDs, labels, controls, and filtering/collapse logic unchanged.
- [x] Convert event cards to utility classes, with static `data-[kind=...]:[--event-color:...]` variants for event colors and utilities referencing `--event-color` for text and header dots.
- [x] Preserve raw-event details, content hiding via the existing `hidden` attributes, wrapping and scrolling, responsive metadata, command truncation, timestamp formatting, and tool-content typography.
- [x] Remove obsolete component-specific CSS instead of hiding the old stylesheet behind `@apply` classes.

### Task 4: Verification

- [x] Run `npm run typecheck`; expect exit code 0.
- [x] Run `npm run build`; expect exit code 0 and generated Tailwind CSS assets.
- [x] Inspect generated CSS to confirm arbitrary variants, responsive rules, connection states, and event colors are present.
- [x] Run `git diff --check` and inspect the complete diff; expect no whitespace errors or test modifications. Do not run tests.
