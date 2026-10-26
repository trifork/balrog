import { createServer } from "node:http";
import * as fs from "fs";
import * as path from "node:path";

const logDirIndex = process.argv.indexOf("--log-dir", 2);
if (logDirIndex !== -1 && !process.argv[logDirIndex + 1]) {
  throw new Error("--log-dir requires a path");
}

const logDir = path.resolve(
  logDirIndex === -1 ? process.cwd() : process.argv[logDirIndex + 1],
);
fs.mkdirSync(logDir, { recursive: true });

const server = createServer(async (request, response) => {
  const reply = (status: number, body: object) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify(body));
  };

  if (request.url !== "/log") {
    reply(404, { error: "Not found" });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    reply(405, { error: "Method not allowed" });
    return;
  }

  try {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const event: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      reply(400, { error: "Expected a JSON object" });
      return;
    }

    const fields = event as Record<string, unknown>;
    const pluginID = fields["pluginID"];
    const sessionID = fields["sessionID"];
    const identifiers = [pluginID, sessionID].filter((id) => !!id);
    const filename = path.join(
      logDir,
      `balrog-log-${identifiers.join("-")}.jsonl`,
    );
    if (!fs.existsSync(filename)) {
      console.log(`Created session log ${filename}`);
    }
    const line = JSON.stringify(event);
    fs.appendFileSync(filename, line);
    console.log(
      `Wrote ${(line.length / 1024).toPrecision(1)}K ${fields["tag"]} event to ${filename}`,
    );
    reply(200, { ok: true });
  } catch {
    reply(400, { error: "Invalid JSON or incomplete request" });
  }
});

server.listen(5001, "localhost", () => {
  console.log("Balrog receiver listening on http://localhost:5001");
});
