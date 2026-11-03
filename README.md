# OpenCode tracing plugin

Balrog records OpenCode activity through separate V1 and V2 implementations.
Both use the same recorder and HTTP receiver; there is no runtime version
detection.

```text
plugin/
  shared/recorder.ts   HTTP transport and file fallback
  v1/index.ts          OpenCode V1 hooks
  v2/index.ts          OpenCode V2 hooks
server/record.ts      Log recorder for both versions
server/view.ts        Live log event webpage
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

The event receiver listens on port 5001, and the web page is served separately
at <http://localhost:5002>. Open the page before or after starting OpenCode; it
shows incoming events and events already received during this viewer process. To
change the web page port, use `npm run view -- --port 8080`. By default the
viewer retains events in memory and does not write them to files. Events can
include prompt text, tool arguments, and tool results, so the receiver and page
bind to localhost by default.

The dashboard shows live event, session, and tool-call counts. Choose a session
in the sidebar, search event content or commands, and filter by event type to
narrow the feed. Expand **Raw event** to inspect the original JSON, or use
**Collapse all** to compact the visible events. The layout also adapts to mobile.

The viewer also exposes the analyzer's session summaries as JSON at
`http://localhost:5002/api/sessions` and an individual session at
`http://localhost:5002/api/sessions/<sessionID>`. `SessionAnalyzer` is available
from `server/analyzer.ts`; call `process(event)` for each log event, then use
`getSessionTitle(sessionID)`, `getSession(sessionID)`, or `getSessions()` to
query its in-memory state. Session rename events update the remembered title.

### Query tool executions

The viewer exposes recorded V2 tool executions at:

```text
GET http://localhost:5002/api/tool-executions
GET http://localhost:5002/api/tool-executions?session=<sessionID>
```

Without `session`, the endpoint selects the single most recently active session
by its latest event timestamp. Timestamp ties use the last received activity.
URL-encode the session ID when supplying it. The response has one entry per
tool-call ID, ordered by `startedAt` descending, with unknown start times last:

```json
{
  "sessionID": "session-1",
  "executions": [
    {
      "callID": "call-1",
      "command": { "name": "shell", "args": { "command": "npm test" } },
      "startedAt": 1700000000000,
      "completedAt": 1700000001000,
      "reason": "Run the tests to check the change.",
      "outcome": "The tests passed; no regression was detected by this suite.",
      "result": [{ "type": "text", "text": "All tests passed" }]
    }
  ]
}
```

- `command` preserves the tool name and full parsed arguments. V2 tool names
  come from `session.tool.input.started`, which the plugin now records. Older
  logs that lack the name return `name: null`.
- Timestamps are Unix milliseconds from the native events, or the time the
  analyzer processes an event if its source timestamp is absent. `startedAt`
  records `session.tool.called`, not the start of argument generation.
  `completedAt` is `null` until a success or failure is recorded. Partial logs
  can have a `null` start time or arguments.
- `reason` uses the explicitly instrumented intent when present. For older
  records, it falls back to an explicit recorded reason, an argument's
  `description`, or the latest preceding assistant text in the same assistant
  message and execution. Missing context returns `null`. These values are
  recorded statements, not inferred or verified explanations.
- `result` preserves the recorded result or content. Failures return
  `{ "error": ..., "content": ... }`. Missing results return `null`.
- `outcome` is the executing agent's report of what it learned or achieved
  relative to the reason. It remains `null` until explicitly reported. Use it
  for the table's human-readable result, and retain `result` as raw evidence.
  Reporting-tool calls are excluded from the execution list.

An unknown explicit session returns HTTP 404. With no recorded sessions, the
response is `{ "sessionID": null, "executions": [] }`. A known session with no
tool executions returns its ID and an empty array. There is no score or separate
table page. The endpoint exposes the same sensitive arguments and outputs as
the event feed and is intended for local use.

### Capture explicit tool intent

The V2 plugin instruments tool definitions with a required `__balrogReason`
argument. The agent must supply a short statement of the call's purpose and
expected outcome. This requests an action description, not private reasoning.

```json
{
  "path": "README.md",
  "__balrogReason": "Read the setup instructions before changing installation."
}
```

The plugin rejects missing, blank, or non-string reasons before the underlying
tool runs. It records a `balrog.tool.intent` event keyed by session ID and tool
call ID, strips `__balrogReason`, and delegates to the original executor with
its original context. The execution endpoint exposes this value as `reason`
and excludes the reserved field from `command.args`. Parallel calls are
associated by call ID, not by nearby commentary.

The transform applies to registered tools, including MCP and Code Mode tool
definitions, and is replayed when the tool catalog changes. Native Effect
schemas are projected to JSON Schema; standard schemas must provide a JSON
Schema projection. A tool that already declares the reserved argument cannot
be instrumented safely and its update is rejected by OpenCode. The V1 plugin
is unchanged.

After updating, reload the OpenCode plugin and restart `npm run view` so the
analyzer reads intent events. The recorder can already store these events, but
an older viewer does not expose them as `reason`. Existing executions are not
backfilled unless their saved events already contain explicit intent.

### Report what a tool achieved

The V2 plugin registers `balrog_reportOutcome`. After a tool finishes, the next
agent-loop model request lists pending call IDs, tool names, reasons, and
completion statuses. It asks the executing agent to report the concrete finding
for each call before its next action or final response. For example:

```json
{
  "callID": "call-123",
  "outcome": "Found MyDemoService as an example service."
}
```

In Code Mode, call `tools.balrog.reportOutcome({ callID, outcome })`. The
reporting invocation must not contain unrelated work. The reporting tool does
not require `__balrogReason` and does not prompt for its own
outcome. A reporting-only `execute` wrapper also does not trigger a further
report; a wrapper that also invokes ordinary tools still does.

Reports must refer to a completed instrumented call in the current session.
Missing or blank values, unknown call IDs, and calls still in progress are
rejected. Failed calls can be reported with an honest description of what could
not be achieved. Parallel calls are associated by session and call ID. An
explicit correction replaces the earlier outcome.

Each accepted report records a `balrog.tool.outcome` event. The analyzer attaches
it to the original execution without replacing the raw result or changing its
completion timestamp. The plugin does not generate summaries or score them.
These are agent-authored statements, not independently verified conclusions.

Reporting is requested through model instructions, not guaranteed by execution
hooks. If the agent is interrupted or does not report, `outcome` stays `null`.
Reloading the plugin clears its in-memory pending-call tracking; older calls
cannot be reported through the new instance. Saved outcome events can still be
replayed by the viewer. Restart the viewer to load the updated analyzer; without
database persistence, restarting loses its in-memory event history.

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
| Before a tool | `tool.execute.before` | `tool.execute.before` |
| After a tool | `tool.execute.after` | `tool.execute.after` (completed or error) |
| User input | `chat.message` | `session.prompt` |
| Before a command | `command.execute.before` | No equivalent global hook |

V1 hook records preserve `{ input, output }`. V2 hook records contain
`{ event }` with the native V2 payload; they are not payload-compatible with V1.

V2's prompt hook runs before durable prompt admission, not after a chat message
is persisted. Commands that submit through `session.prompt` also trigger it, but
it is not a general command-execution trace. Prompt admission retries can
produce duplicate observations. V2 hook registrations are disposed automatically
when the plugin unloads.

## Development

These commands work in both PowerShell and Linux shells:

```sh
npm run typecheck
npm test
```

Tests exercise the recorder, live viewer, and both entrypoints with mocked
OpenCode contexts. Also validate loading and real tool/prompt activity in each
target OpenCode release before distributing the plugin.
