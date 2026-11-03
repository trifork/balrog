# OpenCode tracing plugin

Balrog records OpenCode activity through separate V1 and V2 implementations.
Both use the same recorder and HTTP receiver; there is no runtime version
detection.

```text
plugin/
  shared/recorder.ts   HTTP transport and file fallback
  v1/index.ts          OpenCode V1 hooks
  v2/index.ts          OpenCode V2 hooks
  v2/tui.ts            OpenCode V2 sidebar session link
server/record.ts      Log recorder for both versions
server/view.ts        Live viewer HTTP and WebSocket server
frontend/            React viewer built with Vite
shared/              Viewer WebSocket protocol types
```

## Install on Windows

Install Node.js with npm, then run in PowerShell:

```powershell
Set-Location C:\code\hackerdays\balrog
npm ci
```

Check your OpenCode version with `opencode --version` and select **one**
entrypoint below. Replace the checkout path if necessary. No symlink or
administrator access is needed. Keep the whole checkout in place: the
entrypoints import the shared recorder.

Merge the relevant settings into your global
`$HOME\.config\opencode\opencode.jsonc` (normally
`C:\Users\PTD\.config\opencode\opencode.jsonc` on this machine), or a project's
`opencode.jsonc`. Preserve any existing settings and plugin entries.

### OpenCode V1

Use the V1 file entrypoint with the singular `plugin` key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///C:/code/hackerdays/balrog/plugin/v1/index.ts"]
}
```

The original `plugin/opencode-balrog.ts` path remains a V1 compatibility
entrypoint. Remove any old auto-discovered copy or symlink before adding the
configuration above, so the plugin does not load twice.

### OpenCode V2

Use the V2 **directory** with the plural `plugins` key. V2 skips configured
paths to individual files.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/code/hackerdays/balrog/plugin/v2"]
}
```

For a project config in this repository, `"./plugin/v2"` also works. Relative
paths resolve from the config file. Config changes reload automatically in V2;
use `/reload` to force a reload if needed.

The V2 implementation targets the `@opencode/plugin` 2.2.0 API. The V1
implementation uses the `@opencode-ai/plugin` 1.19.x hook API and does not
import the V2 SDK at runtime.

## Install on Linux

Install Node.js with npm, then run in your shell:

```sh
cd /home/user/code/balrog
npm ci
opencode --version
```

Replace `/home/user/code/balrog` with your actual checkout path. Keep the whole
checkout in place so the entrypoints can import the shared recorder. No symlink
or root access is needed.

Merge **one** of the following configurations into
`~/.config/opencode/opencode.jsonc`, or a project's `opencode.jsonc`. If you use
`XDG_CONFIG_HOME`, the global file is `$XDG_CONFIG_HOME/opencode/opencode.jsonc`
instead. Preserve existing settings and plugin entries.

### OpenCode V1

Use the V1 file URL with the singular `plugin` key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///home/user/code/balrog/plugin/v1/index.ts"]
}
```

Remove any old auto-discovered copy or symlink to avoid loading the plugin
twice.

### OpenCode V2

Use the V2 directory with the plural `plugins` key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/user/code/balrog/plugin/v2"]
}
```

Use your actual absolute path in these JSON examples, not shell expressions such
as `$HOME`. For a project config in this repository, `"./plugin/v2"` also works.
V2 reloads config changes automatically; use `/reload` to force a reload if
needed.

To specify explicitly the endpoint to forward log entries to you can specify the
`logEndpoint` option:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/home/user/code/balrog/plugin/v2",
      "options": {
        "logEndpoint": "http://localhost:5001/log",
        "logPath": "balrog.jsonl"
      }
    }
  ]
}
```

The API versions and tracing differences are the same on Windows and Linux.

### OpenCode V2 sidebar link

The V2 directory also includes a TUI entrypoint that adds a **Balrog** section
to OpenCode's session sidebar. Its link opens the frontend with the current
session selected, for example `http://localhost:5001/?session=ses_123`. It stays
available between prompts and updates when you switch sessions. OpenCode
discovers this entrypoint automatically when the V2 plugin directory is configured;
reload the plugin after updating Balrog.

