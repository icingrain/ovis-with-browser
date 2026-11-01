---
name: ovis-browser
description: Use when you need to open or drive a web page in a browser while running inside a herdr pane (HERDR_PANE_ID is set), so the person can watch and steer that same Chrome tab from the Browser tab in Ovis.
---

# Ovis browser

Ovis can show the Chrome you drive, live, in a Browser tab next to this pane's chat and terminal, on a computer or a phone, and lets the person take over. It can only show a Chrome that is registered for the pane, so start yours with the helper below instead of launching a browser yourself.

## When to use it

- You are in a herdr pane (`echo $HERDR_PANE_ID` prints something) and you are about to use a browser: open a page, test a UI, click through a flow, take a screenshot.
- Skip it when there is no `HERDR_PANE_ID`, or when you only need to fetch a page's text without a browser.

## Steps

1. Start (or reuse) this pane's Chrome. It prints a `cdp_url`:

   ```bash
   {{HELPER}} start --url https://example.com
   ```

   Running it again for the same pane reuses the Chrome that is already open.

2. Drive **that** Chrome through its `cdp_url`; do not launch another browser, since the person can only see the registered one.
   - Playwright: `chromium.connectOverCDP(cdp_url)`, then use the existing context and page.
   - Puppeteer: `puppeteer.connect({ browserURL: cdp_url })`.
   - A DevTools-style MCP server: point it at the same URL (for example `--browserUrl`).

3. Work in the tab that is open and keep it there for the person to see. They may take control with a tap or click; expect the page to change under you, and wait for them to hand it back rather than fighting their input.

4. When you are done with the browser:

   ```bash
   {{HELPER}} stop
   ```

   `status` says what is registered for the pane.

## If the helper fails

It needs Ovis running on this computer (default `http://127.0.0.1:7317`; set `OVIS_URL`, and `OVIS_TOKEN` when the server asks for one) and a Chrome (`CHROME_PATH` names one). If it cannot start, say so in one line and carry on with your usual browser; the work does not depend on Ovis.
