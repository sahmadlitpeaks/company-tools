import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Two small pieces of installed-app plumbing:
 *
 * - an update bar when a new build is waiting. It asks rather than reloading on
 *   its own — someone half way through a checklist round or an expense claim
 *   must not have the page swapped under them.
 * - an offline bar, because with a service worker the app keeps rendering from
 *   cache and would otherwise look like it's simply showing stale truth.
 */
export default function PwaStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline && !needRefresh) return null;

  return (
    <div className="pwa-bar-wrap">
      {offline && (
        <div className="pwa-bar offline" role="status">
          <CloudOff size={15} />
          <span>You're offline — showing the last data loaded. Changes won't save.</span>
        </div>
      )}
      {needRefresh && (
        <div className="pwa-bar" role="status">
          <RefreshCw size={15} />
          <span>A new version is ready.</span>
          <button className="btn-sm" onClick={() => updateServiceWorker(true)}>
            Reload
          </button>
          <button className="btn-sm" onClick={() => setNeedRefresh(false)}>
            Later
          </button>
        </div>
      )}
    </div>
  );
}
