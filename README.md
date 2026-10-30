<p align="center">
  <img src="public/icons/icon-192.png" alt="Ovis" width="100">
</p>

<h1 align="center">Ovis with Browser</h1>

<p align="center">
  <strong>The browser an agent drives, in a tab next to its chat and terminal.</strong>
</p>

A fork of [Ovis](https://github.com/devswha/ovis), the browser and phone client for [herdr](https://github.com/herdrdev/herdr). Everything Ovis does is still here; this fork adds one thing: a **Browser** tab. When a coding agent works in a Chrome, you see that same Chrome tab live in Ovis, on your computer or on your phone, and you can take over when the agent needs a hand.

For everything else (install, agents, chat, terminal, push alerts, remote PCs) see the [Ovis README](https://github.com/devswha/ovis#readme) and its [user guide](https://github.com/devswha/ovis/blob/main/docs/guide.md). This README covers only what the fork adds.

## what it does

- **A Browser tab** next to Chat and Terminal, for a pane whose agent drives a Chrome. It appears when that Chrome is registered for the pane.
- **The same tab the agent uses.** Ovis streams the Chrome tab (Chrome DevTools Protocol screencast) and sends your clicks and keys back. A tab picker lists the open tabs.
- **Take control only when you mean to.** The view starts read-only. The first click or key takes control and is not forwarded to the page; **Esc**, the release button or 60 seconds without input give control back. Scrolling never takes control.
- **Built for a phone.** On a touch device the tab opens in **Trackpad** mode: one finger moves a cursor (hover works), a tap clicks, two fingers tap to right-click or move to scroll, tap and drag drags. A bar below adds right click, a keyboard button and a drag lock. **Direct** mode sends the pointer as it is, for a mouse.
- **Menus and dialogs that work.** Chrome's native `<select>` list and JavaScript `alert`, `confirm` and `prompt` cannot be screencast, so Ovis draws them and sends your answer back.
- **Background tabs without surprises.** Chrome does not paint a hidden tab. Picking one shows a card with **Show this tab** (takes control and brings the tab forward) and **Back**. Looking at a tab never raises the Chrome window.

## use it

You need herdr, [Bun](https://bun.sh) and a Chrome on the same computer as Ovis.

```bash
git clone https://github.com/icingrain/ovis-with-browser.git
cd ovis-with-browser
bun install
bun run build
HOST=$(tailscale ip -4) PORT=7317 bun run server   # open http://<that address>:7317
```

Then give a pane a Chrome to show:

1. Start Chrome with a debugging port on loopback:
   ```bash
   chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/agent-chrome
   ```
2. Register it for a pane (the pane IDs are the ones `herdr pane list` prints):
   ```bash
   curl -X POST 'http://127.0.0.1:7317/api/pane/browser/register' \
     -H 'content-type: application/json' \
     --data '{"pane_id":"w1:p1","cdp_url":"http://127.0.0.1:9222"}'
   ```
   Only `http://127.0.0.1:<port>` endpoints are accepted. `DELETE /api/pane/browser?pane_id=w1:p1` unregisters. The registration lives in the server's memory, so a restart needs it again. A server that asks for a token or a paired device needs `Authorization: Bearer <token>` on these calls.
3. Open the pane in Ovis and pick **Browser**.

`bun scripts/browser-tab-demo.ts --pane-id=<pane id>` opens a Chrome with an interaction test page and prints the register command, which is the quickest way to try it.

## limits

- Chrome has to run on the same computer as the Ovis server; a pane on a remote PC has no Browser tab.
- Native date, color and file pickers, paste and IME composition are not relayed.
- What you see is a stream: a page's reaction reaches the screen after the network round trip plus Chrome's capture and encode time. Phones receive smaller, lower quality frames to keep up.
- The registered Chrome is fully controllable by anyone who can open Ovis, so the usual Ovis access rules (token, paired devices, Tailscale) are the protection. Register only a Chrome you are willing to share.

## how the fork is kept

- `upstream-sync` mirrors `devswha/ovis` `main` and is never committed to.
- `main` is `upstream-sync` plus the Browser tab, rebased after each upstream update.
- The Browser tab lives in `server/browser-sessions.ts`, `src/components/BrowserView.*`, `src/lib/browser*.ts` and `scripts/browser-tab-*`; the rest of the diff is thin wiring (the `PaneView` type, the pane lens, the header button, translations).

Ovis is MIT licensed; see [LICENSE](LICENSE).
