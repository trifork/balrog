import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import { test, type TestContext } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { isSensitiveFile } from "../plugin/v2/sensitive-files.js";
import { LogReceiver, type LogEvent } from "../server/log-receiver.js";
import { PermissionBroker } from "../server/permissions.js";
import { LogViewer } from "../server/viewer.js";
import type { PermissionCommand } from "../shared/permission-protocol.js";
import type { Plugin } from "@opencode/plugin";
import { SensitiveReadPermissions, SENSITIVE_READ_MESSAGE } from "../plugin/v2/permissions.js";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class Inbox {
  private readonly messages: unknown[] = [];
  private notify?: () => void;

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()));
      this.notify?.();
    });
  }

  async next<T = any>(predicate: (message: any) => boolean = () => true): Promise<T> {
    for (;;) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0] as T;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for a WebSocket message")), 3_000);
        this.notify = () => { clearTimeout(timer); this.notify = undefined; resolve(); };
      });
    }
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
}

async function bridgeServer(t: TestContext) {
  const broker = new PermissionBroker();
  const receiver = new LogReceiver(broker);
  const viewer = new LogViewer(undefined, broker);
  await Promise.all([
    new Promise<void>((resolve) => receiver.listen(0, "localhost", resolve)),
    new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve)),
  ]);
  t.after(async () => { await viewer.close(); await receiver.close(); });
  const address = receiver.address();
  const webAddress = viewer.address();
  assert.ok(address && typeof address !== "string");
  assert.ok(webAddress && typeof webAddress !== "string");
  const origin = `http://localhost:${webAddress.port}`;
  const pluginURL = `ws://localhost:${address.port}/permissions`;
  const browser = new Inbox(new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin }));
  await once(browser.socket, "open");
  browser.send({ type: "snapshot.request" });
  await browser.next((message) => message.type === "snapshot");
  const connectPlugin = async (pluginID = "plugin-1") => {
    const plugin = new Inbox(new WebSocket(pluginURL));
    await once(plugin.socket, "open");
    plugin.send({ type: "permissions.sync", pluginID, requests: [nativeRequest] });
    await browser.next((message) => message.type === "permissions" && message.permissions.some((item: any) => item.pluginID === pluginID));
    return plugin;
  };
  return { broker, receiver, viewer, browser, connectPlugin, pluginURL, origin, logEndpoint: `http://localhost:${address.port}/log` };
}

const nativeRequest = { sessionID: "session-1", requestID: "request-1", resources: ["/project/.env"] };
const reply = { type: "permission.reply", pluginID: "plugin-1", sessionID: "session-1", requestID: "request-1", decision: "once" } as const;

test("sensitive file policy matches configuration and credentials on Windows and POSIX", () => {
  for (const path of [
    ".env", "/project/.env.production", "C:\\project\\.env.local",
    "appsettings.json", "/src/appsettings.Development.json", "C:\\src\\AppSettings.Production.JSON",
    "/home/me/.npmrc", "/home/me/.pypirc", "/home/me/.netrc",
    "/home/me/.ssh/id_rsa", "/home/me/.ssh/id_ed25519", "/tls/server.pem", "/tls/server.key",
    "/home/me/.aws/credentials", "C:\\Users\\me\\.aws\\credentials", "/home/me/.kube/config",
  ]) assert.equal(isSensitiveFile(path), true, path);
});

test("sensitive file policy avoids unrelated files and partial directory matches", () => {
  for (const path of [
    "README.md", "environment.ts", ".envrc", "appsettings.ts", "myappsettings.json",
    "/home/me/not.aws/credentials", "/home/me/.aws/credentials.backup", "/tls/server.key.pub",
    "/home/me/.ssh/id_rsa.pub", "/src/appsettings.json/schema.ts",
  ]) assert.equal(isSensitiveFile(path), false, path);
});

