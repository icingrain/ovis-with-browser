import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync("/tmp/hqa-");
let pageServer: ReturnType<typeof Bun.serve> | undefined;
let chrome: ReturnType<typeof Bun.spawn> | undefined;
let browserSocket: WebSocket | undefined;

try {
  const tailscale = Bun.spawnSync({ cmd: ["tailscale", "ip", "-4"], stdout: "pipe", stderr: "pipe" });
  const qaHost = tailscale.stdout.toString().trim();
  if (tailscale.exitCode !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(qaHost)) throw new Error("A Tailscale IPv4 address is required for the demo page server");
  pageServer = Bun.serve({
    hostname: qaHost, port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path !== "/" && path !== "/second.html") return new Response("Not found", { status: 404 });
      const file = path === "/" ? "index.html" : "second.html";
      return new Response(Bun.file(new URL(`./browser-tab-demo/${file}`, import.meta.url)), { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const cdpPort = portProbe.port;
  portProbe.stop(true);
  chrome = Bun.spawn([chromePath(), `--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${join(root, "chrome")}`, "--no-first-run", "--no-default-browser-check", "--new-window",
    `http://${qaHost}:${pageServer.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  if (!(chrome.stderr instanceof ReadableStream)) throw new Error("Chrome stderr is unavailable");
  const reader = chrome.stderr.getReader();
  let startup = "";
  while (!startup.includes("DevTools listening on")) {
    const result = await reader.read();
    if (result.done) throw new Error(`Chrome exited before CDP started: ${startup.slice(-500)}`);
    startup += new TextDecoder().decode(result.value);
    if (startup.length > 2000) startup = startup.slice(-1000);
  }
  reader.releaseLock();
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  const demoUrl = `http://${qaHost}:${pageServer.port}/`;
  let firstId = "";
  const deadline = Date.now() + 5_000;
  while (!firstId) {
    const response = await fetch(`${cdpUrl}/json/list`);
    if (!response.ok) throw new Error(`Chrome debugging endpoint returned ${response.status}`);
    const tabs = await response.json() as { id: string; type: string; url: string }[];
    firstId = tabs.find((tab) => tab.type === "page" && tab.url === demoUrl)?.id ?? "";
    if (Date.now() > deadline) throw new Error("Demo page did not open in Chrome");
    if (!firstId) await Bun.sleep(25);
  }
  const version = await (await fetch(`${cdpUrl}/json/version`)).json() as { webSocketDebuggerUrl: string };
  browserSocket = new WebSocket(version.webSocketDebuggerUrl);
  const socket = browserSocket;
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome browser CDP connection failed")), { once: true });
  });
  let commandId = 0;
  const call = (method: string, params: object) => new Promise<void>((resolve, reject) => {
    const id = ++commandId;
    const onMessage = (event: MessageEvent) => {
      const reply = JSON.parse(String(event.data)) as { id?: number; error?: unknown };
      if (reply.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (reply.error) reject(new Error(`${method}: ${JSON.stringify(reply.error)}`));
      else resolve();
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Target.createTarget", { url: `${demoUrl}second.html` });
  await call("Target.activateTarget", { targetId: firstId });
  socket.close();
  browserSocket = undefined;
  const paneId = process.argv.find((arg) => arg.startsWith("--pane-id="))?.slice("--pane-id=".length) ?? "<pane-id>";
  const body = JSON.stringify({ pane_id: paneId, cdp_url: cdpUrl });
  const quotedBody = `'${body.replaceAll("'", "'\\''")}'`;
  process.stdout.write(`Demo page: http://${qaHost}:${pageServer.port}/\nCDP: ${cdpUrl}\n`);
  process.stdout.write(`Register from this PC: curl -X POST 'http://<tailscale-ip>:<web-ui-port>/api/pane/browser/register' -H 'content-type: application/json' --data ${quotedBody}\n`);
  process.stdout.write("Press Ctrl+C to close Chrome and remove its temporary profile.\n");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
    chrome?.exited.then(() => resolve());
  });
} finally {
  browserSocket?.close();
  try { chrome?.kill(); } catch { /* already exited */ }
  await chrome?.exited;
  pageServer?.stop(true);
  rmSync(root, { recursive: true, force: true });
}
