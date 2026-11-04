import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary, ViewerMessage, ViewerRequest, ViewerResponse } from "../../shared/viewer-protocol";
import { permissionKey, type PendingPermission, type PermissionDecision, type PermissionIdentity } from "../../shared/permission-protocol";
import { applyActivityUpdate, type SessionActivity } from "../../shared/activity-protocol";

export interface ReceivedEvent extends ViewerMessage {
  receivedAt: number;
}

export interface ViewerState {
  events: ReceivedEvent[];
  sessions: SessionSummary[];
  heatmaps: SessionActivity[];
  status: "connecting" | "live" | "reconnecting";
  permissions: PendingPermission[];
  replyPermission: (identity: PermissionIdentity, decision: PermissionDecision) => void;
  error?: string;
}

export function useViewer(): ViewerState {
  const [state, setState] = useState<Omit<ViewerState, "replyPermission">>({ events: [], sessions: [], heatmaps: [], permissions: [], status: "connecting" });
  const socketRef = useRef<WebSocket | null>(null);
  const liveRef = useRef(false);
  const permissionsRef = useRef<PendingPermission[]>([]);

  const replyPermission = useCallback((identity: PermissionIdentity, decision: PermissionDecision) => {
    const socket = socketRef.current;
    const key = permissionKey(identity);
    const request = permissionsRef.current.find((item) => permissionKey(item) === key);
    if (!liveRef.current || !socket || socket.readyState !== WebSocket.OPEN || request?.status !== "pending") return;
    const permissions = permissionsRef.current.map((item) => permissionKey(item) === key ? { ...item, status: "replying" as const } : item);
    permissionsRef.current = permissions;
    setState((previous) => ({ ...previous, permissions, error: undefined }));
    try {
      const message: ViewerRequest = {
        type: "permission.reply", pluginID: identity.pluginID,
        sessionID: identity.sessionID, requestID: identity.requestID, decision,
      };
      socket.send(JSON.stringify(message));
    } catch {
      permissionsRef.current = permissionsRef.current.map((item) => permissionKey(item) === key ? { ...item, status: "pending" } : item);
      setState((previous) => ({ ...previous, permissions: permissionsRef.current, error: "Could not send the permission reply. Reconnect and try again." }));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1_000;

    const connect = () => {
      const url = new URL("/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url.href);
      socketRef.current = socket;
      socket.onopen = () => {
        const request: ViewerRequest = { type: "snapshot.request" };
        socket.send(JSON.stringify(request));
      };
      socket.onmessage = ({ data }) => {
        if (disposed) return;
        try {
          const response = JSON.parse(data) as ViewerResponse;
          if (response.type === "snapshot") {
            if (!Array.isArray(response.heatmaps) || response.heatmaps.some((heatmap) => heatmap.schemaVersion !== 2)) {
              liveRef.current = false;
              setState((previous) => ({
                ...previous, status: "connecting",
                error: "Unsupported activity snapshot. Restart the viewer server and refresh the page.",
              }));
              return;
            }
            delay = 1_000;
            liveRef.current = true;
            permissionsRef.current = response.permissions ?? [];
            setState({
              status: "live",
              sessions: response.sessions,
              heatmaps: response.heatmaps,
              events: response.events.map((message) => ({ ...message, receivedAt: Date.now() })),
              permissions: permissionsRef.current,
            });
          } else if (response.type === "event") {
            const message = { ...response.message, receivedAt: Date.now() };
            setState((previous) => {
              const session = message.session;
              const sessions = session
                ? [...previous.sessions.filter((item) => item.sessionID !== session.sessionID), session]
                : previous.sessions;
              const heatmaps = message.activityUpdates ? applyActivityUpdate(previous.heatmaps, message.activityUpdates) : previous.heatmaps;
              return { ...previous, events: [...previous.events, message], sessions, heatmaps };
            });
          } else if (response.type === "permissions") {
            permissionsRef.current = response.permissions;
            setState((previous) => ({ ...previous, permissions: response.permissions }));
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
        liveRef.current = false;
        setState((previous) => ({ ...previous, status: "reconnecting" }));
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };

    connect();
    return () => {
      disposed = true;
      liveRef.current = false;
      socketRef.current = null;
      clearTimeout(retry);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, []);

  return { ...state, replyPermission };
}
