import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LogEvent } from "./log-receiver.js";

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
    this.insertStatement = this.database.prepare(
      `INSERT INTO events (timestamp, plugin_id, event_type, session_id, event_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
  }

  append(event: LogEvent): void {
    const envelope = event as unknown as Record<string, unknown>;
    const eventType = typeof envelope["tag"] === "string"
      ? envelope["tag"]
      : "";
    const taggedPayload = asObject(envelope[eventType]);
    const nativeEvent = asObject(taggedPayload?.["event"]) ?? taggedPayload;
    const data = asObject(nativeEvent?.["data"]);
    const sourceTimestamp = nativeEvent?.["created"] ?? envelope["created"];
    const timestamp = typeof sourceTimestamp === "number" && Number.isFinite(sourceTimestamp)
      ? Math.trunc(sourceTimestamp)
      : Date.now();
    const pluginID = typeof envelope["pluginID"] === "string"
      ? envelope["pluginID"]
      : null;
    const sessionID = typeof envelope["sessionID"] === "string"
      ? envelope["sessionID"]
      : typeof data?.["sessionID"] === "string"
        ? data["sessionID"]
        : null;

    this.insertStatement.run(
      timestamp,
      pluginID,
      eventType,
      sessionID,
      JSON.stringify(event),
    );
  }

  readAll(): LogEvent[] {
    const rows = this.database
      .prepare("SELECT event_json FROM events ORDER BY id")
      .all();
    return rows.map((row) => JSON.parse(String(row["event_json"])) as LogEvent);
  }

  close(): void {
    this.database.close();
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
