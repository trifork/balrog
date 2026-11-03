# Header Session Tabs Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan inline, as approved by the user. Do not delegate, change tests, run tests, or commit.

**Goal:** Replace the sidebar and overview metrics with compact header session navigation.

**Architecture:** Rename the sidebar component to `SessionTabs` and retain its selection, ordering, and keyboard navigation. Compose branding, tabs, and connection status in `App`, with responsive header styling in the existing stylesheet. Leave viewer data and event rendering unchanged.

**Tech Stack:** React, TypeScript, Vite, CSS.

---

### Task 1: Horizontal session navigation

**Files:** Rename `frontend/src/SessionSidebar.tsx` to `frontend/src/SessionTabs.tsx`.

- [x] Remove `eventCount`, connection status, media-query state, and sidebar-only markup.
- [x] Render the existing All sessions option and recently active sessions in a horizontal tablist without event counts.
- [x] Preserve roving tab focus and Left/Right/Home/End navigation. Scroll the focused tab into view without moving the page vertically.

The component interface becomes:

```tsx
interface Props {
  sessions: SessionSummary[];
  selected: string;
  onSelect: (sessionID: string) => void;
}
```

The tablist remains `id="session-tabs"`, `role="tablist"`, `aria-label="Sessions"`, and uses `aria-orientation="horizontal"`. Existing session buttons retain their selected state, data attributes, title fallback, and click selection behavior.

### Task 2: Compact application header

**Files:** Modify `frontend/src/App.tsx`; remove `frontend/src/ActivitySummary.tsx` after confirming no remaining consumers.

- [x] Import `SessionTabs` instead of `SessionSidebar` and remove summary imports and tool-count derivation.
- [x] Replace the sidebar, breadcrumb, and overview introduction with the header structure below.
- [x] Keep URL/history synchronization, error display, and `EventFeed` unchanged.

```tsx
<header className="topbar">
  <div className="brand">
    <div className="brand-mark"><Icon name="flame" /></div>
    <div className="brand-name">balrog<span className="brand-accent">.</span></div>
  </div>
  <SessionTabs sessions={sessions} selected={selected} onSelect={selectSession} />
  <div className="live-badge" role="status">
    <span className="status-dot" />
    <span>{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span>
  </div>
</header>
```

### Task 3: Responsive styling and verification

**Files:** Modify `frontend/src/styles.css`.

- [x] Replace the two-column application layout with a single-column shell.
- [x] Style the header as `grid-template-columns: auto minmax(0, 1fr) auto`, with brand, scrolling tabs, and status aligned in one row.
- [x] Use restrained orange selected-tab borders and retain the existing dark palette, focus outlines, and event-feed styling.
- [x] At widths up to 760px, move tabs to a second full-width row using `grid-column: 1 / -1`; preserve horizontal overflow and truncate long tab titles.
- [x] Remove sidebar, introduction, summary-card, and obsolete responsive styles. Retain the event-feed responsive rules.
- [x] Run `npm run typecheck`; expect exit code 0.
- [x] Run `npm run build`; expect exit code 0 and generated production assets.
- [x] Run `git diff --check` and inspect the diff for scope, accessibility, and absence of test changes. Do not run any test command.
