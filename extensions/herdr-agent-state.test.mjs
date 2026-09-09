import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "herdr-agent-state-"));
const socketPath = path.join(tempDir, "herdr.sock");
const requests = [];
let protocolError;
const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    try {
      requests.push(JSON.parse(buffer.slice(0, newline)));
      socket.write("{}\n");
    } catch (error) {
      protocolError = error;
      socket.destroy();
    }
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});

const previousEnv = {
  HERDR_ENV: process.env.HERDR_ENV,
  HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
  HERDR_PANE_ID: process.env.HERDR_PANE_ID,
};
process.env.HERDR_ENV = "1";
process.env.HERDR_SOCKET_PATH = socketPath;
process.env.HERDR_PANE_ID = "test:pane";

function agentReports(after = 0) {
  return requests
    .slice(after)
    .filter((request) => request.method === "pane.report_agent")
    .map((request) => request.params);
}

async function waitForState(state, after = 0) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (protocolError) throw protocolError;
    const report = agentReports(after).find((candidate) => candidate.state === state);
    if (report) return report;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${state}; reports: ${JSON.stringify(agentReports(after))}`);
}

try {
  const extensionUrl = pathToFileURL(path.join(import.meta.dirname, "herdr-agent-state.ts"));
  extensionUrl.searchParams.set("test", String(Date.now()));
  const { default: registerExtension } = await import(extensionUrl.href);
  const lifecycle = new Map();
  const events = new EventEmitter();
  const pi = {
    events,
    on(name, handler) {
      const handlers = lifecycle.get(name) ?? [];
      handlers.push(handler);
      lifecycle.set(name, handlers);
    },
  };
  registerExtension(pi);

  const context = {
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    sessionManager: {
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionId: () => "session-id",
    },
  };
  for (const handler of lifecycle.get("session_start") ?? []) {
    await handler({ reason: "reload" }, context);
  }
  await waitForState("idle");

  let cursor = requests.length;
  events.emit("herdr:busy", { active: true, label: "⏳ 1 subagent (adversary)" });
  const working = await waitForState("working", cursor);
  assert.equal(working.message, "⏳ 1 subagent (adversary)");

  cursor = requests.length;
  events.emit("herdr:blocked", { active: true, label: "subagent needs attention" });
  await waitForState("blocked", cursor);

  cursor = requests.length;
  events.emit("herdr:blocked", { active: false });
  await waitForState("working", cursor);

  cursor = requests.length;
  events.emit("herdr:busy", { active: false });
  await waitForState("idle", cursor);

  console.log("ok — restored busy state survives blocked-state transitions");
} finally {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
