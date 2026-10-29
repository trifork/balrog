import * as fs from "fs";
import * as path from "node:path";
import { LogReceiver } from "./log-receiver.js";

const logDirIndex = process.argv.indexOf("--log", 2);
if (logDirIndex !== -1 && !process.argv[logDirIndex + 1]) {
  throw new Error("--log requires a path");
}

const logDir = path.resolve(
  logDirIndex === -1 ? process.cwd() : process.argv[logDirIndex + 1],
);
fs.mkdirSync(logDir, { recursive: true });

const receiver = new LogReceiver();
receiver.subscribe((event) => {
  const pluginID = event["pluginID"];
  const sessionID = event["sessionID"];
  const identifiers = [pluginID, sessionID].filter((id) => !!id);
  const basename = `balrog-${identifiers.join("-")}.jsonl`;
  const filename = path.join(logDir, basename);
  if (!fs.existsSync(filename)) {
    console.log(`Created session log ${basename}`);
  }
  const line = JSON.stringify(event);
  fs.appendFileSync(filename, `${line}\n`);
  console.log(
    `Wrote ${(line.length / 1024).toFixed(1)}K ${event["tag"]} event to ${basename}`,
  );
});

receiver.listen(5001, "localhost", () => {
  console.log("Balrog receiver listening on http://localhost:5001");
});
