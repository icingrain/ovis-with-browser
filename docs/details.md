# Details

Everything the [README](../README.md) leaves out: setup by hand, the helper, the skill, registering a Chrome yourself, how it works, limits and how the fork is kept.

## setup by hand

`ovis-with-browser setup` does these steps for you. By hand:

```bash
herdr plugin install icingrain/ovis-with-browser -y        # or: git clone … && herdr plugin link .
```

The plugin has its own id (`icingrain.ovis-with-browser`) and port **7318**, so it runs beside an Ovis install (`devswha.ovis`, port 7317). Keep its settings and pairing apart from that install with these two lines in `~/.config/herdr/plugins/config/icingrain.ovis-with-browser/env` (`herdr plugin config-dir icingrain.ovis-with-browser` prints the folder):

```
PORT=7318
OVIS_STATE_DIR=~/.local/state/ovis-with-browser
```

Then start it: `herdr plugin action invoke start --plugin icingrain.ovis-with-browser`. It starts with herdr from then on. The install scripts, Mac and Windows apps of the Ovis README still install upstream's Ovis, not this fork.

## setup flags

`ovis-with-browser setup` asks when it runs in a terminal; flags answer for it.

| flag | meaning |
|---|---|
| `--skill` / `--no-skill` | install the agent skill, or not |
| `--tailnet existing\|separate\|skip` | the tailnet address already in use (port 443), a separate one, or none |
| `--https-port <n>` | the HTTPS port of a separate address (default: the first free of 8443, 8444, 8445, 10000) |
| `--force` | replace what another service already serves on that tailnet address |
| `--port <n>` | the server port (default 7318) |
| `--no-plugin` | leave the plugin as it is (already linked, say) |
| `--ref <tag>` | the plugin version to install |
| `--yes` | take the safe answer to every question: the skill is installed, no tailnet address is touched |

A mobile device reaches Ovis over Tailscale: `tailscale serve --https=8443 --bg http://127.0.0.1:7318` is what `--tailnet separate` runs. Undo it with `tailscale serve --https=8443 off`.

## let the agent register its own Chrome

The skill tells an agent to start its Chrome through `scripts/ovis-browser.ts` (the `ovis-browser` command of the npm package), which launches a Chrome with its own profile and registers it for the pane the agent runs in (`$HERDR_PANE_ID`).

```bash
ovis-browser start --url https://example.com    # launch or reuse this pane's Chrome and register it
ovis-browser status
ovis-browser stop                                # unregister and close it
```

It reads `OVIS_URL` (default `http://127.0.0.1:7318`) and `OVIS_TOKEN` when the server asks for one. After an Ovis restart, `start` registers the Chrome that is still running instead of launching a second one.

Installing the skill by hand:

```bash
bun scripts/install-browser-skill.ts          # shows what it would write, writes nothing
bun scripts/install-browser-skill.ts --yes    # installs ovis-browser
bun scripts/install-browser-skill.ts --remove --yes
```

It writes `skills/ovis-browser/SKILL.md` in two places: `~/.claude` (Claude Code reads only its own folder; skipped when `~/.claude` is missing) and the shared `~/.agents/skills`, the folder herdr's own skill lives in, which Codex and the other agents of the open [`skills`](https://github.com/vercel-labs/skills) CLI read. `--agent codex` or `--agent opencode` adds an agent's own folder too. It only replaces files it wrote itself; restart running agent sessions afterwards. As a herdr plugin action it is **Install the Browser tab skill**.

An agent does not always pick the skill by itself. Claude Code did in testing; Codex, which has a browser tool of its own, used that one until it was asked by name. Say "open it with ovis-browser" in the request, or put one line in the agent's instructions (`AGENTS.md`, `CLAUDE.md`): *In a herdr pane, open browsers with the ovis-browser skill, not a built-in browser tool.*

## register a Chrome by hand

1. Start Chrome with a debugging port on loopback:
   ```bash
   chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/agent-chrome
   ```
