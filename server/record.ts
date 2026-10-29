import * as fs from "fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { LogReceiver } from "./log-receiver.js";

const { values } = parseArgs({
  options: {
    log: { type: "string" },
  },
  allowPositionals: false,
  strict: true,
});

const logDir = path.resolve(values.log ?? process.cwd());
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
