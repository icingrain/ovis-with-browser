import { useEffect, useRef, useState } from "react";
import type { BrowserSession } from "../../shared/protocol.ts";

/**
 * The Browser session registered for the selected pane (server/browser-sessions.ts), polled while
 * a local pane is selected. `browserSessionGoneRef` is called when the session disappears so the
 * pane falls back from its Browser lens.
 */
export function useBrowserSession({ selectedPaneId, selectedMachineId }: { selectedPaneId: string | null; selectedMachineId: string }) {
  const [browserSession, setBrowserSession] = useState<BrowserSession | null>(null);
  const browserSessionGoneRef = useRef<(paneId: string) => void>(() => {});
  useEffect(() => {
    if (!selectedPaneId || selectedMachineId !== "local") { setBrowserSession(null); return; }
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/pane/browser?pane_id=${encodeURIComponent(selectedPaneId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("browser session");
        const body = await response.json() as { session: BrowserSession | null };
        if (alive) {
          setBrowserSession(body.session);
          if (!body.session) browserSessionGoneRef.current(selectedPaneId);
        }
      } catch { if (alive) setBrowserSession(null); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [selectedPaneId, selectedMachineId]);
  return { browserSession, setBrowserSession, browserSessionGoneRef };
}
