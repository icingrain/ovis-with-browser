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
- **The same tab the agent uses**, streamed live. You click and type in it; a tab picker lists the open tabs.
- **Control only when you mean to.** The view starts read-only; the first click or key takes control (and is not sent to the page); **Esc**, the release button or 60 seconds idle give it back. Scrolling never takes control.
- **Built for mobile devices.** A touch screen becomes a trackpad: one finger moves a cursor, a tap clicks, two fingers right-click or scroll, tap and drag drags.
- **Menus and dialogs that work.** Chrome's `<select>` lists and JavaScript `alert`, `confirm` and `prompt` cannot be screencast, so Ovis draws them.

<p align="center">
  <img src="docs/media/browser-tab/flow.gif" alt="Animated diagram: the agent's Chrome is registered for a herdr pane; Ovis streams its screen to the mobile device as frames; the first tap takes control; moves and taps travel back through the Ovis server to Chrome; Esc or 60 seconds idle gives control back." width="640">
</p>

## install

You need [herdr](https://github.com/herdrdev/herdr), [Bun](https://bun.sh) and a desktop Chrome on the same computer. macOS and Linux are tested; **Windows is not tested yet.**

```bash
bun add -g ovis-with-browser
ovis-with-browser setup
```

`setup` installs this fork as a herdr plugin and starts it at `http://127.0.0.1:7318`, then asks whether to install the agent skill (so an agent registers its own Chrome) and whether to open Ovis on a mobile device through Tailscale. It runs beside an Ovis install without touching it. [Setup by hand, flags and the rest →](docs/details.md)

An agent in a herdr pane that needs a browser runs `ovis-browser start`; open that pane's **Browser** tab to watch and steer it.

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

## more

[Details](docs/details.md): setup by hand, flags, the helper and skill, registering a Chrome yourself, how it works, limits.

Ovis is MIT licensed; see [LICENSE](LICENSE).
