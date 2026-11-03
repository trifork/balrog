# File Heatmap Prompt Filters Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution. Track each task below and leave changes uncommitted for review.

**Goal:** Make session-wide file summaries the default while retaining per-prompt columns, optional prompt filters, proportional change candles, and centered timeline prompt navigation.

**Architecture:** Extend the existing activity model with first-seen event identities, an aggregate summary, and confirmed change counts. Keep selection in FileActivity and reuse its prompt metadata for timeline markers. Continue using the existing inspector and event feed with explicit session or prompt scope.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library, Vite, node:test.

---

## Execution status

Implementation is finished and left uncommitted. The user requested no further
tests or verification, so final reruns and review were skipped. Existing `logs/`
were left untouched.

## Task 1: Activity model

- [ ] Add failing model tests in `frontend/src/file-activity-model.test.tsx` for aggregate summaries, session/call isolation, snapshot replacement, first-seen event identity, and confirmed change proportions.
- [ ] Run `npm run test:frontend -- --reporter=dot` and confirm failures identify the missing helpers.
- [ ] Add `startEventID` to `ActivityPrompt` in `frontend/src/file-activity-model.ts`; retain the first message ID when snapshots change.
- [ ] Implement `aggregateActivity(prompts)` with merged file/event sets and namespaced call IDs, plus `changeBreakdown(touches)` for created/edited/deleted counts.

## Task 2: Session overview and optional prompt filters

- [ ] Update `frontend/src/FileActivity.test.tsx` and `frontend/src/App.test.tsx` to assert the approved session-wide default and `File heatmap` heading before implementation.
- [ ] Update `frontend/src/FileActivity.tsx`: null prompt means aggregate; add `All prompts`; candle selection toggles the filter and applies related-event scope without opening the drawer.
- [ ] Update `frontend/src/FileInspector.tsx` to label session summaries, retain file details and navigation, and remove misleading following/pinned labels.
- [ ] Update `frontend/index.html` and the page heading. Keep read approvals and session URL navigation unchanged.

## Task 3: Change candles

- [ ] Add candle tests for a 25% creation / 50% edit / 25% deletion split, exclusion of unsuccessful/reverted actions, and read-only neutral state.
- [ ] Update `frontend/src/FileHeatmap.tsx` to render stacked segments using the model helper, accessible percentage summaries, and filter instructions. Retain all prompt columns and cell keyboard navigation.
- [ ] Update `frontend/src/file-activity.css` with restrained green/blue/red segment colors, a matching legend, clear pressed outlines, and responsive filter hints.

## Task 4: Timeline boundaries and centering

- [ ] Add `frontend/src/Timeline.test.tsx` for heatmap-consistent boundaries, late-update deduplication, previous/next navigation, and viewport centering at both ends.
- [ ] Pass full session prompt context from `frontend/src/App.tsx` to `frontend/src/Timeline.tsx` and `frontend/src/timelineMarkers.ts`.
- [ ] Replace independent prompt-tag guessing with first-seen activity boundaries, using the same prompt numbering and text as the heatmap.
- [ ] Add centerable edge space in `frontend/src/timelineLayout.ts` and center explicit prompt jumps in `frontend/src/useTimelineScrubber.ts`, preserving ordinary dragging and scrolling.

## Task 5: Verification and documentation

- [ ] Run `npm run test:frontend`, `npm run typecheck`, and `npm test` (including production build and server tests).
- [ ] Review the final diff and run `git diff --check`; confirm no generated assets or existing logs were changed.
- [ ] Update the README's viewer description and report verification results, with no automatic commit or push.
