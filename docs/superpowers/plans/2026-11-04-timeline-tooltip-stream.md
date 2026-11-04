# Timeline Tooltip Event Stream Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan inline, task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the event shown in a timeline tooltip directly in the event stream.

**Architecture:** Pass an optional action into `TimelineTooltip` and reuse `Timeline`'s activation callback. A new jump request opens `FileActivity`'s stream before its existing centering logic runs. Keep tooltip descriptions separate from the focusable action and retain the hovercard while interacting with it.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Testing Library.

---

### Task 1: Open the displayed event

**Files:** `frontend/src/TimelineTooltip.tsx`, `frontend/src/Timeline.tsx`, `frontend/src/FileActivity.tsx`, `frontend/src/Timeline.playback.test.tsx`.

- [x] Add an integration test that hovers command 95 while playback is live at command 100, clicks **Open in event stream**, and verifies paused playback, the active event card, and centering.
- [x] Run `npm run test:frontend -- src/Timeline.playback.test.tsx -t "tooltip action"`; expect the new test to fail because the action does not exist.
- [x] Add `onOpenEvent?: () => void` to the tooltip and render the native action below the summary. Wire it to `activateIndex(tooltipIndex)`, then dismiss the tooltip.
- [x] Open the stream on a new jump request:

```tsx
useLayoutEffect(() => {
  if (!jumpRequest) return;
  setTraceOpen(true);
  setRelatedSession(null);
  setMobileOpen(false);
}, [jumpRequest]);
```

- [x] Rerun the integration test and existing stream activation tests.

### Task 2: Preserve pointer and keyboard access

**Files:** `frontend/src/TimelineTooltip.tsx`, `frontend/src/Timeline.tsx`, `frontend/src/Timeline.test.tsx`, `frontend/src/Timeline.playback.test.tsx`, `README.md`.

- [x] Add and run failing tests for keyboard focus retention and activation after hover dismissal timers and scrub tooltip expiry; also cover prompt and missing-handler behavior.
- [x] Keep tooltip interactions alive using the displayed event and anchor, avoid closing while its action retains focus, and place the action outside the descriptive tooltip role.
- [x] Focus the stream toggle after opening the requested event, without scrolling it away from the centered event. Verify search/type filters reset for explicit jumps, while ordinary scrubbing still leaves the stream closed.
- [x] Document the action and update timeline accessibility instructions without changing existing marker activation behavior.
- [x] Run `npm run test:frontend`, `npm run typecheck`, `npm run build`, and `git diff --check`. Compare suite failures with the known baseline and leave unrelated failures unchanged.

## Review and verification

- Reproduced and fixed marker-originated leave timers dismissing a focused action. All delayed dismissals now check actual focus inside the tooltip.
- Reproduced and fixed related overflow controls interrupting Tab access. The fixed-position tooltip renders outside the scroll viewport, immediately after it in DOM order, without a body portal.
- Independent follow-up review found no material issues.
- All 11 tooltip-action tests pass. Type-check, production build, and diff checks pass.
- Full frontend suite: 204 passing, nine previously existing failures, no new failures. The stream-opening fix resolves two previous activation failures.
- Server suite: 160 passing, one unchanged failure in `tests/session-activity.test.ts`.
