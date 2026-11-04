# Low-cost Live Explanations Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan inline, task-by-task. Stay on the current branch and do not commit unrelated work.

**Goal:** Add opt-in live intent without extra model turns. The approved follow-up below supersedes live outcomes: outcomes are retrospective-only and absent from the timeline.

**Architecture:** Extend compatible V2 tool schemas and wrap their executors without modifying results. Reuse intent/outcome events and propagate their provenance through the existing analyzer and timeline.

**Tech Stack:** TypeScript, OpenCode V2 plugin API, Effect Schema, node:test, Vitest/React.

---

### Task 1: Inline intent and automatic outcomes

**Files:** Create `plugin/v2/intent-schema.ts`, `plugin/v2/tool-outcome.ts`, `plugin/v2/live-explanations.ts`, and `tests/live-explanations.test.ts`. Modify `plugin/v2/index.ts` and `plugin/shared/tracing.ts`.

- [x] Add failing tests that configure `options: { liveToolExplanations: true }`, capture `tool.transform`, execute a read with `{ path: "README.md", __balrogReason: "Check setup." }`, and assert the real executor receives only `{ path: "README.md" }`.
- [x] Assert `session.hook`, model generation, and tool registration are never used; results and errors retain identity; missing reasons do not reject tools.
- [x] Run `npx tsx --test tests/live-explanations.test.ts` and confirm failure before implementing.
- [x] Implement schema projection and original decoding; skip unsupported/conflicting roots, preserve schema constraints, and keep the new field optional.
- [x] Implement bounded deterministic outcomes, best-effort recording, and a per-session/call active set so nested wrappers cannot duplicate explanations.
- [x] Register the transform only for the explicit boolean option, and include its registration in cleanup.
- [x] Run focused tests, including `tests/passive-recording.test.ts` and `tests/plugin.test.ts`.

### Task 2: Annotation provenance and precedence

**Files:** Modify `server/log-receiver.ts`, `server/analyzer.ts`, and `tests/analyzer.test.ts`.

- [x] Add failing tests for `reasonSource: "agent"`, `outcomeSource: "automatic"`, session isolation, replay, and retrospective precedence over delayed automatic annotations.
- [x] Run `npx tsx --test tests/analyzer.test.ts` and confirm the new assertions fail.
- [x] Add optional provenance fields; accept automatic outcome events without a reporting-call ID. Mark retrospective annotations and prevent lower-priority annotations from replacing them.
- [x] Run `npx tsx --test tests/analyzer.test.ts tests/assessments.test.ts tests/conversation.test.ts`.

### Task 3: Live display, integration, and documentation

**Files:** Modify `frontend/src/timelineMarkers.ts`, `frontend/src/TimelineTooltip.tsx`, `frontend/src/Timeline.test.tsx`, `tests/live-explanations.test.ts`, and `README.md`.

