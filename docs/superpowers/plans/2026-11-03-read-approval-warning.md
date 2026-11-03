# Read Approval Warning Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution.

**Goal:** Add a distinctive, accessible sensitive-read alarm and trigger a safe live example.

**Architecture:** A small React component detects new pending request identities and renders a temporary, pointer-transparent screen-edge glow. Existing approval cards receive CSS-only warning treatments; native permission transport stays unchanged.

**Tech Stack:** React, TypeScript, CSS, Tailwind, Vitest, OpenCode V2 API.

---

- [x] Add failing `frontend/src/ReadWarning.test.tsx` tests for arrival, duplicate snapshots, additional requests, timeout cleanup, and offline/replying requests.
- [x] Add `frontend/src/ReadWarning.tsx` with identity-based arrival detection and a cleanup-safe 1.8-second lifetime; integrate into `frontend/src/App.tsx`.
- [x] Add a warning icon to `frontend/src/Icon.tsx` and warning styling to `frontend/src/PermissionRequests.tsx`. Keep existing actions and accessible labels.
- [x] Add CSS screen glow, card sweep, and slow pulse to `frontend/src/styles.css`, with a `prefers-reduced-motion` override disabling all three animations.
- [x] Run warning/approval frontend tests, typecheck, production build, and diff checks. Keep unrelated baseline failures out of scope.
- [x] Trigger a native permission request using a harmless demo appsettings resource and confirm it is present in the live viewer snapshot. Never auto-approve the demo.
