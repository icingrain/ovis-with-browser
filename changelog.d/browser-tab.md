### Added
- A pane with a registered Chrome DevTools endpoint gets a Browser tab next to Chat and Terminal.
  It shows the agent's browser tab live and takes control on the first click, with mouse, keyboard,
  select menus and JavaScript dialogs drawn by the web UI. A tab that Chrome keeps in the
  background is shown behind a card that offers to bring it forward.
- On a touch device the Browser tab opens in a Trackpad mode: a cursor moved by one finger, tap to
  click, two-finger tap to right-click, tap and drag, drag lock, two-finger scroll and a keyboard
  button. Pointer moves are coalesced so the cursor keeps up on a slow link.
- `scripts/ovis-browser.ts` launches a Chrome with its own profile and registers it for the herdr pane
  it runs in, and `scripts/install-browser-skill.ts` (or the plugin action "Install the Browser tab
  skill") writes an `ovis-browser` skill for Claude Code and the shared agents folder so agents do
  it on their own.
- This fork is the herdr plugin `icingrain.ovis-with-browser` and serves on port 7318 by default, so it
  runs beside an `devswha.ovis` install (port 7317) without sharing its state.
- An `ovis-with-browser` npm package (built by `scripts/build-npm-package.ts`) with a `setup` command that installs and starts the plugin from GitHub, writes its settings, and offers the agent skill and a tailnet address (existing, separate or none).
