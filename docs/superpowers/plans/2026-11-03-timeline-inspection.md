# Timeline Inspection Implementation Plan

> Execute inline with test-first regression coverage.

**Goal:** Open the stream only for explicit inspection and show heatmap activity at the playback position.

**Architecture:** Separate selection from activation in the timeline input layer. Reuse snapshot collection against the playback cutoff for heatmap data, preserving full-history timeline markers.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

### Task 1: Separate navigation and inspection

- [x] Update `frontend/src/App.test.tsx` to assert that navigation stays closed and event activation opens and centers the stream.
- [x] Run `npm run test:frontend -- src/App.test.tsx -t 'explicitly selected|paused playback|scrubbing'` and confirm the new behavior fails first.
- [x] Add optional `onActivate: (id: number) => void` props to `frontend/src/Timeline.tsx` and `frontend/src/useTimelineScrubber.ts`.
- [x] Keep `onSelect` for all navigation. Call `onActivate` only for completed marker clicks and Enter/Space activation, using the focused marker ID where present.
- [x] In `frontend/src/App.tsx`, clear inspection requests when scrubbing and create them only in the activation callback.
- [x] Cover pointer drag, cancellation, wheel, prompt controls, and keyboard activation in `frontend/src/Timeline.test.tsx`.

### Task 2: Reconstruct historical heatmap activity

- [x] Add an application regression with successive pending, successful, and reverted file snapshots; assert navigation restores each historical state without opening the stream.
- [x] Run the regression and confirm it fails before implementation.
- [x] In `frontend/src/App.tsx`, collect heatmap prompts from events whose IDs are at or before the paused playback position. Retain the existing full-history prompts for the timeline.
- [x] Assert incoming activity does not change the paused heatmap and Go live restores the latest activity.

### Task 3: Verify and document

- [x] Update the timeline behavior description in `README.md`.
- [x] Refresh obsolete event-stream selectors and directly affected timeline assertions in existing frontend tests.
- [x] Run `npm run test:frontend`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [x] Report any remaining pre-existing failures separately from regressions.

## Verification results

- Frontend application tests: 72 passed.
- Server tests: 129 passed.
- Frontend-only TypeScript check, production build, and diff whitespace check passed.
- The complete Vitest run retains two unrelated failures in `plugin/v2/tui.test.ts`.
- Repository-wide TypeScript checking retains three unrelated errors in `plugin/v2/instrumentation.ts`, `plugin/v2/tui.ts`, and `tests/instrumentation.test.ts`.
- Both sets of unrelated failures were reproduced against an archived, unmodified `HEAD` with the same dependencies.
- Review regressions cover current-prompt slider clicks, keyboard focus after navigation, and prompt-filter changes preserving paused playback. All three failed before their corrections and passed afterward; follow-up review found no remaining regressions.
