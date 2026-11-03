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
      :root { color-scheme: dark; font: 14px/1.6 "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif; --bg: #111214; --panel: #18191c; --border: #2a2b30; --muted: #96969f; --text: #ededf0; --accent: #ff9a66; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); }
      button, input, select { font: inherit; }
      button { cursor: pointer; }
      button, select { transition: background 150ms, border-color 150ms, color 150ms; }
      button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
      button { border: 1px solid var(--border); border-radius: 8px; background: #202125; color: #d4d4da; }
      button:hover { background: #2b2c31; border-color: #45464d; color: #fff; }
      button:disabled { opacity: 0.4; cursor: default; }
      [hidden] { display: none !important; }
      .icon { width: 18px; height: 18px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .app { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100vh; }
      .sidebar { position: sticky; top: 0; display: flex; flex-direction: column; height: 100vh; padding: 30px 18px 20px; background: #151618; border-right: 1px solid var(--border); }
      .brand { display: flex; align-items: center; gap: 11px; padding: 0 12px 32px; }
      .brand-mark { display: grid; place-items: center; width: 35px; height: 39px; color: var(--accent); background: linear-gradient(145deg, #ffae7924, #ff733309); border: 1px solid #ff9a6630; border-radius: 11px; }
      .brand-mark .icon { width: 24px; height: 24px; }
      .brand-name { font-size: 23px; font-weight: 720; letter-spacing: -1px; line-height: 1.2; }
      .brand-subtitle { margin-top: 3px; color: var(--muted); font-size: 10px; letter-spacing: 1.8px; text-transform: uppercase; }
      .workspace { display: flex; align-items: center; gap: 10px; margin: 0 4px 30px; padding: 11px; border: 1px solid var(--border); border-radius: 9px; font-size: 12px; color: #c5c5ce; }
      .workspace .icon { color: var(--muted); }
      .workspace span:last-child { margin-left: auto; font-size: 10px; color: var(--muted); }
      .sidebar-label { display: flex; justify-content: space-between; padding: 0 12px; margin-bottom: 12px; color: #80818b; font-size: 10px; font-weight: 650; letter-spacing: 1.5px; text-transform: uppercase; }
      #session-tabs { display: flex; flex: 1; flex-direction: column; gap: 5px; overflow-y: auto; min-height: 0; }
      .session-tab { position: relative; display: flex; align-items: center; gap: 9px; flex: 0 0 auto; width: 100%; padding: 11px 12px; text-align: left; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--muted); font-size: 12px; }
      .session-tab::before { content: ''; width: 6px; height: 6px; flex: 0 0 auto; border: 1px solid #64656e; border-radius: 50%; }
      .session-tab:hover { background: #202124; color: #ededf0; }
      .session-tab[aria-selected="true"] { color: #ffb58c; background: #ff9a6610; border-color: #ff9a6624; }
      .session-tab[aria-selected="true"]::before { border-color: var(--accent); background: var(--accent); box-shadow: 0 0 9px #ff9a6633; }
      .session-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .session-tab small { margin-left: auto; padding: 0 6px; border-radius: 4px; background: #ffffff07; color: #a1a1ab; font: 10px/20px ui-monospace, monospace; }
      .sidebar-footer { padding: 20px 10px 0; margin-top: 20px; border-top: 1px solid var(--border); color: #81828c; font-size: 11px; }
      .connection { display: flex; align-items: center; gap: 8px; color: #c6c6ce; }
      .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #d5ac6d; box-shadow: 0 0 0 4px #d5ac6d0b; }
      body[data-connection="live"] .status-dot { background: #86cfa1; box-shadow: 0 0 0 4px #86cfa10b; }
      .sidebar-footer p { margin: 8px 0 0 14px; font: 10px/1.5 ui-monospace, monospace; }
      .main { min-width: 0; }
      .topbar { display: flex; justify-content: space-between; align-items: center; min-height: 73px; padding: 0 42px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 12px; }
      .breadcrumb { display: flex; align-items: center; gap: 12px; }
      .breadcrumb span:last-child { color: #d4d4dc; }
      .topbar-note { display: flex; align-items: center; gap: 7px; font-size: 11px; }
      .topbar-note .icon { width: 14px; height: 14px; }
      .dashboard { max-width: 1480px; margin: 0 auto; padding: 35px 42px 45px; }
      .eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--accent); font-size: 10px; font-weight: 650; letter-spacing: 1.8px; text-transform: uppercase; }
      .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
      h1 { margin: 0; font-size: clamp(26px, 3vw, 34px); font-weight: 620; line-height: 1.25; letter-spacing: -1.2px; }
      .description { margin: 10px 0 0; color: var(--muted); font-size: 13px; }
      .live-badge { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; padding: 6px 11px; border: 1px solid #86cfa124; border-radius: 20px; background: #86cfa108; color: #a6d9b8; font-size: 11px; }
      body:not([data-connection="live"]) .live-badge { color: #d5ac6d; border-color: #d5ac6d24; background: #d5ac6d08; }
      .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 34px; }
      .stat { position: relative; padding: 18px 20px; border: 1px solid var(--border); border-radius: 10px; background: linear-gradient(115deg, #1c1d20, #18191c); }
      .stat-label { display: flex; align-items: center; justify-content: space-between; color: #a8a8b2; font-size: 11px; }
      .stat-label .icon { width: 16px; height: 16px; color: #7a7b86; }
      .stat-value { display: inline-block; margin-top: 8px; font-size: 29px; font-weight: 550; line-height: 1.3; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
      .stat-footnote { margin-left: 9px; color: #7e7f89; font-size: 10px; }
      .stat:first-child .stat-value { color: #ffb58c; }
      .feed-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
      h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.2px; }
      .feed-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
      #feed-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #visible-count { color: #9999a4; background: #242529; border: 1px solid #303137; padding: 0 7px; border-radius: 5px; font: 10px/20px ui-monospace, monospace; }
      .feed-note { color: #7e7f89; font-size: 10px; }
      .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
      .search { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; padding: 0 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: #7e7f89; }
      .search:focus-within { border-color: #ff9a6680; }
      .search .icon { width: 15px; height: 15px; }
      .search input { width: 100%; min-width: 0; height: 38px; border: 0; background: transparent; color: var(--text); font-size: 12px; outline: none; }
      .search input::placeholder { color: #777884; }
      #event-filter { height: 40px; max-width: 155px; padding: 0 30px 0 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: #c4c4ce; font-size: 11px; }
      #collapse-all { height: 40px; padding: 0 13px; background: var(--panel); font-size: 11px; white-space: nowrap; }
      #events { position: relative; }
      article { position: relative; margin: 0 0 12px; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; background: #18191c; --event-color: #a8acba; }
      article:hover { border-color: #414249; }
      article[data-kind="prompt"] { --event-color: #b7a0e9; }
      article[data-kind="tool"] { --event-color: #e6b479; }
      article[data-kind="success"] { --event-color: #8acba4; }
      article[data-kind="error"] { --event-color: #ed8e8e; }
      article header { position: relative; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; min-height: 52px; padding: 13px 112px 13px 17px; }
      article header::before { content: ''; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--event-color); box-shadow: 0 0 0 4px color-mix(in srgb, var(--event-color) 7%, transparent); }
      article.collapsed > .content { display: none; }
      .event-collapse { flex: 0 0 auto; width: 16px; padding: 0; border: 0; background: transparent; color: #8d8e98; font-size: 12px; line-height: 1; }
      .event-collapse:hover { background: transparent; color: #fff; }
      time { margin-left: auto; color: #858690; font: 10px/1.5 ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      .meta { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #92939e; font-size: 10px; }
      .command { flex-basis: 100%; min-width: 0; overflow: hidden; padding-left: 16px; color: #a5a6b0; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.5 ui-monospace, monospace; }
      strong { color: var(--event-color); font: 11px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace; font-weight: 500; overflow-wrap: anywhere; }
      pre { margin: 0; padding: 18px 20px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.7 ui-monospace, "Cascadia Code", Consolas, monospace; color: #a6a7b3; background: #131416; }
      .content { margin: 0 16px 16px; padding: 15px 17px; border: 1px solid #ffffff06; border-radius: 6px; background: #121315; color: #c7c7d0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.8; max-height: 420px; overflow: auto; }
      .content.tool-content { color: #b6b9c3; font: 11px/1.8 ui-monospace, "Cascadia Code", Consolas, monospace; }
      details { border-top: 1px solid var(--border); }
      summary { padding: 10px 17px; color: #9697a1; cursor: pointer; font-size: 10px; }
      summary:hover { color: var(--accent); }
      details pre { border-top: 1px solid var(--border); }
      article > details { border: 0; }
      article > details > summary { position: absolute; top: 18px; right: 17px; padding: 0; white-space: nowrap; }
      article > details > pre { width: 100%; border-top: 1px solid var(--border); }
      #empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 290px; padding: 40px 20px; text-align: center; border: 1px dashed #35363c; border-radius: 10px; background: radial-gradient(ellipse at 50% 10%, #ff9a6605, transparent 70%); }
      .empty-icon { display: grid; place-items: center; width: 50px; height: 50px; margin-bottom: 18px; border: 1px solid #ff9a6626; border-radius: 14px; background: #ff9a6609; color: var(--accent); }
      .empty-icon .icon { width: 24px; height: 24px; }
      #empty h3 { margin: 0 0 6px; font-size: 15px; font-weight: 550; }
      #empty p { max-width: 340px; margin: 0; color: var(--muted); font-size: 12px; }
      #empty code { margin-top: 20px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 5px; color: #a8a8b3; background: #1b1c20; font-size: 11px; }
      .feed-footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); color: #747580; font-size: 10px; }
      .feed-footer span:first-child { display: flex; align-items: center; gap: 7px; }
      ::selection { background: #ff9a6633; color: #fff; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: #393a42; border-radius: 6px; }
      @media (min-width: 1500px) { .dashboard { padding-top: 45px; } }
      @media (max-width: 1100px) { .app { grid-template-columns: 216px minmax(0, 1fr); } .dashboard { padding: 28px 25px; } .topbar { padding: 0 25px; } .stat { padding: 15px; } .stat-footnote { display: block; margin: 2px 0 0; } .meta { max-width: 100px; } }
      @media (max-width: 760px) { .app { display: block; } .sidebar { position: static; height: auto; padding: 16px; border-right: 0; border-bottom: 1px solid var(--border); } .brand { padding: 0 0 16px; } .brand-name { font-size: 21px; } .brand-subtitle { font-size: 9px; } .brand-mark { width: 31px; height: 35px; } .workspace, .sidebar-label, .sidebar-footer { display: none; } #session-tabs { flex-direction: row; overflow-x: auto; padding-bottom: 3px; } .session-tab { width: auto; max-width: 230px; padding: 8px 11px; } .topbar { min-height: 49px; padding: 0 20px; } .dashboard { padding: 25px 20px; } .stats { gap: 9px; margin-bottom: 28px; } .stat { padding: 12px; } .stat-value { font-size: 24px; } .stat-label { font-size: 10px; } .stat-label .icon { display: none; } .page-heading { align-items: flex-start; } .live-badge { margin-top: 5px; padding: 4px 8px; font-size: 10px; } article header { gap: 9px; padding-left: 13px; } .meta { display: none; } }
      @media (max-width: 480px) { .topbar-note, .feed-note { display: none; } .dashboard { padding: 23px 14px; } .toolbar { flex-wrap: wrap; gap: 8px; } .search { flex-basis: 100%; } #event-filter { flex: 1; max-width: none; } .stat-footnote { font-size: 9px; } .stat-label { line-height: 1.4; } .description { max-width: 230px; font-size: 12px; } .feed-footer { flex-direction: column; } article header { padding-right: 95px; } article > details > summary { right: 12px; } time { margin-left: 16px; } .content { margin: 0 10px 10px; padding: 12px; } }
    </style>
  </head>
  <body>
    <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
      <symbol id="i-flame" viewBox="0 0 24 24"><path d="M13 3c1 5-4 5-2 9 1-1 2-2 2-4 4 3 6 6 5 9a7 7 0 0 1-13-3c0-4 5-7 8-11Z"/><path d="M12 14c-3 3-3 5 0 7 3-2 3-4 0-7Z"/></symbol>
      <symbol id="i-activity" viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></symbol>
      <symbol id="i-tool" viewBox="0 0 24 24"><path d="m14 6 4 4 3-3a6 6 0 0 1-8 7l-6 6a2 2 0 0 1-3-3l6-6a6 6 0 0 1 7-8l-3 3Z"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></symbol>
      <symbol id="i-terminal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></symbol>
    </svg>
    <div class="app">
      <aside class="sidebar" aria-label="Workspace">
        <div class="brand"><div class="brand-mark"><svg class="icon" aria-hidden="true"><use href="#i-flame"/></svg></div><div><div class="brand-name">balrog<span style="color:var(--accent)">.</span></div><div class="brand-subtitle">See what happens.</div></div></div>
        <div class="workspace"><svg class="icon" aria-hidden="true"><use href="#i-terminal"/></svg><span>Local workspace</span><span>LOCAL</span></div>
        <div class="sidebar-label"><span>Sessions</span><span id="sidebar-session-count">0</span></div>
        <nav id="session-tabs" aria-label="Sessions" role="tablist">
          <button class="session-tab" type="button" role="tab" data-session-id="" aria-selected="true"><span class="session-title">All sessions</span><small id="all-event-count">0</small></button>
        </nav>
        <div class="sidebar-footer"><div class="connection"><span class="status-dot"></span><span id="status" role="status">Connecting…</span></div><p>OpenCode event stream</p></div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="breadcrumb"><svg class="icon" aria-hidden="true"><use href="#i-layers"/></svg><span>Workspace</span><span>/</span><span>Overview</span></div><div class="topbar-note"><svg class="icon" aria-hidden="true"><use href="#i-shield"/></svg>Local-first. Just your machine.</div></header>
        <main class="dashboard">
          <div class="page-heading"><div><p class="eyebrow">Your agent, under the hood</p><h1>Activity overview</h1><p class="description">Every prompt, tool call, and moment in between.</p></div><div class="live-badge" role="status"><span class="status-dot"></span><span id="live-label">Connecting</span></div></div>
          <section class="stats" aria-label="Activity summary">
            <div class="stat"><div class="stat-label">Total events<svg class="icon" aria-hidden="true"><use href="#i-activity"/></svg></div><span class="stat-value" id="total-events">0</span><span class="stat-footnote">captured in this viewer</span></div>
            <div class="stat"><div class="stat-label">Sessions<svg class="icon" aria-hidden="true"><use href="#i-layers"/></svg></div><span class="stat-value" id="total-sessions">0</span><span class="stat-footnote">across your workspace</span></div>
            <div class="stat"><div class="stat-label">Tool calls<svg class="icon" aria-hidden="true"><use href="#i-tool"/></svg></div><span class="stat-value" id="total-tools">0</span><span class="stat-footnote">actions taken by your agent</span></div>
          </section>
          <section aria-label="Event activity">
            <div class="feed-heading"><div class="feed-title"><h2 id="feed-title">Event stream</h2><span id="visible-count">0</span></div><span class="feed-note">Newest events first</span></div>
            <div class="toolbar"><label class="search"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><input id="event-search" type="search" placeholder="Search events, commands, or content…" aria-label="Search events" autocomplete="off"></label><select id="event-filter" aria-label="Filter event type"><option value="all">All event types</option><option value="prompt">Prompts & messages</option><option value="tool">Tool activity</option><option value="error">Errors</option><option value="other">Session & system</option></select><button id="collapse-all" type="button">Collapse all</button></div>
            <div id="events"><div id="empty"><div class="empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-activity"/></svg></div><h3 id="empty-title">Ready when you are</h3><p id="empty-description">Waiting for events… Start an OpenCode session and watch your agent's activity unfold here.</p><code id="empty-hint">$ opencode</code></div></div>
            <footer class="feed-footer"><span><span class="status-dot"></span>Events appear automatically. No refresh needed.</span><span>Built for a little more observability.</span></footer>
          </section>
        </main>
      </div>
    </div>
    <script>
      const list = document.querySelector('#events');
      const status = document.querySelector('#status');
      const tabs = document.querySelector('#session-tabs');
      const collapseAll = document.querySelector('#collapse-all');
      const search = document.querySelector('#event-search');
      const eventFilter = document.querySelector('#event-filter');
      const empty = document.querySelector('#empty');
      const number = new Intl.NumberFormat();
      let totalEvents = 0;
      let totalTools = 0;
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
        const cards = [...list.querySelectorAll('article.has-content')].filter((card) => !card.hidden);
        collapseNewEvents = cards.length > 0 && cards.every((card) => card.classList.contains('collapsed'));
        collapseAll.textContent = collapseNewEvents ? 'Expand all' : 'Collapse all';
        collapseAll.disabled = cards.length === 0;
      };
      collapseAll.addEventListener('click', () => {
        const cards = [...list.querySelectorAll('article.has-content')].filter((card) => !card.hidden);
        const shouldCollapse = cards.some((card) => !card.classList.contains('collapsed'));
        for (const card of cards) setCardCollapsed(card, shouldCollapse);
        updateCollapseAll();
      });
      const matchesFilters = (card) => {
        const kind = eventFilter.value;
        return (!selectedSession || card.dataset.sessionId === selectedSession)
          && (!search.value.trim() || card.searchText.includes(search.value.trim().toLowerCase()))
          && (kind === 'all' || (kind === 'tool' ? card.dataset.isTool === 'true'
            : kind === 'other' ? card.dataset.isTool !== 'true' && ['other', 'success'].includes(card.dataset.kind)
            : card.dataset.kind === kind));
      };
      const updateView = () => {
        let visible = 0;
        for (const card of list.querySelectorAll('article')) {
          card.hidden = !matchesFilters(card);
          if (!card.hidden) visible += 1;
          const meta = card.querySelector('.meta');
          if (meta) meta.hidden = Boolean(selectedSession);
        }
        document.querySelector('#visible-count').textContent = number.format(visible);
        document.querySelector('#feed-title').textContent = selectedSession
          ? sessions.get(selectedSession)?.title || 'Session activity'
          : 'Event stream';
        empty.hidden = visible > 0;
        const filtered = totalEvents > 0 || selectedSession || search.value.trim() || eventFilter.value !== 'all';
        document.querySelector('#empty-title').textContent = filtered ? 'No matching events' : 'Ready when you are';
        document.querySelector('#empty-description').textContent = filtered
          ? 'Try another search or event type, or choose a different session.'
          : "Waiting for events… Start an OpenCode session and watch your agent's activity unfold here.";
        document.querySelector('#empty-hint').hidden = Boolean(filtered);
        updateCollapseAll();
      };
      search.addEventListener('input', updateView);
      eventFilter.addEventListener('change', updateView);
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { search.value = ''; updateView(); }
      });
      const renderTabs = () => {
        const focusedSession = tabs.contains(document.activeElement) ? document.activeElement.dataset.sessionId : undefined;
        const all = tabs.querySelector('[data-session-id=""]');
        tabs.replaceChildren(all);
        all.setAttribute('aria-selected', String(selectedSession === ''));
        all.tabIndex = selectedSession === '' ? 0 : -1;
        for (const session of [...sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt)) {
          const tab = document.createElement('button');
          tab.className = 'session-tab';
          tab.type = 'button';
          tab.role = 'tab';
          tab.dataset.sessionId = session.sessionID;
          tab.setAttribute('aria-selected', String(selectedSession === session.sessionID));
          tab.tabIndex = selectedSession === session.sessionID ? 0 : -1;
          tab.title = session.sessionID;
          const title = document.createElement('span');
          title.className = 'session-title';
          title.textContent = session.title || session.sessionID;
          tab.append(title);
          const count = document.createElement('small');
          count.textContent = number.format(session.eventCount);
          tab.append(count);
          tabs.append(tab);
        }
        if (!tabs.querySelector('[tabindex="0"]')) all.tabIndex = 0;
        if (focusedSession !== undefined) {
          [...tabs.querySelectorAll('[role="tab"]')].find((tab) => tab.dataset.sessionId === focusedSession)?.focus({ preventScroll: true });
        }
        document.querySelector('#total-sessions').textContent = number.format(sessions.size);
        document.querySelector('#sidebar-session-count').textContent = number.format(sessions.size);
        updateView();
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
      tabs.addEventListener('keydown', (event) => {
        const controls = [...tabs.querySelectorAll('[role="tab"]')];
        const index = controls.indexOf(document.activeElement);
        if (index < 0) return;
        let next = index;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % controls.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + controls.length - 1) % controls.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = controls.length - 1;
        else return;
        event.preventDefault();
        const id = controls[next].dataset.sessionId;
        controls[next].click();
        [...tabs.querySelectorAll('[role="tab"]')].find((tab) => tab.dataset.sessionId === id)?.focus();
      });
      const mobileLayout = window.matchMedia('(max-width: 760px)');
      const updateTabOrientation = () => tabs.setAttribute('aria-orientation', mobileLayout.matches ? 'horizontal' : 'vertical');
      mobileLayout.addEventListener('change', updateTabOrientation);
      updateTabOrientation();
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
      const setConnection = (live) => {
        document.body.dataset.connection = live ? 'live' : 'reconnecting';
        status.textContent = live ? 'Connected to OpenCode stream' : 'Reconnecting…';
        document.querySelector('#live-label').textContent = live ? 'Live stream' : 'Reconnecting';
      };
      stream.onopen = () => setConnection(true);
      stream.onerror = () => setConnection(false);
      updateView();
      stream.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        const event = message.event;
        upsertSession(message.session);
        const card = document.createElement('article');
        const hasContent = typeof message.content === 'string';
        card.classList.toggle('has-content', hasContent);
        card.dataset.sessionId = message.session?.sessionID || event.sessionID || '';
        const eventTag = String(event.tag ?? 'event');
        const isTool = /tool/i.test(eventTag);
        card.dataset.isTool = String(isTool);
        card.dataset.kind = /error|fail/i.test(eventTag) ? 'error'
          : /prompt|message|session\\.text|session\\.synthetic/i.test(eventTag) ? 'prompt'
          : /success|completed/i.test(eventTag) ? 'success'
          : isTool ? 'tool' : 'other';
        card.searchText = JSON.stringify(event).toLowerCase();
        totalEvents += 1;
        if (eventTag === 'session.tool.called' || eventTag === 'tool.execute.before') totalTools += 1;
        document.querySelector('#total-events').textContent = number.format(totalEvents);
        document.querySelector('#all-event-count').textContent = number.format(totalEvents);
        document.querySelector('#total-tools').textContent = number.format(totalTools);
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
        updateView();
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

      if (request.method === "GET" && request.url?.split("?", 1)[0] === "/api/tool-executions") {
        const url = new URL(request.url, "http://localhost");
        const requestedSession = url.searchParams.get("session");
        const sessionID = requestedSession || this.analyzer.getSessions()[0]?.sessionID || null;
        const missing = sessionID !== null && !this.analyzer.getSession(sessionID);
        response.writeHead(missing ? 404 : 200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(missing ? { error: "Session not found" } : {
          sessionID,
          executions: sessionID ? this.analyzer.getToolExecutions(sessionID) : [],
        }));
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
