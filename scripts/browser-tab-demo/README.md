# Browser tab interaction fixture

Run this only on the test MacBook Air (`eamac`), in a fresh temporary clone. Start the web UI
against an isolated herdr test session and bind it to that machine's Tailscale IPv4 address.
Use a short temporary root such as `/tmp/hqa` for socket paths.

```sh
bun scripts/browser-tab-demo.ts --pane-id=<isolated-pane-id>
```

The launcher opens headful Chrome with a disposable profile, serves the interaction page on
the machine's Tailscale IPv4 address, opens a second tab, and prints its loopback CDP URL and a
registration command. Keep it running while
checking the Browser pane. Its Ctrl+C cleanup closes Chrome, the page server, and the profile.

For the scripted check, register the session using the printed command, then run:

```sh
BROWSER_QA_UI=http://<tailscale-ip>:<web-ui-port> \
BROWSER_QA_PANE=<isolated-pane-id> \
BROWSER_QA_CDP=http://127.0.0.1:<cdp-port> \
bun scripts/browser-tab-demo-qa.ts
```

The check drives only the web UI through Playwright and reads the demo page through a raw CDP
WebSocket, so Playwright cannot auto-dismiss its JavaScript dialogs. It reloads and fronts the interaction tab before each run, then verifies
the Browser picker selected that tab. Hover and drag checks run after the first click has entered
control mode. The check leaves the pane registered
for manual QA. Stop the isolated web UI and herdr
test session, then remove the temporary clone. Paste and IME input are outside this prototype.