Run `npm run view` separately so the frontend is available and receives the
session's events. To use a different frontend address, add `viewerURL` alongside
the V2 plugin's other options:

```jsonc
{
  "package": "/home/user/code/balrog/plugin/v2",
  "options": {
    "logEndpoint": "http://localhost:5001/log",
    "viewerURL": "http://localhost:8080/"
  }
}
```

`viewerURL` must be an absolute HTTP or HTTPS URL reachable from your browser.
It defaults to the same origin as `logEndpoint`, `http://localhost:5001/`.
For frontend development, use `http://localhost:5173/`. Opening the link directly
from the terminal requires terminal hyperlink support; otherwise copy the
displayed URL into your browser. The sidebar integration is V2-only; the V1
plugin continues recording events without adding sidebar content.

## Record events

In a separate terminal, run the commands for your platform.

**Windows (PowerShell):**

```powershell
Set-Location C:\code\hackerdays\balrog
npm run record
```

**Linux:**

```sh
cd /home/user/code/balrog
npm run record
```

The recorder listens on `http://localhost:5001/log` and writes
`balrog-<pluginID>[-<sessionID>].jsonl` files in its working directory. The
working directory is the default log directory. To choose another directory:

**Windows (PowerShell):**

```powershell
npm run record -- --log C:\logs\balrog
```

**Linux:**

```sh
npm run record -- --log "$HOME/logs/balrog"
```

Start the recorder before loading the plugin to capture initialization there.
The optional `logPath` plugin option appends every record as a JSON line to that
file, whether or not delivery to the receiver succeeds. If `logPath` is unset,
receiver errors or timeouts do not create a local log file. The optional
`logEndpoint` defaults to `http://localhost:5001/log`; set it to an empty string
to disable receiver delivery.

Logs include prompt text, tool arguments, and tool results, which may contain
sensitive data. Treat these files accordingly and do not commit them.

## View events live

Run the viewer instead of the recorder to receive events on the same
`http://localhost:5001/log` endpoint while displaying them in a browser:

```sh
npm run view
```

This builds the React frontend and starts one server at <http://localhost:5001>.
The server receives events at `/log` and serves the live viewer, its APIs, and
WebSockets from the same port. Open the page before or after starting OpenCode; it
shows incoming events and events already received during this viewer process. To
change the server port, use `npm run view -- --port 8080` and configure both
`logEndpoint` and `viewerURL` with that origin. By default the
viewer retains events in memory and does not write them to files. Events can
include prompt text, tool arguments, and tool results, so the receiver and page
bind to localhost by default.

The frontend uses a same-origin WebSocket at `/ws` for two-way viewer
communication. After connecting, it sends `{ "type": "snapshot.request" }`.
The server replies with `{ "type": "snapshot", "sessions": [...], "events": [...] }`
and then pushes new events as `{ "type": "event", "message": {...} }`. Invalid
requests receive `{ "type": "error", "message": "..." }`. Each message includes
a viewer-local numeric ID alongside the original event envelope and display
metadata. The native event is not modified. Reconnecting requests a fresh
snapshot and replaces the feed, avoiding duplicate events. The old `/events`
SSE endpoint is no longer available. WebSocket permission replies can release
live sensitive-read gates in OpenCode V2; historical events are read-only.
File-tree state is attached as `fileActivity`; when one event affects several
prompts, additional prompt snapshots are included in `fileActivityUpdates`.

The dashboard centers **File heatmap**: a live heatmap with observed
files as rows and recorded prompts as columns. Choose a session using the header
tabs, or use **All sessions** to see activity across sessions. Search full file
paths, collapse folders, and switch between **All activity**, **Reads**, and
**Changes**. Cell intensity counts successful file operations on a fixed scale
(0, 1, 2–3, 4–7, 8+). The session
totals show observed files, prompts, and successful file operations.

