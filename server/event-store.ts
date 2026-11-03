import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LogEvent } from "./log-receiver.js";
import { eventMetadata } from "./event-metadata.js";

/** Durable SQLite storage for viewer events. */
export class SQLiteEventStore {
  private readonly database: DatabaseSync;
  private readonly insertStatement;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        plugin_id TEXT,
        event_type TEXT,
        session_id TEXT,
        event_json TEXT NOT NULL
      )
    `);
    const columns = new Set(this.database.prepare("PRAGMA table_info(events)").all()
      .map((column) => column["name"]));
    for (const [name, type] of Object.entries({ timestamp: "INTEGER", plugin_id: "TEXT", event_type: "TEXT", session_id: "TEXT" })) {
      if (!columns.has(name)) this.database.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
    }
    this.insertStatement = this.database.prepare(
      `INSERT INTO events (timestamp, plugin_id, event_type, session_id, event_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
  }

  append(event: LogEvent): void {
    const metadata = eventMetadata(event);
    const { envelope } = metadata;
    const pluginID = typeof envelope["pluginID"] === "string"
      ? envelope["pluginID"]
      : null;

    this.insertStatement.run(
      Math.trunc(metadata.timestamp),
      pluginID,
      metadata.tag,
      metadata.sessionID ?? null,
      JSON.stringify(event),
    );
  }

  readAll(): LogEvent[] {
    const rows = this.database
      .prepare("SELECT event_json, timestamp FROM events ORDER BY id")
      .all();
    return rows.map((row) => {
      const event = JSON.parse(String(row["event_json"])) as LogEvent;
      // Preserve recording time on replay instead of assigning the server restart time.
      if (eventMetadata(event).timestampSource === "received" && typeof row["timestamp"] === "number") {
        return { ...event, created: row["timestamp"] } as LogEvent;
      }
      return event;
    });
  }

  close(): void {
    this.database.close();
  }
}
