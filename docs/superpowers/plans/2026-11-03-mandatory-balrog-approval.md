# Mandatory Balrog Approval Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution.

**Goal:** Require an explicit Balrog frontend decision for every sensitive read, regardless of CLI autoaccept.

**Architecture:** Suspend the existing evaluation hook on a private, correlated Balrog gate. Reuse the WebSocket protocol and UI, keeping private gates separate from native request tracking so native replies cannot release them.

**Tech Stack:** TypeScript, OpenCode V2, ws, node:test, Vitest.

---

- [x] Add failing regression coverage in `tests/permissions.test.ts` proving sensitive evaluation does not complete before a browser decision and native replies cannot release it.
- [x] Implement private gates, exact decision handling, ownership checks, and fail-closed lifecycle cleanup in `plugin/v2/permissions.ts`. Preserve gates through transport snapshots and reconnects.
- [x] Update existing evaluation tests and add rejection, disabled transport, cancellation/unload, identity isolation, and reconnect coverage.
- [x] Update `README.md` to document mandatory frontend approval and the absence of a native-only fallback. Leave global CLI settings untouched.
- [x] Run typecheck, targeted backend/frontend tests, production build, and diff checks. Code review skipped at the user's request.
- [x] Reload the plugin through the supported location reload API and verify a real harmless read waits for a frontend decision with CLI autoaccept still enabled.

Live verification: the actual read tool created a private Balrog gate, waited
17,994 milliseconds for a frontend decision, and returned `permission.rejected`
with `Sensitive file read rejected in Balrog.` No file contents were returned.
CLI autoaccept remained enabled. Typecheck, production build, 48 targeted
backend tests, and 12 targeted frontend tests passed.