The inspector initially aggregates all prompts in the selected session while the
heatmap keeps every prompt column visible. Select a prompt candle or a cell to
filter the inspector and related events. The selected column is outlined, with
lighter cell backgrounds that preserve heat levels and reverted markers.
Select the candle again or choose
**All prompts** to restore the session summary. Candles stack green creations,
blue edits (including writes), and red deletions in proportion to successful,
unreverted file-change operations. Height and the number above each candle show
change volume; hover for counts and percentages. Reads, pending and failed
attempts, and reverted actions do not contribute to these proportions. Prompts
with no confirmed changes retain a neutral, clickable candle. Late tool outcomes
and undo/redo updates refresh their original columns without moving the selection.
Arrow keys move between cells, and Enter or Space selects one. On mobile, the
inspector opens as a dismissible bottom sheet.

File badges distinguish reads, edits, writes, additions, and deletions. Writes
may create or overwrite a file. Pending and failed attempts remain visible as
cell markers and badges but contribute no heat or confirmed changes. The
inspector's touched-file count includes files with successful operations;
the observed-file total also includes files with pending or failed attempts.
Undone changes include **(Reverted)** in their action badge, such as
**Edit (Reverted)** or **Write (Reverted)**, instead of a separate badge.
Reverted operations remain in **All activity** but are excluded from **Changes**
and confirmed-change counts; any still-active changes
to the same file retain their normal badges and continue to count. The viewer
uses OpenCode V2's explicit `session.revert.staged`, `session.revert.cleared`,
and `session.revert.committed` events to track undo, redo, and committed
reversions. It also recognizes successful `edit`/`multiedit` replacements and
`patch`/`apply_patch` hunks that reverse earlier recorded changes, even without
a native revert event. This supports prompts such as "make a small change and
then revert it again" and works when replaying existing recordings. Matching
requires recorded before/after text and context; unknown or intervening changes
are not guessed. Git status, Git restores, and shell-script cleanup do not mark
changes reverted. Undo can update an earlier prompt without switching the selected prompt. The
badge applies to recorded edits, not proof that the whole file matches its
original contents. Restorations without the required recorded evidence are not
detected; the viewer never checks the current filesystem to rewrite history.
The heatmap contains observed files only, not a full workspace inventory.
File tools accept `path`, `filePath`, and `file_path` arguments. Reads that return
an explicit directory listing are excluded from the file count.

Expand **Event stream** beneath the heatmap for the full event feed, or choose
**Inspect related events** in the inspector to show events associated with the
selected prompt or file. **Show all events** clears that scope. Search event
content or commands and filter by event type to narrow the feed further.
Opening the stream and following live events keep the search and filters in
view above the newest events; explicit timeline jumps center the selected event.
Event
content starts collapsed; use **Expand all** to show visible event content or
**Collapse all** to compact it again. New events inherit the current collapse
state. Expand **Raw event** to inspect the original JSON. Search, filters, and
expanded raw details survive live updates.

The bottom timeline shows the selected session's prompt and command history,
independently of event-stream filters. Click an event, or activate it with Enter
or Space, to open the stream and pause playback at that point. Dragging, scrolling,
prompt-navigation buttons, keyboard navigation, and pausing live playback change
the playback position without opening the stream. The heatmap and inspector show
recorded file activity up to that position, including the pending, failed, and
reverted states recorded then; later events do not change this historical view.
Numbered prompt markers use the
same boundaries as the file heatmap, and previous/next prompt navigation centers
the handle, including at the first and last events. **Go live** restores the latest
heatmap and resumes incoming events. Recording and live read approvals continue
updating while playback is paused.

The viewer recognizes V1 prompt/tool hooks and V2 delivered user prompts and
file-tool events, including multi-file `patch` and `apply_patch` calls. V2 also records
`session.inbox.enqueued`, `session.inbox.delivered`, and
`session.tool.input.started` to capture prompt text and tool names, plus
`session.revert.staged`, `session.revert.cleared`, and `session.revert.committed`
to track undo and redo. Reload the
V2 plugin after updating it. Older recordings without prompt events use labeled
execution groups; missing prompt boundaries are labeled unattributed. Shell
commands, search results, and diffs are not inferred. Calls belong to the prompt
active when they were observed, with completion linked by call ID; this is not
causal attribution for concurrent prompts or agents. Activity is reconstructed
when replaying a SQLite recording.