- [x] Add a failing timeline test that asserts `Reason (agent-provided)`, `Outcome (automatic)`, and retrospective source labels while retaining existing historical labels.
- [x] Pass provenance through command markers and render the source beside each heading.
- [x] Add an HTTP/WebSocket/replay test using the real tool wrapper, recorder, and SQLite store rather than fabricated annotations.
- [x] Document `liveToolExplanations: true`, default-off behavior, best-effort purposes, automatic-outcome limits, and cost boundaries. Preserve `/retro` instructions.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`; compare full-suite failures with untouched `HEAD`.
- [x] Complete final review without changing the existing heatmap documents or committing.

## Verification notes

The initial local install was stale: root Effect did not match the declared version and the TUI dependency was missing. `npm install --ignore-scripts --package-lock=false` synchronized dependencies without changing package manifests or the lockfile.

The full frontend suite has nine remaining failures in `App.test.tsx` and `plugin/v2/tui.test.ts`. An untouched `HEAD` export reproduced those same failures plus the stale timeline-summary expectation corrected in the touched timeline test. The server suite has one pre-existing failure in `tests/session-activity.test.ts` about split-event workspace context; it also reproduces from `HEAD`. Those unrelated production paths remain unchanged. Baseline verification used a temporary source export, not another branch or worktree.

Initial verification before the reasons-only follow-up: frontend 136 passing / 9 existing failures; server 159 passing / 1 existing failure. Untouched `HEAD`: frontend 134 passing / 10 failures; server 141 passing / 1 failure. No new full-suite failures. Typechecking and the production build pass. A simple object tool gains 115 schema characters; this is a character measurement, not a token or billing benchmark.

Final review findings were reproduced with failing tests and resolved: unsafe schema constraints are skipped, decoder failures receive live annotations without invoking the executor, and throwing result/error getters cannot change tool behavior during summarization. Follow-up review found all three resolved with no important regressions.

## Approved follow-up: remove live and timeline outcomes

**Files:** Modify `plugin/v2/live-explanations.ts`, `tests/live-explanations.test.ts`, `frontend/src/TimelineTooltip.tsx`, `frontend/src/timelineMarkers.ts`, `frontend/src/Timeline.tsx`, `frontend/src/Timeline.test.tsx`, and `README.md`. Delete the unused `plugin/v2/tool-outcome.ts`. Preserve retrospective APIs, stored outcomes, Reasons, and Capabilities.

- [x] Update live tests to assert only `balrog.tool.intent` events, or no annotations when no purpose is supplied. Exercise successful calls, execution errors, decoding errors, nested calls, parallel calls, and results/errors with throwing getters.
- [x] Change the recorder/viewer integration test to wait for intent, assert `outcome: null` after live completion, then publish a `/retro` assessment and verify its outcome through HTTP and SQLite replay.
- [x] Update timeline tests to assert that historical, automatic, and retrospective outcomes never appear; retain reason and source assertions. Run `npx tsx --test tests/live-explanations.test.ts` and `npx vitest run --config frontend/vite.config.ts frontend/src/Timeline.test.tsx` to observe failures before production edits.
- [x] Remove the outcome formatter import and success/error annotations. Keep decoding/execution inside `try/finally` so active call tracking is cleared without reading or replacing results/errors.
- [x] Delete the unused formatter. Remove outcome fields from timeline marker types/mapping and tooltip rendering/dependencies. Change timeline accessibility instructions to describe reasons only.
- [x] Document that live explanations are purposes only and outcomes belong to retrospective analysis, never timeline tooltips. Keep the existing flag for compatibility.
- [x] Run focused tests covering timeline, Reasons, Capabilities, assessments, live recording, and replay; then typecheck, production build, and the full suites. Report remaining pre-existing failures without expanding scope or committing.

Follow-up verification: 34 focused backend tests and 62 focused frontend tests pass. Typecheck and production build pass. Full frontend suite: 140 passing / 9 existing failures, with no new failures against the stored untouched-`HEAD` baseline. Full server suite: 158 passing / the same 1 pre-existing workspace-attribution failure. No branch, commit, stored recording deletion, or changes to Reasons/Capabilities rendering were introduced.

## Approved follow-up: reuse recorded retrospective reasons

**Files:** Modify `plugin/v2/retro.ts`, `skills/retro/SKILL.md`, `server/assessments.ts`, `server/log-receiver.ts`, `tests/retro.test.ts`, `tests/assessments.test.ts`, `tests/live-explanations.test.ts`, and `README.md`. Preserve the existing branch and unrelated user edits, including the heatmap and timeline scrubber work.

- [x] Add failing tests for reuse instructions in the command and bundled skill, omission of already-recorded reasons, rejection of missing reasons for unexplained calls, prevention of submitted reason overwrites, unchanged provenance, repeat retrospectives, session isolation, and SQLite replay.
- [x] Run `npx tsx --test tests/retro.test.ts tests/assessments.test.ts tests/live-explanations.test.ts` and confirm failures before implementation.
- [x] Change the command and skill to reuse non-empty reasons verbatim, infer only missing ones, omit reused reasons from publication, and continue assessing capabilities/outcomes in one shared pass.
- [x] Make assessment request/event reasons optional. Require a reason before writing any entry for an unexplained call; omit the persisted reason for already-explained calls so the analyzer preserves provenance without changing historical replay behavior.
- [x] Update documentation and the real tracing integration test. Verify the initial live reason survives assessment publication while retrospective outcomes and capabilities update.
- [x] Run focused backend and retrospective-page/timeline tests, typecheck, production build, and the full suites. Report remaining unrelated failures without changing user work, committing, or creating a branch.

Reason-reuse verification: 48 focused backend tests and 62 focused retrospective-page/timeline tests pass. Typecheck and production build pass. Full server suite: 160 passing / the same 1 pre-existing workspace-attribution failure. Full frontend suite: 139 passing / 10 failures, including one additional file-column pinning failure compared with the earlier untouched-`HEAD` baseline. Frontend files were concurrently modified before this follow-up and were not edited by this task; those failures remain outside the reason-reuse scope. No model requests, additional branches, or commits were made for verification.
