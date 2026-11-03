import { permissionKey, type PendingPermission, type PermissionDecision, type PermissionIdentity } from "../../shared/permission-protocol";
import type { SessionSummary } from "../../shared/viewer-protocol";
import { Icon } from "./Icon";

interface Props {
  requests: PendingPermission[];
  sessions: SessionSummary[];
  live: boolean;
  onReply: (identity: PermissionIdentity, decision: PermissionDecision) => void;
}

export function PermissionRequests({ requests, sessions, live, onReply }: Props) {
  if (!requests.length) return null;

  return (
    <section aria-label="Read approvals" className="read-approvals mb-6 rounded-[9px] border border-accent/30 bg-accent/5 p-4" data-waiting={live && requests.some((request) => request.status === "pending")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="read-warning-icon grid size-9 shrink-0 place-items-center rounded-[9px] border border-accent/35 bg-accent/10 text-accent"><Icon name="warning" className="size-5" /></span>
          <div>
            <p className="mb-0.5 font-code text-[9px] tracking-[0.16em] text-accent/80 uppercase">Security interlock</p>
            <h2 className="text-[15px] font-semibold tracking-[-0.2px]">Read approvals</h2>
          </div>
        </div>
        <span aria-live="polite" className="rounded border border-accent/25 bg-accent/10 px-2 py-0.5 font-code text-[11px] whitespace-nowrap text-accent">{requests.length} waiting</span>
      </div>
      <p className="mb-4 text-[12px] text-muted">OpenCode is waiting. Approval applies to this read only.</p>
      {!live && <p className="mb-3 text-[12px] text-accent">Reconnect to answer these requests. No access has been granted by Balrog.</p>}
      <div className="space-y-3">
        {requests.map((request) => {
          const title = sessions.find((session) => session.sessionID === request.sessionID)?.title || request.sessionID;
          const disabled = !live || request.status === "replying";
          return (
            <article key={permissionKey(request)} aria-label={`Read approval for ${title}`} className="read-approval rounded-[7px] border border-line bg-panel p-3.5" data-waiting={live && request.status === "pending"}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold text-accent">Sensitive file read</h3>
                <span className="max-w-full truncate text-[11px] text-muted" title={request.sessionID}>{title}</span>
              </div>
              <ul className="mb-3 space-y-1 rounded border border-line bg-canvas p-3">
                {request.resources.map((resource, index) => <li key={`${index}:${resource}`} className="font-code text-[11px] wrap-anywhere"><code>{resource}</code></li>)}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] text-accent hover:border-accent/60 hover:bg-accent/20" disabled={disabled} onClick={() => onReply(request, "once")}>Accept once</button>
                <button type="button" className="px-3 py-1.5 text-[12px]" disabled={disabled} onClick={() => onReply(request, "reject")}>Reject</button>
                <span aria-live="polite" className="ml-auto text-[10px] text-muted">{request.status === "replying" ? "Sending reply…" : "Awaiting approval"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
