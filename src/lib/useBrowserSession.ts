import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSession } from "../../shared/protocol.ts";

/**
 * The Browser session registered for the selected pane (server/browser-sessions.ts), polled while
 * a local pane is selected. `browserSessionGone` (stable) forgets the selected pane's session and
 * calls `onGone`, the latest one passed, so the pane falls back from its Browser lens.
 */
export function useBrowserSession({ selectedPaneId, selectedMachineId, onGone }: { selectedPaneId: string | null; selectedMachineId: string; onGone: (paneId: string) => void }) {
  const [browserSession, setBrowserSession] = useState<BrowserSession | null>(null);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const browserSessionGone = useCallback((paneId: string) => {
    if (selectedMachineId === "local" && selectedPaneId === paneId) setBrowserSession(null);
    goneRef.current(paneId);
  }, [selectedMachineId, selectedPaneId]);
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
          if (!body.session) browserSessionGone(selectedPaneId);
        }
      } catch { if (alive) setBrowserSession(null); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [selectedPaneId, selectedMachineId, browserSessionGone]);
  return { browserSession, browserSessionGone };
}
