# React WebSocket Viewer Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the inline viewer with a small React frontend using two-way WebSocket communication, preserving the existing dashboard.

**Architecture:** Vite builds the React frontend into `frontend/dist`, served by the existing Node HTTP server. A shared discriminated-union protocol carries requested snapshots and live events over `/ws`. The plugin, analyzer, recorder, and database behavior stay unchanged.

**Tech Stack:** React, TypeScript, Vite, ws, Node test runner, Vitest, Testing Library, jsdom.

---

## File responsibilities

- `shared/viewer-protocol.ts`: browser/server transport types.
- `server/viewer.ts`: HTTP API, WebSocket snapshots and live publication.
- `server/frontend.ts`: safe static asset serving.
- `frontend/index.html`, `frontend/vite.config.ts`, `frontend/src/main.tsx`: frontend entry and build configuration.
- `frontend/src/useViewer.ts`: connection, retries, snapshot replacement, and stream state.
- `frontend/src/App.tsx`: session URL navigation and dashboard composition.
- `frontend/src/SessionSidebar.tsx`: session selection and keyboard navigation.
- `frontend/src/ActivitySummary.tsx`: global counters.
- `frontend/src/EventFeed.tsx`, `frontend/src/EventCard.tsx`: filtering, collapse controls, event presentation.
- `frontend/src/Icon.tsx`, `frontend/src/styles.css`: existing icons and visual styling.
- `frontend/src/*.test.tsx`: component and WebSocket lifecycle tests.
- `tests/viewer.test.ts`: HTTP and real WebSocket integration tests.
- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `README.md`: dependencies, scripts, typechecking, generated-file exclusions, usage.

### Task 1: Establish baseline and dependencies

- [x] Run `npm test` and record unrelated baseline failures before edits.
- [x] Add React, React DOM, and ws runtime dependencies; add Vite, React/ws types, Vitest, jsdom, Testing Library, and concurrently development dependencies.
- [x] Add JSX and DOM compiler support; include `frontend` and `shared` in typechecking.
- [x] Add `build`, `test:frontend`, backend/frontend development scripts, and a pre-view build. Keep the existing backend test command accessible as `test:server`.

### Task 2: Replace SSE with requested snapshots and live WebSockets

- [x] Replace inline-script assertions and SSE tests with WebSocket tests. Assert an idle connection receives no data until it requests a snapshot, then receives the retained history and live updates.
- [x] Define shared transport types with this contract:

```ts
type ViewerRequest = { type: "snapshot.request" };
type ViewerResponse =
  | { type: "snapshot"; sessions: SessionSummary[]; events: ViewerMessage[] }
  | { type: "event"; message: ViewerMessage }
  | { type: "error"; message: string };
```

- [x] Give every `ViewerMessage` a numeric viewer-local `id`, original `event`, and optional `content`, `command`, `sessionTitle`, and `session` fields.
- [x] Preserve event content extraction and session enrichment. Remove `PAGE` and the `/events` SSE route. Add `/ws` using `WebSocketServer` with explicit origin checks, request validation, subscriber cleanup, and shutdown.
- [x] Add static serving that accepts only known files within `frontend/dist`, handles query parameters, returns correct HTML/JS/CSS content types, and responds with 404 rather than exposing source files or traversing directories.
- [x] Verify replay includes 600 events, source envelopes remain equal, repeated snapshots replace history, invalid messages receive errors, foreign origins are rejected, and shutdown closes open sockets.
- [x] Run `npx tsx --test tests/viewer.test.ts` and confirm all integration tests pass after a frontend build.

### Task 3: Convert dashboard to React

- [x] Extract the existing stylesheet unchanged except connection selectors moving from `body` to the React app root.
- [x] Add focused components listed above, using JSX, plain CSS, local React state, and native `details` elements. Do not add code comments or external fonts.
- [x] Implement `useViewer`: connect to same-origin `/ws`, request a snapshot on open, replace collections on snapshots, append live messages, and update session summaries. Retry closed connections with delays capped at ten seconds; close sockets and clear timers on unmount.
- [x] Preserve case-insensitive raw-event search, tag classification, total counters, session sorting, keyboard navigation, query-string selection, back/forward navigation, empty states, visible-only collapse controls, and text-only rendering.
- [x] Add behavior tests using Testing Library. Check search and event/session filters, URL updates and popstate, counters, collapse controls, raw details, snapshot replacement, reconnect, and cleanup.
- [x] Run `npm run test:frontend` and `npm run build`; both must pass.

### Task 4: Verify, document, and commit

- [x] Document `npm run view`, `npm run view-dev`, frontend development URL, WebSocket protocol, and unchanged receiver and HTTP session APIs.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`. Distinguish unrelated baseline failures from regressions.
- [x] Inspect the final diff for unrelated changes, code comments, generated files, missing cleanup, unsafe HTML, and accidental native-event mutations.
- [x] Stage only task files and commit with `feat(viewer): add React and WebSocket frontend`.

## Baseline observations

Before implementation, `npm test` fails because the local dependencies are not installed (`@opencode/plugin` cannot resolve) and the existing SQLite migration test reports `table events has no column named timestamp`. Recheck after installing dependencies; do not fix unrelated plugin or storage behavior as part of this conversion.

After installing dependencies, the V2 plugin test also fails because it expects
an `{ event }` wrapper that the existing plugin does not produce. Both this
assertion failure and the SQLite migration failure were reproduced before the
viewer implementation changed. The complete post-conversion run passes all
11 frontend tests and 19 of 21 server tests, with only those two baseline
failures remaining. Typechecking and the production build pass. A live Vite
development server smoke check also verified its entry module and same-origin
WebSocket proxy against an ephemeral viewer server, without disturbing the
existing viewer on ports 5001 and 5002.

A headless Chrome smoke check rendered the production React dashboard and
confirmed that it reached the live state and displayed an event received in its
WebSocket snapshot.

Read-only review identified an unguarded URL parser that could crash the server
on malformed HTTP or upgrade request targets. An isolated process reproduced
the exception; guarded parsing now returns HTTP 400. A new raw TCP regression
test covers both paths and verifies that the viewer keeps accepting requests.
All seven viewer integration tests pass after that fix.