for (const decision of ["once", "reject"] as const) {
  test(`browser ${decision} resolves the exact live native request after plugin confirmation`, { timeout: 5_000 }, async (t) => {
    const { browser, connectPlugin, broker } = await bridgeServer(t);
    const plugin = await connectPlugin();
    browser.send({ ...reply, decision });
    const command = await plugin.next<PermissionCommand>();
    assert.deepEqual(command, { ...reply, decision, commandID: command.commandID });
    assert.equal(broker.list()[0].status, "replying");
    plugin.send({ type: "permission.result", commandID: command.commandID });
    await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
    assert.deepEqual(broker.list(), []);
    browser.send(reply);
    assert.match((await browser.next((message) => message.type === "error")).message, /no longer available/);
  });
}

test("duplicate replies are rejected and failed replies remain retryable", { timeout: 5_000 }, async (t) => {
  const { browser, connectPlugin, broker } = await bridgeServer(t);
  const plugin = await connectPlugin();
  browser.send(reply);
  const command = await plugin.next<PermissionCommand>();
  browser.send(reply);
  assert.match((await browser.next((message) => message.type === "error")).message, /already in progress/);
  plugin.send({ type: "permission.result", commandID: command.commandID, error: "Native reply failed" });
  assert.equal((await browser.next((message) => message.type === "error")).message, "Native reply failed");
  assert.equal(broker.list()[0].status, "pending");
  browser.send({ ...reply, decision: "always" });
  assert.equal((await browser.next((message) => message.type === "error")).type, "error");
});

test("native replies, browser snapshots, and plugin disconnects synchronize without granting access", { timeout: 5_000 }, async (t) => {
  const { browser, connectPlugin, broker } = await bridgeServer(t);
  const plugin = await connectPlugin();
  browser.send({ type: "snapshot.request" });
  assert.equal((await browser.next((message) => message.type === "snapshot")).permissions.length, 1);
  plugin.send({ type: "permissions.sync", pluginID: "plugin-1", requests: [] });
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  plugin.send({ type: "permissions.sync", pluginID: "plugin-1", requests: [nativeRequest] });
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  plugin.socket.close();
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  assert.deepEqual(broker.list(), []);
  await connectPlugin();
  assert.equal(broker.list().length, 1);
});

test("plugin ownership prevents cross-plugin replies and rejects identity changes", { timeout: 5_000 }, async (t) => {
  const { browser, connectPlugin, broker } = await bridgeServer(t);
  const first = await connectPlugin();
  const other = await connectPlugin("plugin-2");
  browser.send(reply);
  const command = await first.next<PermissionCommand>();
  const closed = once(other.socket, "close");
  other.send({ type: "permission.result", commandID: command.commandID });
  await closed;
  assert.equal(broker.list()[0].status, "replying");
  first.send({ type: "permission.result", commandID: command.commandID });
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  const identityClosed = once(first.socket, "close");
  first.send({ type: "permissions.sync", pluginID: "changed", requests: [] });
  await identityClosed;
});

test("browser origins cannot connect to the plugin bridge and recorded asks never become actionable", { timeout: 5_000 }, async (t) => {
  const { pluginURL, viewer, browser, broker } = await bridgeServer(t);
  const socket = new WebSocket(pluginURL, { origin: "http://localhost" });
  const [error] = await once(socket, "error");
  assert.match(String(error), /403/);
  viewer.publish({
    tag: "permission.asked", pluginID: "old-plugin", sessionID: "session-1", apiVersion: "v2",
    "permission.asked": { type: "permission.asked", data: { ...nativeRequest, id: "old-request", action: "read" } },
  } as unknown as LogEvent);
  browser.send({ type: "snapshot.request" });
  const snapshot = await browser.next((message) => message.type === "snapshot");
  assert.equal(snapshot.events.length, 1);
  assert.deepEqual(snapshot.permissions, []);
  assert.deepEqual(broker.list(), []);
});

type Evaluation = Parameters<Parameters<Plugin.Context["permission"]["hook"]>[1]>[0];