### Approve sensitive file reads

The V2 plugin registers a `permission.evaluate` hook that requires approval for
reads matching the constant `SENSITIVE_FILES` list in
`plugin/v2/sensitive-files.ts`, even when the ordinary read rules allow access or
the OpenCode CLI has `session.permissions: "autoaccept"`:

- `.env` and `.env.*`
- `appsettings.json` and `appsettings.*.json`
- `.npmrc`, `.pypirc`, and `.netrc`
- SSH private-key names: `id_rsa`, `id_ed25519`, `id_ecdsa`, and `id_dsa`
- `*.pem` and `*.key`
- `.aws/credentials` and `.kube/config`

Matching handles Windows and POSIX separators, case-insensitive file names, and
resolved symlink targets. Explicit OpenCode deny rules remain final. Other read
requests and non-read actions are unchanged. This is not a filesystem sandbox:
shell commands and tools that do not request OpenCode's `read` permission are
outside this hook's scope. V1 is unchanged.

Run `npm run view` and open the frontend. Pending sensitive reads appear in
**Read approvals**, above the event feed regardless of the selected session or
search filters. **Accept once** approves that exact pending gate and releases
only that read; **Reject** denies it. Each read requires its own
approval. The plugin holds permission evaluation on a private Balrog gate before
OpenCode can publish or auto-accept a native prompt. Native permission replies
cannot release that gate, and approval in Balrog avoids a second OpenCode
prompt. Ordinary autoaccept settings remain unchanged. Requests show file paths
and session identity, not file contents.

The plugin connects over WebSocket to `/permissions` on the same origin as
`logEndpoint` (`ws://localhost:5001/permissions` by default). Setting `logEndpoint` to an empty
string disables the connection and denies sensitive reads, since frontend
approval is mandatory. The recorder-only `npm run record` process does not
provide approval controls; use the viewer to approve sensitive reads.

Browser and plugin connections reconnect automatically. Pending gates remain in
the plugin and are resynchronized after a transport reconnect. Disconnected
plugins have no actionable requests in the browser, and their reads stay
blocked. An outage, timeout, or failed reply never grants permission; there is no
native-only fallback. Interrupting a session or unloading the plugin denies its
unresolved gates. After a plugin reload, retry any cancelled reads. Recorded or
replayed permission events never create actionable requests. The plugin endpoint rejects
browser Origin headers, while browser approval messages use the viewer's
same-origin WebSocket. The server also restricts Host headers to `localhost`,
`127.0.0.1`, or `[::1]` to prevent DNS rebinding. Keep the server on localhost
and use only trusted local clients. Pre-existing native prompts remain mirrored
for compatibility, separately from mandatory Balrog gates.

The viewer also exposes the analyzer's session summaries as JSON at
`http://localhost:5001/api/sessions` and an individual session at
`http://localhost:5001/api/sessions/<sessionID>/summary`. `SessionAnalyzer` is available
from `server/analyzer.ts`; call `process(event)` for each log event, then use
`getSessionTitle(sessionID)`, `getSession(sessionID)`, or `getSessions()` to
query its in-memory state. Session rename events update the remembered title.

### Session heatmap

`GET http://localhost:5001/api/sessions/<sessionID>/heatmap` returns
`{ schemaVersion: 1, sessionID, items }`, a chronological timeline of user prompts,
file reads, changes, and grep searches. Commands and LLM text remain in raw logs
but are excluded here. Types are defined in `server/session-activity.ts`; use
`SessionAnalyzer.getSessionActivity(sessionID)` in TypeScript.

Each item includes `id`, `kind`, `timestamp` (Unix milliseconds), `timestampSource`,
and source event metadata. Optional `rationale` comes only from explicit tool
arguments, never inferred reasoning. File operations have `status` (`pending`,
`completed`, or `failed`) and optional `completedAt`/`error`; filter on
`status === "completed"` to exclude attempted or failed operations.

