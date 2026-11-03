# Sensitive Read Approvals Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task.

**Goal:** Approve sensitive file reads in Balrog and resolve the same native OpenCode permission request.

**Architecture:** A V2 evaluation hook escalates sensitive reads to native permission requests. A plugin WebSocket and in-memory server broker relay those requests and replies to the existing browser WebSocket independently of recorded history.

**Tech Stack:** TypeScript, OpenCode V2 plugin API, Node HTTP, ws, React, Tailwind, node:test, Vitest.

---

### Task 1: Sensitive-file policy and protocol

- [x] Add matcher tests in `tests/permissions.test.ts` for POSIX/Windows paths, environment variants, appsettings variants, credentials, private keys, and non-matches; run `npx tsx --test tests/permissions.test.ts` to confirm the missing-module failure.
- [x] Create `plugin/v2/sensitive-files.ts` exporting the constant patterns and matcher. Include `appsettings.json` and `appsettings.*.json`.
- [x] Create `shared/permission-protocol.ts` with pending request identity `{pluginID, sessionID, requestID}`, resources, pending/replying status, once/reject decisions, and runtime validation. Extend `shared/viewer-protocol.ts` with permission snapshots, updates, and reply messages.
- [x] Re-run matcher tests.

### Task 2: Live server broker

- [x] Add broker tests using real WebSockets for synchronization, decisions, duplicate replies, errors, disconnects, origin rejection, and connection identity.
- [x] Create `server/permissions.ts`; attach its plugin upgrade endpoint to `server/log-receiver.ts`, optionally supplied through the constructor. Keep the recorder-only path unchanged.
- [x] Share the broker in `server/view.ts` and `server/viewer.ts`. Include pending permissions in snapshots and broadcast updates; forward validated browser replies through the broker.
- [x] Run `npx tsx --test tests/permissions.test.ts tests/viewer.test.ts`.

### Task 3: Native plugin bridge

- [x] Add plugin evaluation and end-to-end tests with a mocked OpenCode context and real receiver/viewer sockets. Prove matching reads become asks and native request IDs are preserved.
- [x] Create `plugin/v2/permissions.ts` to register the evaluation hook, track native requests, resolve actual paths, reconnect its WebSocket, validate incoming decisions, invoke `ctx.permission.reply`, and synchronize native replies/cancellations. Never auto-allow on failure.
- [x] Integrate with `plugin/v2/index.ts` before native event logging and dispose the bridge on unload. Update existing plugin mocks to expose permission hooks.
- [x] Run `npx tsx --test tests/plugin.test.ts tests/permissions.test.ts` and `npm run typecheck`.

### Task 4: Frontend approvals

- [x] Add hook tests for permission snapshots, updates, reply serialization, and offline guards. Add component tests for per-session requests, accept/reject buttons, replying/offline states, and removal on native reply.
- [x] Update `frontend/src/useViewer.ts` with pending state and a guarded reply action. Create `frontend/src/PermissionRequests.tsx` using existing dark Tailwind styling, showing all live approvals above the event feed so filters cannot conceal them.
- [x] Integrate in `frontend/src/App.tsx`, preserving navigation and existing feed behavior.
- [x] Run targeted frontend tests and compare the full suite with the baseline.

### Task 5: Documentation and verification

- [x] Update `README.md` with patterns, once-only behavior, native synchronization, endpoint configuration, outage behavior, and read-only scope limitations.
- [x] Run `npm run typecheck`, `npm run build`, `npm run test:server`, and `npm run test:frontend`.
- [x] Inspect the diff for unrelated edits, unsafe approval paths, and code comments. Report verification evidence and pre-existing failures without claiming a real OpenCode runtime smoke test.