async function nativePlugin(t: TestContext, logEndpoint: string, initialRequests: Record<string, unknown>[] = []) {
  let evaluate!: (event: Evaluation) => Promise<void> | void;
  let disposed = false;
  const native = new Map(initialRequests.map((request) => [String(request.id), request]));
  const replies: unknown[] = [];
  const context = {
    location: { directory: "/project" },
    session: {
      async get({ sessionID }: { sessionID: string }) { return { id: sessionID, location: { directory: "/project" } }; },
      async list() {
        return { data: [...new Set([...native.values()].map((request) => request.sessionID))].map((id) => ({ id, location: { directory: "/project" } })), cursor: {} };
      },
    },
    permission: {
      async hook(name: string, callback: typeof evaluate) {
        assert.equal(name, "evaluate");
        evaluate = callback;
        return { async dispose() { disposed = true; } };
      },
      async list() { return [...native.values()]; },
      async get({ requestID }: { requestID: string }) {
        const request = native.get(requestID);
        if (!request) throw new Error("Permission request not found");
        return request;
      },
      async reply(input: { requestID: string }) {
        replies.push(input);
        native.delete(input.requestID);
      },
    },
  } as unknown as Plugin.Context;
  const bridge = new SensitiveReadPermissions(context, "plugin-1", logEndpoint);
  await bridge.start();
  t.after(() => bridge.close());
  const observe = (type: string, data: Record<string, unknown>, directory = "/project") => {
    bridge.observe({ type, data, location: { directory } } as never);
  };
  const ask = (id = "request-1") => {
    const request = { id, sessionID: "session-1", action: "read", resources: ["/project/.env"], message: SENSITIVE_READ_MESSAGE };
    native.set(id, request);
    observe("permission.asked", request);
  };
  return { bridge, context, evaluate: (event: unknown) => evaluate(event as Evaluation), observe, ask, native, replies, isDisposed: () => disposed };
}

test("disabled Balrog transport denies sensitive reads but leaves normal reads, writes, and configured denies untouched", { timeout: 5_000 }, async (t) => {
  const plugin = await nativePlugin(t, "");
  for (const [action, resource, effect, expected] of [
    ["read", "/project/appsettings.Production.json", "allow", "deny"],
    ["read", "/project/.env", "ask", "deny"],
    ["read", "/project/.env", "deny", "deny"],
    ["read", "/project/README.md", "allow", "allow"],
    ["edit", "/project/.env", "allow", "allow"],
  ]) {
    const event = { sessionID: "session-1", action, resources: [resource], effect };
    await plugin.evaluate(event);
    assert.equal(event.effect, expected);
  }
  const directory = await mkdtemp(join(tmpdir(), "balrog-sensitive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".env"), "not read by the matcher");
  await symlink(join(directory, ".env"), join(directory, "innocent.txt"));
  const event = { sessionID: "session-1", action: "read", resources: [join(directory, "innocent.txt")], effect: "allow" };
  await plugin.evaluate(event);
  assert.equal(event.effect, "deny");
  await plugin.bridge.close();
  assert.equal(plugin.isDisposed(), true);
});

test("a fresh plugin discovers existing native sensitive asks across paginated sessions after reload", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const request = { id: "request-1", sessionID: "session-1", action: "read", resources: ["/project/appsettings.json"], message: SENSITIVE_READ_MESSAGE };
  const plugin = await nativePlugin(t, "", [request]);
  const pages: unknown[] = [];
  t.mock.method(plugin.context.session, "list", async (input: unknown) => {
    pages.push(input);
    if (pages.length === 1) return { data: [{ id: "unrelated", location: { directory: "/other" } }], cursor: { next: "next-page" } } as never;
    return { data: [{ id: "session-1", location: { directory: "/project" } }], cursor: {} } as never;
  });
  const recovered = new SensitiveReadPermissions(plugin.context, "plugin-1", logEndpoint);
  t.after(() => recovered.close());
  await recovered.start();
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  assert.deepEqual(pages, [{ directory: "/project", limit: 100 }, { cursor: "next-page" }]);
  browser.send(reply);
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  assert.deepEqual(plugin.replies, [{ sessionID: "session-1", requestID: "request-1", decision: "once" }]);
});

for (const decision of ["once", "reject"] as const) {
  test(`Balrog ${decision} invokes the native reply API with the original permission identity`, { timeout: 5_000 }, async (t) => {
    const { browser, logEndpoint, broker } = await bridgeServer(t);
    const plugin = await nativePlugin(t, logEndpoint);
    plugin.ask();
    await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
    browser.send({ ...reply, decision });
    await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
    assert.deepEqual(plugin.replies, [{ sessionID: "session-1", requestID: "request-1", decision }]);
    assert.deepEqual(broker.list(), []);
  });
}

test("native replies and session interruptions clear Balrog requests; foreign sessions and normal asks are ignored", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  plugin.ask();
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  plugin.native.clear();
  plugin.observe("permission.replied", { sessionID: "session-1", requestID: "request-1", reply: "once" });
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  plugin.ask("request-2");
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  plugin.observe("session.execution.interrupted", { sessionID: "session-1" });
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  plugin.observe("permission.asked", { sessionID: "other", id: "foreign", action: "read", resources: ["/other/.env"], message: SENSITIVE_READ_MESSAGE }, "/other");
  plugin.observe("permission.asked", { sessionID: "session-1", id: "normal", action: "read", resources: ["README.md"] });
  browser.send({ type: "snapshot.request" });
  assert.deepEqual((await browser.next((message) => message.type === "snapshot")).permissions, []);
  assert.deepEqual(plugin.replies, []);
});

