import { Icon } from "./Icon";

export function ActivitySummary({ events, sessions, tools }: { events: number; sessions: number; tools: number }) {
  const stats = [
    { id: "total-events", label: "Total events", value: events, icon: "activity", note: "captured in this viewer" },
    { id: "total-sessions", label: "Sessions", value: sessions, icon: "layers", note: "across your workspace" },
    { id: "total-tools", label: "Tool calls", value: tools, icon: "tool", note: "actions taken by your agent" },
  ] as const;

  return (
    <section className="stats" aria-label="Activity summary">
      {stats.map((stat) => (
        <div className="stat" key={stat.id}>
          <div className="stat-label">{stat.label}<Icon name={stat.icon} /></div>
          <span className="stat-value" id={stat.id}>{stat.value.toLocaleString()}</span>
          <span className="stat-footnote">{stat.note}</span>
        </div>
      ))}
    </section>
  );
}
