import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

interface RecorderOptions {
  logEndpoint?: string;
  logPath?: string;
}

export class Recorder {
  readonly pluginID = randomUUID().substring(0, 8);
  private readonly logEndpoint?: string;
  private readonly logPath?: string;

  constructor(
    private readonly apiVersion: "v1" | "v2",
    options?: RecorderOptions,
  ) {
    this.logEndpoint = options?.logEndpoint ?? "http://localhost:5001/log";
    this.logPath = options?.logPath;
  }

  async record(
    tag: string,
    sessionID: string | null,
    fields: object,
  ): Promise<void> {
    const body = JSON.stringify({
      [tag]: fields,
      tag,
      sessionID,
      pluginID: this.pluginID,
      apiVersion: this.apiVersion,
    });

    if (this.logEndpoint) {
      try {
        const response = await fetch(this.logEndpoint, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
      } catch {
        // A stopped or unreachable receiver must not prevent plugin startup.
      }
    }

    if (this.logPath) {
      await appendFile(this.logPath, `${body}\n`);
    }
  }
}