test("native API failures remain retryable and stale native requests cannot be approved", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  plugin.ask();
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  const failingReply = t.mock.method(plugin.context.permission, "reply", async () => { throw new Error("Native permission unavailable"); });
  browser.send(reply);
  assert.equal((await browser.next((message) => message.type === "error")).message, "Native permission unavailable");
  failingReply.mock.restore();
  plugin.native.clear();
  browser.send(reply);
  assert.equal((await browser.next((message) => message.type === "error")).message, "Permission request not found");
  assert.deepEqual(plugin.replies, []);
});

test("disconnecting during a reply cannot grant access and removes actionable browser state", { timeout: 5_000 }, async (t) => {
  const { browser, connectPlugin, broker } = await bridgeServer(t);
  const plugin = await connectPlugin();
  browser.send(reply);
  await plugin.next<PermissionCommand>();
  plugin.socket.terminate();
  assert.match((await browser.next((message) => message.type === "error")).message, /disconnected/);
  await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  assert.deepEqual(broker.list(), []);
});

test("a new browser connection receives the current live permissions rather than recorded history", { timeout: 5_000 }, async (t) => {
  const { browser, connectPlugin, origin } = await bridgeServer(t);
  await connectPlugin();
  browser.socket.terminate();
  const reconnected = new Inbox(new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin }));
  t.after(() => reconnected.socket.terminate());
  await once(reconnected.socket, "open");
  reconnected.send({ type: "snapshot.request" });
  const snapshot = await reconnected.next();
  assert.equal(snapshot.permissions.length, 1);
  assert.equal(snapshot.permissions[0].requestID, "request-1");
  assert.deepEqual(snapshot.events, []);
});

