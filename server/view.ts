import * as path from "node:path";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { SessionAnalyzer } from "./analyzer.js";
import { SQLiteEventStore } from "./event-store.js";
import { LogReceiver } from "./log-receiver.js";
import { LogViewer } from "./viewer.js";
import { PermissionBroker } from "./permissions.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "5001" },
    db: { type: "string", default: "balrog-events.db" },
  },
  allowPositionals: false,
  strict: true,
});

const port = Number(values.port);
const permissions = new PermissionBroker();
const server = createServer();
const receiver = new LogReceiver(permissions, server);
const analyzer = new SessionAnalyzer();
const viewer = new LogViewer(analyzer, permissions, server);
const store = values.db
  ? new SQLiteEventStore(path.resolve(values.db))
  : undefined;

if (store) {
  for (const event of store.readAll()) {
    analyzer.process(event);
    viewer.publish(event);
  }
  console.log(`Loaded recorded events from ${path.resolve(values.db!)}`);
  process.on("exit", () => store.close());
}

receiver.subscribe((event) => {
  store?.append(event);
  analyzer.process(event);
  viewer.publish(event);
});

server.listen(port, "localhost", () => {
  console.log(
    `Balrog event receiver listening on http://localhost:${port}/log`,
  );
  console.log(`Balrog live viewer available at http://localhost:${port}`);
});
