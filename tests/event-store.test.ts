import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { LogEvent } from "../server/log-receiver.js";
import { SQLiteEventStore } from "../server/event-store.js";

test("SQLite event store persists events and reads them in insertion order", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "balrog-sqlite-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "events.sqlite");
  const first = {
    tag: "initialize",
    sessionID: null,
    pluginID: "plugin-1",
    apiVersion: "v2",
    initialize: { context: {} },
  } as unknown as LogEvent;
  const legacyDatabase = new DatabaseSync(filename);
  legacyDatabase.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_json TEXT NOT NULL
    )
  `);
  legacyDatabase.prepare("INSERT INTO events (event_json) VALUES (?)")
    .run(JSON.stringify(first));
  legacyDatabase.close();

  const second = {
    tag: "session.execution.started",
    sessionID: "session-1",
    pluginID: "plugin-1",
    apiVersion: "v2",
    "session.execution.started": {
      event: {
        type: "session.execution.started",
        created: 1_700_000_000_000,
        data: { sessionID: "session-1" },
      },
    },
  } as unknown as LogEvent;

  const firstStore = new SQLiteEventStore(filename);
  firstStore.append(second);
  firstStore.close();

  const reopenedStore = new SQLiteEventStore(filename);
  t.after(() => reopenedStore.close());
  assert.deepEqual(reopenedStore.readAll(), [first, second]);
  reopenedStore.append(first);
  assert.deepEqual(reopenedStore.readAll(), [first, second, first]);

  const metadataDatabase = new DatabaseSync(filename);
  const rows = metadataDatabase.prepare(`
    SELECT timestamp, plugin_id, event_type, session_id FROM events ORDER BY id
  `).all().map((row) => Object.fromEntries(Object.entries(row)));
  metadataDatabase.close();
  assert.deepEqual(rows[0], {
    timestamp: null,
    plugin_id: null,
    event_type: null,
    session_id: null,
  });
  assert.deepEqual(rows[1], {
    timestamp: 1_700_000_000_000,
    plugin_id: "plugin-1",
    event_type: "session.execution.started",
    session_id: "session-1",
  });
  assert.ok(typeof rows[2]["timestamp"] === "number");
});
