# Timeline Performance Implementation Plan

> Execute inline with regression checks between tasks; preserve uncommitted work.

**Goal:** Reduce timeline scroll work without removing existing functionality.

**Architecture:** Window existing positioned markers using binary-search bounds;
retain interaction anchors. Accumulate continuous input until the next animation
frame while keeping explicit navigation immediate.

**Tech Stack:** React, TypeScript, Vitest, Testing Library; no new dependencies.

### Task 1: Marker virtualization

- [x] Add failing coverage in `frontend/src/Timeline.test.tsx` for bounded mounted
  markers at 100 and 1,000 events, native scrolling, resize, keyboard Home/End,
  hover/focus retention, and related-event reveal without playback changes.
- [x] Run `npm run test:frontend -- frontend/src/Timeline.test.tsx` and confirm
  the bounded-marker assertions fail before implementation.
- [x] Add binary-search window selection in `frontend/src/timelineLayout.ts` and
  render its returned indices in `frontend/src/Timeline.tsx`. Keep full positions,
  widths, counts, overflow calculations, and slider semantics unchanged.
- [x] Rerun timeline tests and compare marker counts with the baseline harness.

### Task 2: Frame-batched continuous input

- [x] Add deterministic animation-frame coverage for wheel accumulation, delta
  modes, fractional input, drag completion/cancellation, fine control, immediate
  keyboard activation, live toggling, session switches, and unmount cleanup.
- [x] Confirm batching assertions fail against synchronous wheel handling.
- [x] Update `frontend/src/useTimelineScrubber.ts` to accumulate desired position
  in refs and schedule one publication per animation frame. Keep keyboard and
  explicit jumps synchronous; flush drag completion and discard stale frames on
  external navigation or disposal.
- [x] Rerun all timeline tests and the original diagnostic harness with explicit
  frame boundaries; compare mounted markers and selection publications.

### Task 3: Behavior-preservation verification

- [x] Run `npm run test:frontend`, `npm run typecheck`, and `npm run build`.
- [x] Compare failures with the baseline: App integration currently has seven
  failures, including unstable mock heatmaps causing update loops and two event
  drawer expectations that disagree with current behavior.
- [x] Review the final diff for unrelated edits, lost interaction state, stale
  scheduled work, tooltip anchor removal, and altered historical playback.

## Verification results

- 65 of 66 tests in `Timeline.test.tsx`, `Timeline.performance.test.tsx`, and
  `Timeline.playback.test.tsx` pass, including all 39 added regressions. During
  verification, a concurrent edit to `TimelineTooltip.tsx` removed reason-source
  labels and caused its existing label test to fail; that edit is left untouched.
  The App playback tests use stable viewer snapshots to verify historical
  heatmaps and retained drawer search, expanded content, and raw details without
  the pre-existing unstable mock.
- Typechecking and production build pass. The build retains the existing
  lucide-react module-directive warnings.
- The full frontend suite has 177 passing tests and 11 failures: the same seven
  App baseline failures, one FileActivity observer-count test, and two TUI link
  label tests, plus the concurrent tooltip label change. The FileActivity and TUI
  failures reproduce independently and do not import the changed components.
- With a 400px viewport, the diagnostic renders 30 markers after scrubbing in
  both 100-event and 1,000-event timelines instead of all markers. A burst of
  20 wheel inputs publishes one selection and two React commits instead of 20
  selections and 40 commits. These are isolated DOM-harness measurements, not
  browser frame-rate claims.
- Review identified input queued between RAF publication and React's subsequent
  acknowledgement being canceled. Public wheel and drag regressions reproduced
  it; navigation tracking now distinguishes internal acknowledgements from
  external navigation. Coverage also protects queued history scrubbing when live
  commands arrive. Follow-up review confirmed the fix with no remaining findings.
