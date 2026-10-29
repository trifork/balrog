import * as path from "node:path";
import { parseArgs } from "node:util";
import { SessionAnalyzer } from "./analyzer.js";
import { SQLiteEventStore } from "./event-store.js";
import { LogReceiver } from "./log-receiver.js";
import { LogViewer } from "./viewer.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "5002" },
    db: { type: "string" },
  },
  allowPositionals: false,
  strict: true,
});

const webPort = Number(values.port);
const receiver = new LogReceiver();
const analyzer = new SessionAnalyzer();
const viewer = new LogViewer(analyzer);
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

receiver.listen(5001, "localhost", () => {
  console.log("Balrog event receiver listening on http://localhost:5001/log");
});
viewer.listen(webPort, "localhost", () => {
  console.log(`Balrog live viewer available at http://localhost:${webPort}`);
});
