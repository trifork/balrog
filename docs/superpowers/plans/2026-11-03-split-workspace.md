# Split Workspace Implementation Plan

> **For agentic workers:** Use executing-plans inline. Do not delegate, modify tests, run tests, or commit.

**Goal:** Add an equal-width, collapsible split workspace and an empty full-width bottom bar.

**Architecture:** Keep local pane visibility state in `App.tsx`. Use a three-row viewport-height application grid and a two-column workspace grid, preserving the existing feed component and state.

**Tech Stack:** React, TypeScript, CSS, Vite.

---

### Task 1: Pane structure and control

**Files:** `frontend/src/App.tsx`, `frontend/src/Icon.tsx`.

- [x] Add `const [rightPaneOpen, setRightPaneOpen] = useState(true)` in `App`.
- [x] Wrap the status and a pane-toggle button in `.topbar-actions`. Set the button's `aria-expanded` to `rightPaneOpen`, `aria-controls` to `right-pane`, and action label to Collapse or Expand right pane. Toggle using `setRightPaneOpen((open) => !open)`.
- [x] Wrap the existing `main` and an empty `aside` in `.workspace` with `data-pane-open={rightPaneOpen}`. Give the aside `id="right-pane"`, `className="right-pane"`, `aria-label="Right pane"`, and `hidden={!rightPaneOpen}`. Keep the existing feed mounted in the left main element.
- [x] Add an empty `<footer className="bottom-bar" aria-label="Bottom bar" />` after the workspace.
- [x] Add this icon entry to the existing icon map:

```tsx
panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
```

### Task 2: Fixed shell and equal-width columns

**File:** `frontend/src/styles.css`.

- [x] Make `.app` a grid with `grid-template-rows: auto minmax(0, 1fr) 32px`, `height: 100vh`, `height: 100dvh`, and `overflow: hidden`.
- [x] Add `.workspace` with `display: grid`, `grid-template-columns: repeat(2, minmax(0, 1fr))`, zero minimum dimensions, and hidden overflow. When `data-pane-open="false"`, use one `minmax(0, 1fr)` column.
- [x] Give `.dashboard` zero minimum dimensions, full width, independent `overflow: auto`, and contained overscroll. Remove its old centered maximum-width constraint; keep existing compact padding.
- [x] Add a left border and panel background to `.right-pane`, and a top border and matching background to `.bottom-bar`. Keep both empty.
- [x] Style `.topbar-actions` as a compact flex row and `.pane-toggle` as a 32px square icon button, with a subdued orange expanded state and existing keyboard focus styling.
- [x] Move the mobile grid placement previously on `.live-badge` to `.topbar-actions`; preserve the horizontal session tab row and equal workspace columns on all screen sizes.
- [x] Let the toolbar wrap based on the event pane's width, not just viewport width, so the new split does not force horizontal overflow on smaller panes.

### Task 3: Verification

- [x] Run `npm run typecheck`; expect exit code 0.
- [x] Run `npm run build`; expect exit code 0.
- [x] Run `git diff --check`; expect no whitespace errors.
- [x] Inspect the diff against the approved design and confirm no tests were changed or run.
