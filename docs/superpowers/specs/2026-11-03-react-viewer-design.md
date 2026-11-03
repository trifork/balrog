# React viewer with WebSocket communication

## Goal

Convert the current inline HTML and JavaScript viewer into a lightweight React
and TypeScript application. Preserve its appearance and behavior, with code
complexity around 5/10. Use WebSockets for browser requests and server updates.

## Scope

- Preserve the current dashboard, responsive styles, session sidebar, summary
  counters, search, event filters, keyboard navigation, session URL selection,
  collapse controls, command previews, and raw event details.
- Keep the recorder, plugin, analyzer, and SQLite persistence behavior unchanged.
- Keep `npm run view` as the normal entrypoint and preserve its CLI arguments.
- Keep the existing session HTTP API for external consumers, but do not use it
  from the React frontend.
- Replace the SSE endpoint with a WebSocket endpoint at `/ws`.
- Do not add OpenCode controls, authentication infrastructure, routing libraries,
  global state libraries, component libraries, or a CSS framework.

## Architecture

Use React, React DOM, Vite, and plain CSS in `frontend/`. The Node HTTP server
serves the generated frontend assets and handles WebSocket upgrades using `ws`.
Vite provides the development server and proxies `/ws` and `/api` to the viewer.
Production assets are bundled locally; the page needs no CDN or external fonts.

The frontend has a small set of focused components: `App`, `SessionSidebar`,
`ActivitySummary`, `EventFeed`, and `EventCard`. A `useViewer` hook owns the
WebSocket lifecycle, the received event collection, session summaries, and
connection status. Search and selection remain ordinary React state. Shared
transport types describe browser requests and server responses without importing
server runtime code into the browser.

## WebSocket protocol

The browser sends `{ type: "snapshot.request" }` after connecting. The server
responds with `{ type: "snapshot", sessions, events }`, containing current session
summaries and the full event history already retained by the viewer. After that
request, the connection receives `{ type: "event", message }` pushes for newly
published events. Invalid requests receive `{ type: "error", message }` without
crashing the server or changing recorded data.

Each transported event includes a viewer-local numeric ID and the existing
display fields: original event envelope, extracted content, command preview,
session title, and session summary. IDs are transport metadata, not modifications
to the native event. The raw event remains available unchanged.

Snapshot creation and subscription occur synchronously so live events cannot
overtake or disappear between the snapshot and live delivery. A new snapshot
replaces frontend event and session state instead of appending to it. Reconnects
therefore do not duplicate events, including when the server restarts. Search,
filters, and the selected session remain local UI state across reconnects.

## Behavior and lifecycle

Reconnect after a closed connection with a capped delay. Close the socket and
cancel retry timers when the hook unmounts. Show connecting, live, and reconnecting
states. Clean up disconnected server clients and close WebSockets when the viewer
shuts down. Reject cross-origin browser upgrades while allowing same-origin
connections and non-browser clients without an Origin header.

Retain newest-first display, current event classification and counting, and
browser receipt-time labels. Keep native details collapsed by default and render
event data as text, never injected HTML. Session selection updates the existing
`session` query parameter and follows browser back/forward navigation. Collapse
all affects only visible content-bearing events, as it does today.

## Build and development

Add a frontend build command. `npm run view` builds assets before starting the
existing viewer server, so a separate build step is not required for normal use.
`npm run view-dev` starts the watched backend and Vite frontend together and shuts
both down cleanly. Document the frontend development URL and unchanged receiver
port. Generated frontend assets are ignored by Git.

## Verification

- Typecheck server, frontend, shared transport types, and tests.
- Test static frontend serving and session HTTP API compatibility.
- Replace SSE tests with WebSocket snapshot, live delivery, replay, reconnect
  replacement, invalid request, and shutdown coverage.
- Test React behavior for filtering, counters, session URL navigation, collapse
  controls, raw details, and WebSocket lifecycle using a DOM test environment.
- Verify a production frontend build and run the complete existing test suite.
- Report unrelated pre-existing failures separately rather than silently changing
  plugin behavior.