2. Register it for a pane (`$HERDR_PANE_ID` inside a pane; `herdr pane list` elsewhere):
   ```bash
   curl -X POST 'http://127.0.0.1:7318/api/pane/browser/register' \
     -H 'content-type: application/json' \
     --data '{"pane_id":"w1:p1","cdp_url":"http://127.0.0.1:9222"}'
   ```
   Only `http://127.0.0.1:<port>` endpoints are accepted. `DELETE /api/pane/browser?pane_id=w1:p1` unregisters. The registration lives in the server's memory, so a restart needs it again. A server that asks for a token or a paired device needs `Authorization: Bearer <token>` on these calls.
3. Open the pane in Ovis and pick **Browser**.

`bun scripts/browser-tab-demo.ts --pane-id=<pane id>` opens a Chrome with an interaction test page and prints the register command.

## how it works

1. **Chrome runs on your computer.** The agent's Chrome has a debugging port on loopback. Ovis does not launch it: the agent starts it through the helper, or you do.
2. **Register it for a pane.** The Ovis server keeps the Chrome's address for that herdr pane in memory and shows a Browser tab for it. The server is Ovis's own, with one module added ([server/browser-sessions.ts](../server/browser-sessions.ts)); there is no second server.
3. **Frames go out.** The server asks Chrome for a screencast of one tab and sends each frame to the browser or mobile device that has the tab open. Mobile devices get smaller, lower quality frames.
4. **Input comes back.** Clicks, moves, scrolls and keys go to the server and are replayed in Chrome. Pointer moves are coalesced: only the latest is sent while a request is in flight.
5. **Control is explicit.** The view starts read-only. The first tap or key takes control and is not sent to the page. Esc, the release button or 60 seconds without input give it back.

## latency

What you see is a stream, so a page's reaction reaches the screen after the network round trip plus Chrome's capture and encode time. That cannot be removed; these keep input from piling up on top of it:

- **Pointer moves are coalesced.** The client sends only the latest move while a request is in flight, so the cursor never trails behind a queue ([src/lib/browserInputQueue.ts](../src/lib/browserInputQueue.ts)).
- **The cursor is drawn locally** in Trackpad mode, ahead of the server's answer. The real pointer in Chrome follows.
- **The server batches input and keeps only the newest frame.** Input goes to Chrome over CDP in batches, and a frame that is still unsent when a newer one arrives is dropped ([server/browser-sessions.ts](../server/browser-sessions.ts)).
- **Touch devices get smaller frames:** at most 1280×720, at JPEG quality 45, which cuts transfer and encode time.

These were judged by feel, not measured. A slow link still shows as lag; more would need frame sizes that follow the link, or sending only what changed.

## limits

- Chrome has to run on the same computer as the Ovis server, as a desktop (not headless) Chrome; a pane on a remote PC has no Browser tab.
- Windows is not tested yet: the Browser tab, the helper and the skill installer were only run on macOS.
- Native date, color and file pickers, paste and IME composition are not relayed.
- What you see is a stream: a page's reaction reaches the screen after the network round trip plus Chrome's capture and encode time.
- The registered Chrome is fully controllable by anyone who can open Ovis, so the usual Ovis access rules (token, paired devices, Tailscale) are the protection. Register only a Chrome you are willing to share.

## how the fork is kept

- `upstream-sync` mirrors `devswha/ovis` `main` and is never committed to.
- `main` is `upstream-sync` plus the Browser tab, rebased after each upstream update.
- The Browser tab lives in `server/browser-sessions.ts`, `src/components/BrowserView.*`, `src/lib/browser*.ts` and `scripts/browser-tab-*`; the rest of the diff is thin wiring (the `PaneView` type, the pane lens, the header button, translations).
- The npm package (`bun scripts/build-npm-package.ts` builds it into `dist-npm/`) has its own version; `ovisWithBrowser.ovisTested` in its `package.json` is the Ovis release it was tested with.
