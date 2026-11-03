import { useEffect, useRef, useState } from "react";
import { permissionKey, type PendingPermission } from "../../shared/permission-protocol";

export function ReadWarning({ requests, live }: { requests: PendingPermission[]; live: boolean }) {
  const seen = useRef(new Set<string>());
  const sequence = useRef(0);
  const [burst, setBurst] = useState(0);
  const pending = requests.filter((request) => request.status === "pending");

  useEffect(() => {
    if (!live) {
      setBurst(0);
      return;
    }
    const fresh = requests.some((request) => request.status === "pending" && !seen.current.has(permissionKey(request)));
    seen.current = new Set(requests.map(permissionKey));
    if (!requests.some((request) => request.status === "pending")) setBurst(0);
    else if (fresh) setBurst(++sequence.current);
  }, [requests, live]);

  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(0), 1_800);
    return () => clearTimeout(timer);
  }, [burst]);

  if (!burst || !live || !pending.length) return null;

  return (
    <div key={burst} className="contents">
      <div className="read-warning-frame" aria-hidden="true" />
      <span className="sr-only" role="alert">Sensitive file read requires approval. {pending.length} {pending.length === 1 ? "request is" : "requests are"} waiting in Read approvals.</span>
    </div>
  );
}
