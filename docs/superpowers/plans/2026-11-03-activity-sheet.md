# Activity Sheet Implementation Plan

**Goal:** Keep the whole-session timeline accessible while browsing events in a bottom sheet, with clearer prompt markers and file-operation hover details.

**Architecture:** Derive timeline events directly from the selected session in `App.tsx`, excluding `session.text.delta`. Keep prompt/file filters local to the heatmap inspector and event sheet. Anchor an animated, non-modal event sheet immediately above the persistent timeline.

**Tech Stack:** React, TypeScript, Tailwind CSS, component-layer CSS.

**Constraints:** Do not add or run tests, builds, type checks, or other verification. Do not add code comments.

### Task 1: Session-wide timeline

- [x] Derive timeline events from session events in `frontend/src/App.tsx`, independently of `EventFeed` filters.
- [x] Exclude text deltas only from the timeline; preserve them in the event stream.
- [x] Center timeline clicks in `frontend/src/useTimelineScrubber.ts`, including repeat clicks and clicks between markers, without changing relative drag behavior.
- [x] Enlarge and emphasize numbered prompt markers in `frontend/src/Timeline.tsx`, reserving their width in the layout.

### Task 2: Event bottom sheet

- [x] Remove the page heading and totals from `frontend/src/FileActivity.tsx` and their styles.
- [x] Replace the inline disclosure with an accessible non-modal bottom sheet, with an expand/collapse button, Escape dismissal, and an independently scrolling event body.
- [x] Anchor the sheet above a persistent timeline in `frontend/src/file-activity.css`; animate expansion and respect reduced motion.
- [x] Clear related-event scope when navigating from the timeline, reveal the selected event, and keep file-inspector event filtering local to the sheet.

### Task 3: Heatmap hover details

- [x] Expand hover details from `frontend/src/FileHeatmap.tsx` using `frontend/src/FileActivityTooltip.tsx`, with successful reads, unreverted changes, created/edited/deleted counts, and failed/pending/reverted counts.
- [x] Use existing operation-count semantics, support keyboard focus, and keep the tooltip inside the viewport.
