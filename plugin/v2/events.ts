import type { Plugin } from "@opencode/plugin";
import { setImmediate } from "node:timers/promises";
import type { Recorder } from "../shared/recorder.js";

type OpenCodeEvent = ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never;

interface LocationRecording {
  context: Plugin.Context;
  recorder: Recorder;
  observe(event: OpenCodeEvent): void;
}

interface EventConsumer {
  owner: LocationSink;
  controller: AbortController;
  done: Promise<void>;
}

interface LocationSink extends LocationRecording {
  pending: Promise<void>;
  failure?: { error: unknown };
}

class EventRecording {
  private readonly locations = new Set<LocationSink>();
  private consumer?: EventConsumer;

  get empty(): boolean {
    return this.locations.size === 0;
  }

  register(input: LocationRecording): () => Promise<void> {
    const location: LocationSink = { ...input, pending: Promise.resolve() };
    this.locations.add(location);
    this.consumer ??= this.start(location);
    let disposed = false;

    return async () => {
      if (disposed) return;
      disposed = true;
      this.locations.delete(location);
      if (this.consumer?.owner === location) {
        const previous = this.consumer;
        await setImmediate();
        if (this.consumer === previous) {
          previous.controller.abort();
          const next = this.locations.values().next().value;
          this.consumer = next ? this.start(next) : undefined;
        }
        await previous.done;
      }
      await location.pending;
      if (location.failure) throw location.failure.error;
    };
  }

  private start(owner: LocationSink): EventConsumer {
    const controller = new AbortController();
    const done = (async () => {
      await Promise.resolve();
      try {
        for await (const event of owner.context.event.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted) break;
          for (const location of this.locations) location.observe(event);
          const directory = event.location?.directory;
          const target = directory !== undefined
            ? [...this.locations].find((location) => location.context.location.directory === directory)
            : this.locations.has(owner) ? owner : this.locations.values().next().value;
          if (!target) continue;
          const sessionID = "sessionID" in event.data && typeof event.data.sessionID === "string"
            ? event.data.sessionID
            : null;
          target.pending = target.pending
            .then(() => target.recorder.record(event.type, sessionID, event))
            .catch((error: unknown) => { target.failure ??= { error }; });
        }
      } catch (error) {
        if (!controller.signal.aborted) owner.failure ??= { error };
      } finally {
        controller.abort();
        if (this.consumer?.controller === controller) this.consumer = undefined;
      }
    })();
    return { owner, controller, done };
  }
}

const key = Symbol.for("opencode-balrog.v2.event-recording");
const shared = globalThis as typeof globalThis & { [key]?: EventRecording };

export function registerEvents(location: LocationRecording): () => Promise<void> {
  const recording = shared[key] ??= new EventRecording();
  const unregister = recording.register(location);
  return async () => {
    try {
      await unregister();
    } finally {
      if (recording.empty && shared[key] === recording) delete shared[key];
    }
  };
}
