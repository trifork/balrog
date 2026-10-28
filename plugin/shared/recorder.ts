import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

interface RecorderOptions {
  url?: string;
  fallbackPath?: string;
}

export class Recorder {
  readonly pluginID = randomUUID().substring(0, 8);
  private readonly url: string;
  private readonly fallbackPath: string;

  constructor(
    private readonly apiVersion: "v1" | "v2",
    options: RecorderOptions = {},
  ) {
    this.url = options.url ?? "http://localhost:5001/log";
    this.fallbackPath = options.fallbackPath ?? "balrog.json";
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

    if (this.url) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // A stopped or unreachable receiver must not prevent plugin startup.
      }
    }

    await appendFile(this.fallbackPath, `${body}\n`);
  }
}