Changes use `created`, `modified`, or `deleted`; writes are conservatively treated
as modifications. Grep separates search scope from matched files, not all scanned
files. Indirect shell access, unknown tools, and missing historical events cannot
be reconstructed. Timestamps prefer source time, then recorded time, then receipt
time, as indicated by `timestampSource`.

### Query tool executions

The viewer exposes recorded V2 tool executions and observed skill activations at:

```text
GET http://localhost:5001/api/tool-executions
GET http://localhost:5001/api/tool-executions?session=<sessionID>
```

Without `session`, the endpoint selects the single most recently active session
by its latest event timestamp. Timestamp ties use the last received activity.
URL-encode the session ID when supplying it. The `executions` array is unchanged:
one entry per tool-call ID, ordered by `startedAt` descending, with unknown start
times last. Skill activations are listed separately in `skills`:

```json
{
  "sessionID": "session-1",
  "executions": [
    {
      "callID": "call-1",
      "command": { "name": "shell", "args": { "command": "npm test" } },
      "startedAt": 1700000000000,
      "completedAt": 1700000001000,
      "reason": null,
      "outcome": null,
      "result": [{ "type": "text", "text": "All tests passed" }]
    }
  ],
  "skills": [
    {
      "id": "review",
      "name": "Review",
      "activatedAt": 1699999999000,
      "timestampSource": "event",
      "source": "prompt",
      "inboxID": "prompt-1"
    }
  ]
}
```

- `command` preserves the tool name and full parsed arguments. V2 tool names
  come from `session.tool.input.started`, which the plugin now records. Older
  logs that lack the name return `name: null`.
- Timestamps are Unix milliseconds from the native events, or the time the
  recorder records it, falling back to processing time if both are absent. `startedAt`
  records `session.tool.called`, not the start of argument generation.
  `completedAt` is `null` until a success or failure is recorded. Partial logs
  can have a `null` start time or arguments.
- `reason` and `outcome` preserve explicit historical annotations when present.
  New passive recordings leave them `null`. The endpoint does not infer a
  purpose from nearby commentary or a tool argument's `description`.
- `result` preserves the recorded result or content. Failures return
  `{ "error": ..., "content": ... }`. Missing results return `null`.
- Historical reporting-tool calls are excluded from the execution list.

The additive `skills` array lists observed skill activations, newest first.
It does not add fields or synthetic entries to `executions`:

- `source: "prompt"`: structured skills from
  `session.inbox.enqueued.data.item.payload.skills`, confirmed by
  `session.inbox.delivered` with the same session and `inboxID`. Queued or
  cancelled attachments alone and plain `@skill` text do not count.
- `source: "tool"`: a `skill` tool name and its `id` (or legacy `name`) argument,
  correlated with a successful completion by session and `callID`. Failed or
  unfinished attempts do not count as activations. Skill-tool calls remain in
  `executions` unchanged; successful loads also appear here, linked by `callID`.
- `source: "native"`: a recorded `session.skill.activated` event.

Each skill entry includes its `id`, `name` (falling back to its ID), `activatedAt`
in Unix milliseconds, and `timestampSource` (`event`, `recorded`, or `received`).
Prompt entries include `inboxID`, tool entries include `callID`, and native event
IDs are preserved as `eventID` when available. Prompt timestamps use delivery
time; tool activation timestamps use successful completion time. Skill instructions
are not copied into this list; the original evidence remains in the raw events/results.
These observations are reconstructed on replay as well as during live capture.

Repeated invocations are retained, while duplicate event IDs, inbox deliveries,
and tool completions are not counted twice. Native activations have no inbox or
tool-call identity, so potentially overlapping native and derived evidence stays
separate rather than guessing which invocation it belongs to. This is an evidence
list, not a unique activation count or a list of skills currently active. Missing
events cannot be reconstructed, and no deactivation or model adherence is inferred.