test("plugin reconnects resynchronize against native pending requests instead of retaining a missed reply", { timeout: 5_000 }, async (t) => {
  const server = new WebSocketServer({ port: 0, host: "localhost" });
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => {
    for (const socket of server.clients) socket.terminate();
    server.close(() => resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection");
  const plugin = await nativePlugin(t, `http://localhost:${address.port}/log`);
  const [first] = await connected;
  const firstInbox = new Inbox(first as WebSocket);
  await firstInbox.next();
  plugin.ask();
  await firstInbox.next((message) => message.requests.length === 1);
  const reconnected = once(server, "connection");
  (first as WebSocket).terminate();
  plugin.native.clear();
  const [second] = await reconnected;
  const secondInbox = new Inbox(second as WebSocket);
  const snapshot = await secondInbox.next();
  assert.deepEqual(snapshot.requests, []);
  assert.deepEqual(plugin.replies, []);
  await plugin.bridge.close();
  assert.equal(plugin.isDisposed(), true);
});

test("untrusted Host headers cannot reach HTTP or WebSocket approval controls even with a matching Origin", { timeout: 5_000 }, async (t) => {
  const { origin, pluginURL, logEndpoint } = await bridgeServer(t);
  for (const url of [origin, logEndpoint]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 403);
  }
  for (const url of [`${origin.replace("http", "ws")}/ws`, pluginURL]) {
    const socket = new WebSocket(url, { headers: { Host: "attacker.example" }, origin: "http://attacker.example" });
    t.after(() => socket.terminate());
    const result = await new Promise<string>((resolve) => {
      socket.once("open", () => resolve("connected"));
      socket.once("error", (error) => resolve(error.message));
    });
    assert.match(result, /403/);
  }
});

test("mandatory sensitive evaluation cannot be released by native autoaccept; only a Balrog reply permits the read", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  const event = { sessionID: "session-1", action: "read", resources: ["/project/appsettings.json"], effect: "allow" };
  let completed = false;
  const evaluation = Promise.resolve(plugin.evaluate(event)).then(() => { completed = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false, "sensitive evaluation must wait for Balrog instead of returning ask to an autoaccepting client");
  const update = await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  const gate = update.permissions[0];
  plugin.observe("permission.replied", { sessionID: gate.sessionID, requestID: gate.requestID, reply: "once" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false, "native once replies must not resolve the private Balrog gate");
  browser.send({ type: "permission.reply", pluginID: gate.pluginID, sessionID: gate.sessionID, requestID: gate.requestID, decision: "once" });
  await evaluation;
  assert.equal(event.effect, "allow");
  assert.deepEqual(plugin.replies, [], "a private gate approval must not create another native prompt");
});

test("rejecting a mandatory gate denies the evaluation without a native fallback", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  const event = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "ask", message: "" };
  const evaluation = plugin.evaluate(event);
  const { permissions: [gate] } = await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  browser.send({ type: "permission.reply", pluginID: gate.pluginID, sessionID: gate.sessionID, requestID: gate.requestID, decision: "reject" });
  await evaluation;
  assert.equal(event.effect, "deny");
  assert.match(event.message, /rejected in Balrog/);
  assert.deepEqual(plugin.replies, []);
});

for (const cancellation of ["session.execution.interrupted", "session.deleted", "unload"] as const) {
  test(`${cancellation} denies unresolved mandatory gates and clears them`, { timeout: 5_000 }, async (t) => {
    const { browser, logEndpoint } = await bridgeServer(t);
    const plugin = await nativePlugin(t, logEndpoint);
    const event = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "allow" };
    const evaluation = plugin.evaluate(event);
    await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
    if (cancellation === "unload") await plugin.bridge.close();
    else plugin.observe(cancellation, { sessionID: "session-1" });
    await evaluation;
    assert.equal(event.effect, "deny");
    await browser.next((message) => message.type === "permissions" && message.permissions.length === 0);
  });
}

test("a mandatory gate cannot be answered using another session identity", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  const event = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "allow" };
  let completed = false;
  const evaluation = Promise.resolve(plugin.evaluate(event)).then(() => { completed = true; });
  const { permissions: [gate] } = await browser.next((message) => message.type === "permissions" && message.permissions.length === 1);
  browser.send({ type: "permission.reply", pluginID: gate.pluginID, sessionID: "other-session", requestID: gate.requestID, decision: "once" });
  assert.match((await browser.next((message) => message.type === "error")).message, /no longer available/);
  assert.equal(completed, false);
  browser.send({ type: "permission.reply", pluginID: gate.pluginID, sessionID: gate.sessionID, requestID: gate.requestID, decision: "once" });
  await evaluation;
  assert.equal(event.effect, "allow");
});

