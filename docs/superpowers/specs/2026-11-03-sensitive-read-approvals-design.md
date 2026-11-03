# Sensitive read approvals

## Scope

The V2 plugin forces native permission requests for reads matching a constant
sensitive-path list, including `.env`, `.env.*`, `appsettings.json`,
`appsettings.*.json`, package-registry credentials, SSH private keys, PEM/key
files, AWS credentials, and Kubernetes configuration. Match normalized Windows
and POSIX paths and resolve symlinks when checking actual read resources.
Configured deny rules stay final. V1 and non-read actions are unchanged.

## Flow

Register `permission.evaluate`, setting matching non-denied reads to `ask`.
Observe the resulting `permission.asked` event and keep its native request ID.
A dedicated plugin WebSocket connects to `/permissions` on the log receiver's
origin. The viewer process shares an in-memory permission broker between its
receiver and browser WebSocket server. The recorder-only process has no bridge.

Live plugin connections synchronize pending requests with the broker. Browser
snapshots include those requests, separately from historical log events. The
frontend shows paths and session identification, never file contents, with
Accept once and Reject buttons. Accept maps to native `decision: "once"`;
Reject maps to `decision: "reject"`. Native replies remove requests in Balrog,
including replies originating in OpenCode. Reply errors remain visible and
retryable. Concurrent or stale replies cannot approve a different request.

## Lifecycle and safety

No connection failure grants permission. OpenCode remains the authority and its
native prompt remains usable when Balrog is unavailable. Reconnecting plugin
connections resynchronize pending native requests; disconnected plugin requests
are not actionable in the browser. Browser reconnects request a fresh snapshot.
Plugin unload stops retries and closes its socket. Native session interruption
and deletion clear pending requests. Recorded events never create approvals.

Browser WebSockets retain same-origin validation. The plugin endpoint rejects
browser Origin headers and accepts only validated messages. The services remain
localhost-only. This is a read-permission integration, not a sandbox for shell
commands or tools which do not call OpenCode's read permission API.

## Verification

Cover path patterns and false positives, symlinks, evaluation changes, native
request identity, accept/reject, native replies, errors, duplicate requests,
browser/plugin reconnects, connection ownership, session cancellation, cleanup,
origin checks, and historical replay isolation. Run typecheck, frontend tests,
the production build, and server tests. Record pre-existing failures separately.
