# Timeline Related Overflow Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this plan inline. Do not delegate, add tests, run verification, or commit changes.

**Goal:** Indicate when selected file activity has related commands outside the timeline viewport.

**Architecture:** Expose the measured timeline scroll range from the scrubber hook. Derive hidden related marker indices from that range and render amber edge buttons that scroll without selecting an event.

**Tech Stack:** React, TypeScript, existing Tailwind utilities and icons.

---

### Task 1: Viewport range

**Files:**
- Modify: `frontend/src/useTimelineScrubber.ts`

- [x] Add `const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 })`.
- [x] Update the range inside `updateFade` using `viewport.scrollLeft` and `viewport.clientWidth`, retaining the previous object when both values are unchanged.
- [x] Return `visibleRange` alongside the existing scrubber state.

### Task 2: Amber edge indicators

**Files:**
- Modify: `frontend/src/Timeline.tsx`

- [x] Derive `before` and `after` arrays of non-prompt highlighted marker indices whose painted bounds extend beyond `visibleRange`, using `layout.positions`, `layout.scales`, and `markerWidths`.
- [x] Render amber chevron/count buttons above the existing fades at each applicable edge. Give each a descriptive accessible label and tooltip.
- [x] On activation, scroll the nearest hidden related marker to the center with `viewport.scrollLeft = Math.max(0, layout.positions[index] - viewport.clientWidth / 2)` and call `updateFade()`. Do not invoke selection or playback callbacks.
- [x] Extend the screen-reader timeline instructions to explain the indicators.