An unknown explicit session returns HTTP 404. With no recorded sessions, the
response is `{ "sessionID": null, "executions": [], "skills": [] }`. A known
session with no tool executions or skill activations returns its ID and empty
arrays. There is no score or separate table page. The endpoint exposes the same
sensitive arguments and outputs as the event feed and is intended for local use.

### Query the recorded conversation

Retrieve the entire recorded session and its tool executions in one request:

```text
GET http://localhost:5001/api/sessions/<encoded-session-id>/conversation
GET http://localhost:5001/api/sessions/<encoded-session-id>/conversation?before=<unix-ms>
```

The JSON response contains `sessionID`, chronological raw `events`, chronological
`executions`, and `recording` metadata. Events include recorded user prompts,
assistant messages, tool arguments, results, errors, and compaction events.
The optional `before` cutoff applies to all events, not just tool start times.
Executions are reconstructed from that snapshot, so a result received after the
cutoff does not appear on an earlier call. Equal timestamps retain receipt order.

`recording` includes `source: "recorded-events"`, the cutoff, excluded-event and
unknown-timestamp counts, evidence limits, and associated plugin initialization
records in `contexts`. Events without a source or recorder timestamp remain in
the snapshot, ordered last. Their relation to the cutoff is unknown.

The session ID is required. An unknown session returns 404; malformed IDs and
invalid cutoffs return 400. Responses use `Cache-Control: no-store`. This local
endpoint exposes sensitive conversation content just like the existing event
feed. It does not invoke a model or execute recorded commands.

This is the conversation Balrog received, not a reconstruction of missing
history. Messages from before recording, unavailable attachment contents, and
unrecorded context cannot be recovered. Saved events replayed from SQLite are
included, so OpenCode compaction does not remove previously recorded evidence.

### Review a session with /retro

The V2 plugin registers the bundled `retro` skill and a slash command:

```text
/retro
/retro ses_example
```

Without an ID, `/retro` reviews the calling session, not the most recently active
session in Balrog. With an ID, it reviews that session while keeping the
conversation in the caller's session. The command attaches the skill explicitly
and captures a cutoff so the review does not grade its own activity.

The skill retrieves one conversation snapshot and reads the entire chronological
investigation. It assigns each call a reason and outcome after the fact, using
the task, preceding discussion, arguments, and raw results. These are explicitly
labeled retrospective assessments, not original agent reports. Unsupported
purposes or results remain unknown; pending calls remain pending. Historical
annotations are supporting evidence, not independently verified conclusions.

The default call table contains a numeric `id` (1, 2, 3, ...), command, reason,
and outcome. A separate table covers higher-level improvements with `LOW`,
`MEDIUM`, or `HIGH` complexity and expected gain, supporting numbered calls,
and a concrete validation plan. Timestamps and raw call IDs appear only on request.

The model assesses all calls together in one analysis pass after retrieval.
Neither the endpoint nor the helper makes model requests. The skill prohibits
per-tool model requests or per-tool agents. Conversations too large for one
context window can use at most three chronological analysis passes, including
synthesis. If that cannot cover the evidence, the skill asks for a narrower
range rather than silently dropping it. It discloses chunking and truncation.

Examples cover `AGENTS.md` task-routing instructions, links to verified code
examples, feature-local documentation, generated navigation aids, and justified
file or module restructuring. The review considers dependent calls together and
does not treat an honest intermediate finding as a failed investigation. It
assesses the completed trace without requiring the original agent to supply
reasons or outcomes. Assessments are report-only; source records are unchanged.

This is a read-only retrospective. It proposes changes and validation steps;
applying them requires separate approval. Balrog must be reachable at
`http://localhost:5001` unless the user supplies another endpoint. If the session
is missing, the skill reports that instead of choosing another session.

The source is `skills/retro/SKILL.md`; its portable Node helper is
`skills/retro/scripts/fetch-session.mjs`. Reload the plugin after updating the
bundled skill. Other compatible harnesses can load the same skill directory;
they must supply a current OpenCode session ID or ask for one when unavailable.

