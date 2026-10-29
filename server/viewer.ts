import { createServer, type Server, type ServerResponse } from "node:http";
import { SessionAnalyzer } from "./analyzer.js";
import type { LogEvent } from "./log-receiver.js";

function eventContent(event: LogEvent): string | undefined {
  const envelope = event as unknown as Record<string, unknown>;
  const tag = typeof envelope["tag"] === "string" ? envelope["tag"] : "";
  if (
    tag !== "session.tool.called" &&
    tag !== "session.tool.success" &&
    !/(prompt|message|session\.text\.(?:ended|delta)|session\.synthetic)/i.test(
      tag,
    )
  ) {
    return undefined;
  }

  let payload = envelope[tag];
  if (payload && typeof payload === "object" && "event" in payload) {
    payload = (payload as Record<string, unknown>)["event"];
  }
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as Record<string, unknown>)["data"]
      : payload;
  const dataObject =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : undefined;
  const payloadObject =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : undefined;
  const result = dataObject?.["result"];
  const resultObject = result && typeof result === "object"
    ? result as Record<string, unknown>
    : undefined;
  const input = dataObject?.["input"];
  const inputObject = input && typeof input === "object"
    ? input as Record<string, unknown>
    : undefined;
  const content = tag === "session.tool.called"
    ? dataObject?.["command"]
      ?? inputObject?.["command"]
      ?? payloadObject?.["command"]
    : dataObject?.["text"]
      ?? dataObject?.["content"]
      ?? dataObject?.["output"]
      ?? dataObject?.["parts"]
      ?? resultObject?.["content"]
      ?? result
      ?? payloadObject?.["content"];

  let rendered: string | undefined;
  if (typeof content === "string") rendered = content || undefined;
  if (Array.isArray(content)) {
    rendered = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const partText = (part as Record<string, unknown>)["text"];
        return typeof partText === "string" ? partText : "";
      })
      .filter(Boolean)
      .join("\n") || undefined;
  }
  if (rendered === undefined && content !== undefined && content !== null) {
    rendered = typeof content === "object"
      ? JSON.stringify(content, null, 2)
      : String(content);
  }
  return rendered;
}

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Balrog log events</title>
    <style>
      :root { color-scheme: dark; font: 14px/1.5 system-ui, sans-serif; }
      body { margin: 0; background: #101318; color: #e6e8eb; }
      body > header { position: sticky; top: 0; z-index: 1; display: flex; gap: 0.75rem; align-items: center; padding: 1rem 1.5rem; background: #191e26; border-bottom: 1px solid #303743; }
      h1 { display: inline; margin: 0 1rem 0 0; font-size: 1.1rem; }
      #status { color: #aab4c2; }
      button { border: 1px solid #414b59; border-radius: 4px; background: #242b35; color: #d5dae1; font: inherit; cursor: pointer; }
      button:hover { background: #303946; color: #fff; }
      #collapse-all { margin-left: auto; padding: 0.35rem 0.65rem; }
      #session-tabs { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.65rem 1rem 0; background: #191e26; border-bottom: 1px solid #303743; }
      .session-tab { flex: 0 0 auto; padding: 0.45rem 0.75rem; border: 1px solid transparent; border-radius: 6px 6px 0 0; background: transparent; color: #aab4c2; font: inherit; cursor: pointer; }
      .session-tab:hover { color: #e6e8eb; background: #242b35; }
      .session-tab[aria-selected="true"] { color: #91c8ff; background: #101318; border-color: #303743; border-bottom-color: #101318; }
      .session-tab small { margin-left: 0.4rem; color: #7e8998; }
      #events { padding: 1rem; }
      article { position: relative; margin: 0 auto 0.75rem; max-width: 1100px; border: 1px solid #303743; border-radius: 6px; overflow: hidden; }
      article header { position: static; display: flex; gap: 1rem; align-items: baseline; padding: 0.45rem 7rem 0.45rem 0.75rem; }
      article.collapsed > .content { display: none; }
      .event-collapse { flex: 0 0 auto; width: 1.25rem; margin-right: -0.5rem; padding: 0; border: 0; background: transparent; color: #aab4c2; font-size: 1rem; line-height: 1; }
      .event-collapse:hover { background: transparent; color: #fff; }
      time, .meta { color: #aab4c2; font-size: 0.85rem; }
      .command { min-width: 0; overflow: hidden; color: #d5dae1; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.35 ui-monospace, monospace; }
      strong { color: #91c8ff; }
      pre { margin: 0; padding: 0.5rem 0.75rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.35 ui-monospace, monospace; }
      .content { padding: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }
      .content.tool-content { font: 12px/1.35 ui-monospace, monospace; }
      details { border-top: 1px solid #303743; }
      summary { padding: 0.5rem 0.75rem; color: #aab4c2; cursor: pointer; font-size: 0.85rem; }
      details pre { border-top: 1px solid #303743; }
      article > details { border: 0; }
      article > details > summary { position: absolute; top: 0.45rem; right: 0.75rem; padding: 0; white-space: nowrap; }
      article > details > pre { width: 100%; box-sizing: border-box; border-top: 1px solid #303743; }
      #empty { max-width: 1100px; margin: 2rem auto; color: #aab4c2; }
      @media (max-width: 600px) { body > header { padding: 0.75rem 1rem; } #events { padding: 0.75rem; } }
    </style>
  </head>
  <body>
    <header><h1>Balrog log events</h1><span id="status">Connecting…</span><button id="collapse-all" type="button">Collapse all</button></header>
    <nav id="session-tabs" aria-label="Sessions" role="tablist">
      <button class="session-tab" type="button" role="tab" data-session-id="" aria-selected="true">All sessions</button>
    </nav>
    <main id="events"><p id="empty">Waiting for events…</p></main>
    <script>
      const list = document.querySelector('#events');
      const status = document.querySelector('#status');
      const tabs = document.querySelector('#session-tabs');
      const collapseAll = document.querySelector('#collapse-all');
      const sessions = new Map();
      const sessionFromURL = () => new URL(window.location.href).searchParams.get('session') || '';
      let selectedSession = sessionFromURL();
      const updateSessionURL = () => {
        const url = new URL(window.location.href);
        if (selectedSession) url.searchParams.set('session', selectedSession);
        else url.searchParams.delete('session');
        window.history.pushState(null, '', url);
      };
      let collapseNewEvents = false;
      const setCardCollapsed = (card, collapsed) => {
        card.classList.toggle('collapsed', collapsed);
        const control = card.querySelector('.event-collapse');
        control.textContent = collapsed ? '▸' : '▾';
        control.title = collapsed ? 'Expand event' : 'Collapse event';
        control.setAttribute('aria-label', control.title);
        control.setAttribute('aria-expanded', String(!collapsed));
      };
      const updateCollapseAll = () => {
        const cards = [...list.querySelectorAll('article.has-content')];
        collapseNewEvents = cards.length > 0 && cards.every((card) => card.classList.contains('collapsed'));
        collapseAll.textContent = collapseNewEvents ? 'Expand all' : 'Collapse all';
      };
      collapseAll.addEventListener('click', () => {
        const cards = [...list.querySelectorAll('article.has-content')];
        const shouldCollapse = cards.some((card) => !card.classList.contains('collapsed'));
        for (const card of cards) setCardCollapsed(card, shouldCollapse);
        updateCollapseAll();
      });
      const renderTabs = () => {
        const all = tabs.querySelector('[data-session-id=""]');
        tabs.replaceChildren(all);
        all.setAttribute('aria-selected', String(selectedSession === ''));
        for (const session of [...sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt)) {
          const tab = document.createElement('button');
          tab.className = 'session-tab';
          tab.type = 'button';
          tab.role = 'tab';
          tab.dataset.sessionId = session.sessionID;
          tab.setAttribute('aria-selected', String(selectedSession === session.sessionID));
          tab.title = session.sessionID;
          tab.append(document.createTextNode(session.title || session.sessionID));
          const count = document.createElement('small');
          count.textContent = String(session.eventCount);
          tab.append(count);
          tabs.append(tab);
        }
        for (const card of list.querySelectorAll('article')) {
          card.hidden = Boolean(selectedSession && card.dataset.sessionId !== selectedSession);
          const meta = card.querySelector('.meta');
          if (meta) meta.hidden = Boolean(selectedSession);
        }
      };
      const upsertSession = (session) => {
        if (!session?.sessionID) return;
        sessions.set(session.sessionID, session);
        renderTabs();
      };
      tabs.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-session-id]');
        if (!tab) return;
        if (selectedSession === tab.dataset.sessionId) return;
        selectedSession = tab.dataset.sessionId;
        updateSessionURL();
        renderTabs();
      });
      window.addEventListener('popstate', () => {
        selectedSession = sessionFromURL();
        renderTabs();
      });
      fetch('/api/sessions')
        .then((response) => response.ok ? response.json() : [])
        .then((items) => { for (const session of items) upsertSession(session); })
        .catch(() => {});
      const rawEventDetails = (event) => {
        const details = document.createElement('details');
        details.open = false;
        const summary = document.createElement('summary');
        summary.textContent = 'Raw event';
        const body = document.createElement('pre');
        body.textContent = JSON.stringify(event, null, 2);
        details.append(summary, body);
        return details;
      };
      const stream = new EventSource('/events');
      stream.onopen = () => { status.textContent = 'Live'; };
      stream.onerror = () => { status.textContent = 'Reconnecting…'; };
      stream.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        const event = message.event;
        upsertSession(message.session);
        document.querySelector('#empty')?.remove();
        const card = document.createElement('article');
        const hasContent = typeof message.content === 'string';
        card.classList.toggle('has-content', hasContent);
        card.dataset.sessionId = message.session?.sessionID || event.sessionID || '';
        const heading = document.createElement('header');
        const tag = document.createElement('strong');
        tag.textContent = String(event.tag ?? 'event');
        const time = document.createElement('time');
        time.textContent = new Date().toLocaleTimeString();
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.dataset.sessionId = message.session?.sessionID || event.sessionID || '';
        meta.textContent = message.sessionTitle || '';
        meta.hidden = Boolean(selectedSession);
        if (hasContent) {
          const collapse = document.createElement('button');
          collapse.className = 'event-collapse';
          collapse.type = 'button';
          collapse.addEventListener('click', () => {
            setCardCollapsed(card, !card.classList.contains('collapsed'));
            updateCollapseAll();
          });
          heading.append(collapse);
        }
        heading.append(tag, time, meta);
        if (typeof message.command === 'string') {
          const command = document.createElement('code');
          command.className = 'command';
          command.textContent = message.command;
          command.title = message.command;
          heading.append(command);
        }
        card.append(heading);
        if (hasContent) {
          const body = document.createElement('div');
          body.className = 'content';
          if (String(event.tag ?? '').startsWith('session.tool.')) {
            body.classList.add('tool-content');
          }
          body.textContent = message.content;
          card.append(body);
        }
        card.append(rawEventDetails(event));
        if (hasContent) setCardCollapsed(card, collapseNewEvents);
        list.prepend(card);
        card.hidden = Boolean(selectedSession && card.dataset.sessionId !== selectedSession);
        updateCollapseAll();
      };
    </script>
  </body>
</html>`;

/** Serves a live event page and an SSE stream to browser clients. */
export class LogViewer {
  private readonly events: LogEvent[] = [];
  private readonly clients = new Set<ServerResponse>();
  private readonly server: Server;

  constructor(private readonly analyzer = new SessionAnalyzer()) {
    this.server = createServer((request, response) => {
      if (
        request.method === "GET" &&
        (request.url === "/" || request.url?.startsWith("/?"))
      ) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(PAGE);
        return;
      }

      if (request.method === "GET" && request.url === "/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        response.flushHeaders();
        this.clients.add(response);
        for (const event of this.events) this.writeEvent(response, event);
        response.on("close", () => this.clients.delete(response));
        return;
      }

      if (request.method === "GET" && request.url === "/api/sessions") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(this.analyzer.getSessions()));
        return;
      }

      if (
        request.method === "GET" &&
        request.url?.startsWith("/api/sessions/")
      ) {
        let sessionID: string;
        try {
          sessionID = decodeURIComponent(
            request.url.slice("/api/sessions/".length),
          );
        } catch {
          response.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ error: "Invalid session ID" }));
          return;
        }
        const session = this.analyzer.getSession(sessionID);
        response.writeHead(session ? 200 : 404, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(session ?? { error: "Session not found" }));
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
  }

  publish(event: LogEvent): void {
    this.events.push(event);
    for (const client of this.clients) this.writeEvent(client, event);
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  address() {
    return this.server.address();
  }

  private writeEvent(client: ServerResponse, event: LogEvent): void {
    const sessionID = this.analyzer.getSessionID(event);
    const toolCall = this.analyzer.getToolCall(event);
    const message = {
      event,
      content: eventContent(event),
      command: toolCall?.command?.split(/\r?\n/, 1)[0],
      sessionTitle: sessionID
        ? this.analyzer.getSessionTitle(sessionID)
        : undefined,
      session: sessionID ? this.analyzer.getSession(sessionID) : undefined,
    };
    client.write(`data: ${JSON.stringify(message)}\n\n`);
  }
}
