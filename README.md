<p align="center">
  <img src="public/icons/icon-192.png" alt="Ovis" width="100">
</p>

<h1 align="center">Ovis with Browser</h1>

<p align="center">
  <strong>The browser an agent drives, in a tab next to its chat and terminal.</strong>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ko.md">한국어</a>
</p>

A fork of [Ovis](https://github.com/devswha/ovis), the browser and mobile client for [herdr](https://github.com/herdrdev/herdr). Everything Ovis does is still here; this fork adds one thing: a **Browser** tab. When a coding agent works in a Chrome, you see that same Chrome tab live in Ovis, on your computer or on a mobile device, and you can take over when the agent needs a hand.

For everything else (install, agents, chat, terminal, push alerts, remote PCs) see the [Ovis README](https://github.com/devswha/ovis#readme) and its [user guide](https://github.com/devswha/ovis/blob/main/docs/guide.md). This README covers only what the fork adds.

## what it does

- **A Browser tab** next to Chat and Terminal, for a pane whose agent drives a Chrome. It appears when that Chrome is registered for the pane.
- **The same tab the agent uses.** Ovis streams the Chrome tab (Chrome DevTools Protocol screencast) and sends your clicks and keys back. A tab picker lists the open tabs.
- **Take control only when you mean to.** The view starts read-only. The first click or key takes control and is not forwarded to the page; **Esc**, the release button or 60 seconds without input give control back. Scrolling never takes control.
- **Built for mobile devices.** On a touch device the tab opens in **Trackpad** mode: one finger moves a cursor (hover works), a tap clicks, two fingers tap to right-click or move to scroll, tap and drag drags. A bar below adds right click, a keyboard button and a drag lock. **Direct** mode sends the pointer as it is, for a mouse.
- **Menus and dialogs that work.** Chrome's native `<select>` list and JavaScript `alert`, `confirm` and `prompt` cannot be screencast, so Ovis draws them and sends your answer back.
- **Background tabs without surprises.** Chrome does not paint a hidden tab. Picking one shows a card with **Show this tab** (takes control and brings the tab forward) and **Back**. Looking at a tab never raises the Chrome window.

## how it works

<p align="center">
  <img src="docs/media/browser-tab/flow.gif" alt="Animated diagram: the agent's Chrome is registered for a herdr pane; Ovis streams its screen to the mobile device as frames; the first tap takes control; moves and taps travel back through the Ovis server to Chrome; Esc or 60 seconds idle gives control back." width="640">
</p>

1. **Chrome runs on your computer.** The agent's Chrome has a debugging port on loopback. Ovis does not launch it: the agent starts it through the helper (see below) or you do.
2. **Register it for a pane.** The Ovis server keeps the Chrome's address for that herdr pane in memory and shows a Browser tab for it. The server is Ovis's own, with one module added for this ([server/browser-sessions.ts](server/browser-sessions.ts)); there is no second server.
3. **Frames go out.** The server asks Chrome for a screencast of one tab and sends each frame to the browser or mobile device that has the tab open. Mobile devices get smaller, lower quality frames.
4. **Input comes back.** Your clicks, moves, scrolls and keys go to the server and are replayed in Chrome. Pointer moves are coalesced, so only the latest one is sent while a request is in flight.
5. **Control is explicit.** The view starts read-only. The first tap or key takes control, and is not sent to the page. Esc, the release button or 60 seconds without input give it back.

## install

You need [herdr](https://github.com/herdrdev/herdr), [Bun](https://bun.sh) and a desktop Chrome on the same computer. macOS and Linux are tested; **Windows is not tested yet.**

```bash
git clone https://github.com/icingrain/ovis-with-browser.git
cd ovis-with-browser
herdr plugin link .
herdr plugin action invoke start --plugin icingrain.ovis-with-browser
```

It runs beside an Ovis install: its own plugin id (`icingrain.ovis-with-browser`) and port **7318**. To keep its settings and pairing apart from the install, put these two lines in `~/.config/herdr/plugins/config/icingrain.ovis-with-browser/env`:

```
PORT=7318
OVIS_STATE_DIR=~/.local/state/ovis-with-browser
```

Open `http://127.0.0.1:7318`, or from a mobile device over Tailscale: `tailscale serve --https=8443 --bg http://127.0.0.1:7318`. The install scripts, the Mac and Windows apps in the Ovis README still install upstream's Ovis, not this fork.

### setup command

The `ovis-with-browser` npm package puts the helper on your PATH and walks through the rest: the agent skill, then a tailnet address for mobile devices (the one already in use, a separate one, or none).

```bash
bun add -g ovis-with-browser
ovis-with-browser setup
```

It asks when it runs in a terminal; flags answer for it (`--skill`, `--no-skill`, `--tailnet existing|separate|skip`, `--https-port`, `--force`). It never replaces a tailnet address another service uses unless `--force` is given. [npm package](https://www.npmjs.com/package/ovis-with-browser); `bun scripts/build-npm-package.ts` builds it into `dist-npm/`.

### let the agent register its own Chrome (recommended)

Install the skill once. It tells the agent to start its Chrome through `scripts/ovis-browser.ts`, which launches a Chrome with its own profile and registers it for the pane the agent runs in (`$HERDR_PANE_ID`).

```bash
bun scripts/install-browser-skill.ts          # shows what it would write, writes nothing
bun scripts/install-browser-skill.ts --yes    # installs ovis-browser
bun scripts/install-browser-skill.ts --remove --yes
```

It writes `skills/ovis-browser/SKILL.md` in two places: `~/.claude` (Claude Code reads only its own folder; skipped when `~/.claude` is missing) and the shared `~/.agents/skills`, the folder herdr's own skill lives in, which Codex and the other agents of the open [`skills`](https://github.com/vercel-labs/skills) CLI read. `--agent codex` or `--agent opencode` adds an agent's own folder too. It only replaces files it wrote itself, and restart running agent sessions afterwards. If you run Ovis as a herdr plugin, the same install is the plugin action **Install the Browser tab skill**; nothing runs it for you.

An agent does not always pick the skill by itself. Claude Code did in testing; Codex, which has a browser tool of its own, used that one instead until it was asked by name. Say "open it with ovis-browser" in the request, or put one line in the agent's instructions (`AGENTS.md`, `CLAUDE.md`), for example: *In a herdr pane, open browsers with the ovis-browser skill, not a built-in browser tool.*

From then on, an agent in a pane that needs a browser runs `ovis-browser start`, drives the printed `cdp_url`, and you open the pane's **Browser** tab. The helper reads `OVIS_URL` (default `http://127.0.0.1:7318`) and `OVIS_TOKEN` when the server asks for one.

```bash
bun scripts/ovis-browser.ts start --url https://example.com   # launch or reuse this pane's Chrome and register it
bun scripts/ovis-browser.ts status
bun scripts/ovis-browser.ts stop                               # unregister and close it
```

### or register one by hand

1. Start Chrome with a debugging port on loopback:
   ```bash
   chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/agent-chrome
   ```
2. Register it for a pane. Inside a pane the ID is `$HERDR_PANE_ID`; elsewhere `herdr pane list` prints them.
   ```bash
   curl -X POST 'http://127.0.0.1:7318/api/pane/browser/register' \
     -H 'content-type: application/json' \
     --data '{"pane_id":"w1:p1","cdp_url":"http://127.0.0.1:9222"}'
   ```
   Only `http://127.0.0.1:<port>` endpoints are accepted. `DELETE /api/pane/browser?pane_id=w1:p1` unregisters. The registration lives in the server's memory, so a restart needs it again. A server that asks for a token or a paired device needs `Authorization: Bearer <token>` on these calls.
3. Open the pane in Ovis and pick **Browser**.

`bun scripts/browser-tab-demo.ts --pane-id=<pane id>` opens a Chrome with an interaction test page and prints the register command, which is the quickest way to try it.

## on a mobile device

On a touch device the Browser tab opens in **Trackpad** mode: the page area is a touchpad, and a cursor shows where a tap will land. **Direct** mode, next to it, sends the pointer as it is, for a mouse. The choice is remembered per device. The bar under the page has **Right click**, **Keyboard** (opens the keyboard) and **Drag lock**.

<table>
  <tr>
    <td width="50%" valign="top"><b>1. Take control and move</b><br>Tap once to take control; that first tap is not sent to the page. Then drag one finger: the cursor follows, and hover works.</td>
    <td width="50%" valign="top"><b>2. Click and right-click</b><br>A tap clicks where the cursor is. A tap with two fingers right-clicks; so does the Right click button.</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-1-control-and-move.gif" alt="Mobile screen: a tap switches control on, then one finger moves the cursor over the page" width="260"></td>
    <td align="center"><img src="docs/media/browser-tab/guide-2-click-and-right-click.gif" alt="Mobile screen: a tap clicks a button, a two-finger tap opens a context menu" width="260"></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>3. Drag</b><br>Tap, then touch again at once and move to grab and drag. For a long drag, turn Drag lock on, move, and turn it off to let go.</td>
    <td width="50%" valign="top"><b>4. Menus and scrolling</b><br>A select list opens at the cursor; alert, confirm and prompt appear as dialogs. Two fingers up or down scroll and never take control.</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-3-drag.gif" alt="Mobile screen: a tap then a touch and move drags a box; the Drag lock button is highlighted" width="260"></td>
    <td align="center"><img src="docs/media/browser-tab/guide-4-menus-and-scroll.gif" alt="Mobile screen: a select menu opens under the cursor, then two fingers scroll the page" width="260"></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>5. Let go and switch tabs</b><br>The X button (or Esc, or 60 seconds idle) gives control back. The tab picker rises as a bottom sheet; a background tab shows a card with Show this tab.</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-5-release-and-tabs.gif" alt="Mobile screen: the X button releases control, then the tab picker opens as a bottom sheet" width="260"></td>
  </tr>
</table>

## limits

- Chrome has to run on the same computer as the Ovis server, as a desktop (not headless) Chrome; a pane on a remote PC has no Browser tab.
- Windows is not tested yet: the Browser tab, the helper and the skill installer were only run on macOS. The Windows paths in `scripts/ovis-browser.ts` and `scripts/install-browser-skill.ts` are written but unverified.
- Native date, color and file pickers, paste and IME composition are not relayed.
- What you see is a stream: a page's reaction reaches the screen after the network round trip plus Chrome's capture and encode time. Mobile devices receive smaller, lower quality frames to keep up.
- The registered Chrome is fully controllable by anyone who can open Ovis, so the usual Ovis access rules (token, paired devices, Tailscale) are the protection. Register only a Chrome you are willing to share.

## how the fork is kept

- `upstream-sync` mirrors `devswha/ovis` `main` and is never committed to.
- `main` is `upstream-sync` plus the Browser tab, rebased after each upstream update.
- The Browser tab lives in `server/browser-sessions.ts`, `src/components/BrowserView.*`, `src/lib/browser*.ts` and `scripts/browser-tab-*`; the rest of the diff is thin wiring (the `PaneView` type, the pane lens, the header button, translations).

Ovis is MIT licensed; see [LICENSE](LICENSE).
