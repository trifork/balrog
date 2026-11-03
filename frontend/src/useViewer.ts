import { useEffect, useState } from "react";
import type { SessionSummary, ViewerMessage, ViewerRequest, ViewerResponse } from "../../shared/viewer-protocol";

export interface ReceivedEvent extends ViewerMessage {
  receivedAt: number;
}

export interface ViewerState {
  events: ReceivedEvent[];
  sessions: SessionSummary[];
  status: "connecting" | "live" | "reconnecting";
  error?: string;
}

export function useViewer(): ViewerState {
  const [state, setState] = useState<ViewerState>({ events: [], sessions: [], status: "connecting" });

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1_000;

    const connect = () => {
      const url = new URL("/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url.href);
      socket.onopen = () => {
        const request: ViewerRequest = { type: "snapshot.request" };
        socket.send(JSON.stringify(request));
      };
      socket.onmessage = ({ data }) => {
        if (disposed) return;
        try {
          const response = JSON.parse(data) as ViewerResponse;
          if (response.type === "snapshot") {
            delay = 1_000;
            setState({
              status: "live",
              sessions: response.sessions,
              events: response.events.map((message) => ({ ...message, receivedAt: Date.now() })),
            });
          } else if (response.type === "event") {
            const message = { ...response.message, receivedAt: Date.now() };
            setState((previous) => {
              const session = message.session;
              const sessions = session
                ? [...previous.sessions.filter((item) => item.sessionID !== session.sessionID), session]
                : previous.sessions;
              return { ...previous, events: [...previous.events, message], sessions };
            });
          } else if (response.type === "error") {
            setState((previous) => ({ ...previous, error: response.message }));
          }
        } catch {
          return;
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        setState((previous) => ({ ...previous, status: "reconnecting" }));
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, []);

  return state;
}