test("globally subscribed plugin instances do not gate another location's read", { timeout: 5_000 }, async (t) => {
  const { logEndpoint, broker } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  t.mock.method(plugin.context.session, "get", async () => ({ location: { directory: "/other" } }) as never);
  const event = { sessionID: "other-session", action: "read", resources: ["/other/.env"], effect: "allow" };
  await plugin.evaluate(event);
  assert.equal(event.effect, "allow");
  assert.deepEqual(broker.list(), []);
});

test("each concurrent read requires its own frontend approval, even for the same sensitive path", { timeout: 5_000 }, async (t) => {
  const { browser, logEndpoint } = await bridgeServer(t);
  const plugin = await nativePlugin(t, logEndpoint);
  const first = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "allow" };
  const second = { ...first };
  let secondCompleted = false;
  const firstEvaluation = plugin.evaluate(first);
  const secondEvaluation = Promise.resolve(plugin.evaluate(second)).then(() => { secondCompleted = true; });
  const { permissions: gates } = await browser.next((message) => message.type === "permissions" && message.permissions.length === 2);
  assert.notEqual(gates[0].requestID, gates[1].requestID);
  browser.send({ type: "permission.reply", pluginID: gates[0].pluginID, sessionID: gates[0].sessionID, requestID: gates[0].requestID, decision: "once" });
  await firstEvaluation;
  assert.equal(first.effect, "allow");
  assert.equal(secondCompleted, false);
  browser.send({ type: "permission.reply", pluginID: gates[1].pluginID, sessionID: gates[1].sessionID, requestID: gates[1].requestID, decision: "reject" });
  await secondEvaluation;
  assert.equal(second.effect, "deny");
});

test("unreachable Balrog does not grant access and unloading releases the blocked evaluation as denied", { timeout: 5_000 }, async (t) => {
  const plugin = await nativePlugin(t, "http://localhost:0/log");
  const event = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "allow" };
  let completed = false;
  const evaluation = Promise.resolve(plugin.evaluate(event)).then(() => { completed = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  await plugin.bridge.close();
  await evaluation;
  assert.equal(event.effect, "deny");
});

test("mandatory gates survive plugin transport reconnects without becoming native requests", { timeout: 5_000 }, async (t) => {
  const server = new WebSocketServer({ port: 0, host: "localhost" });
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => {
    for (const socket of server.clients) socket.terminate();
    server.close(() => resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection");
  const plugin = await nativePlugin(t, `http://localhost:${address.port}/log`);
  const [first] = await connected;
  const firstInbox = new Inbox(first as WebSocket);
  await firstInbox.next();
  const event = { sessionID: "session-1", action: "read", resources: ["/project/.env"], effect: "allow" };
  let completed = false;
  const evaluation = Promise.resolve(plugin.evaluate(event)).then(() => { completed = true; });
  const initial = await firstInbox.next((message) => message.requests.length === 1);
  const reconnected = once(server, "connection");
  (first as WebSocket).terminate();
  const [second] = await reconnected;
  const secondInbox = new Inbox(second as WebSocket);
  const snapshot = await secondInbox.next((message) => message.requests.length === 1);
  assert.deepEqual(snapshot.requests, initial.requests);
  assert.equal(completed, false);
  const gate = snapshot.requests[0];
  secondInbox.send({ type: "permission.reply", pluginID: "plugin-1", sessionID: gate.sessionID, requestID: gate.requestID, decision: "once", commandID: "reconnected-approval" });
  await evaluation;
  assert.equal(event.effect, "allow");
  assert.deepEqual(plugin.replies, []);
});