### Passive recording

The V2 recorder subscribes to native session events without changing tool
schemas, arguments, results, or model instructions. Tools no longer require
`__balrogReason`. The live `balrog_reportOutcome` reporting tool and pending-call
reminders have been removed. No reason/outcome bookkeeping adds model turns to
the working session. The sensitive-file permission integration is unchanged.

Reload the plugin and restart the viewer after updating. Existing saved intent
and outcome events remain readable for historical compatibility. New assessments
happen only when `/retro` is requested; there is no assessment write endpoint.

### Persist recordings

To persist events in a SQLite database and replay all saved events on startup,
pass a database filename to the viewer:

```sh
npm run view -- --db ./logs/balrog.sqlite
```

The viewer creates the database and parent directory if needed. If the database
already exists, saved events are loaded in insertion order before the receiver
starts accepting new events. Each row stores `timestamp` (Unix milliseconds),
`plugin_id`, `event_type`, `session_id`, and the full `event_json`. The timestamp
uses the source event time when present, otherwise the time the viewer records
it. Existing rows are not backfilled; their new metadata columns remain `NULL`.
The database is append-only; without `--db`, the viewer remains in-memory only.
This uses Node's built-in `node:sqlite` module, available without an experimental
flag in Node.js 22.13 and later.

## Traced activity

Every record includes `tag`, `sessionID`, `pluginID` (per plugin instance), and
`apiVersion` (`v1` or `v2`). Initialization has a null session ID.

| Activity | V1 | V2 |
| --- | --- | --- |
| Initialization | `initialize` | `initialize` |
| Before a tool | `tool.execute.before` | `session.tool.called` |
| After a tool | `tool.execute.after` | `session.tool.success`, `session.tool.failed` |
| User input | `chat.message` | `session.inbox.enqueued` (user items) |
| Tool names | Included in hooks | `session.tool.input.started` |
| LLM text | Not captured | `session.text.ended` |
| Before a command | `command.execute.before` | No equivalent global hook |

V1 hook records preserve `{ input, output }`. V2 records contain the native event
directly under the tag; the analyzer also accepts older `{ event }` wrappers.
They are not payload-compatible with V1. V2 captures prompts at durable inbox
admission, not through the pre-admission prompt hook.

V2 shares one server-wide event subscription across loaded Balrog locations and
plugin module evaluations. Events with a location are recorded by that location's
plugin instance, using its `logEndpoint`, `logPath`, and `pluginID`. Events without
a location are recorded once by the instance that owns the subscription. Each
location still has its own initialization record, tool instrumentation, and
permission connection. Unloading the subscription owner transfers recording to a
remaining location; unloading the last location aborts the subscription and
releases the shared state. Each location has an ordered write queue, so a slow
write does not block event intake or other locations. Unloading flushes that
location's pending writes and reports its write failures without stopping the
other locations' recording.

## Development

These commands work in both PowerShell and Linux shells:

```sh
npm run view-dev
npm run build
npm run typecheck
npm test
```

`npm run view-dev` starts the watched Node backend and Vite together. Open
<http://localhost:5173> for frontend development; Vite proxies WebSockets and
the session HTTP API to the unified backend on port 5001. Stop both processes
with Ctrl+C. `npm run build` only generates the static
frontend in `frontend/dist/`; generated files are not committed. For backend
development on its own, use `npm run dev:server`.

The frontend uses React, TypeScript, and plain CSS, without a router or global
state library. Its components live in `frontend/src/`; `useViewer.ts` owns the
WebSocket lifecycle, and `shared/viewer-protocol.ts` defines transport types.

`npm test` runs React behavior tests, builds the frontend, then runs the server
tests. Use `npm run test:frontend` or `npm run test:server` to run either suite
separately. Tests exercise filtering, navigation, collapse controls, reconnects,
WebSocket snapshots and live delivery, the recorder, and both plugin entrypoints
with mocked OpenCode contexts. Also validate loading and real tool/prompt
activity in each target OpenCode release before distributing the plugin.
