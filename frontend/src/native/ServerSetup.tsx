import { useState } from "react";
import { ServerCog } from "lucide-react";
import { serverStore } from "../api/client";

/**
 * First-run screen for the native app: which deployment should it talk to?
 *
 * The web build knows its own origin, but a single store binary can't — this
 * platform is deployed per-company on whatever host or IP it happens to sit
 * on. Asking once, and remembering, is what lets the same binary serve every
 * deployment (and survive the platform moving domains later).
 */
export default function ServerSetup({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const raw = value.trim().replace(/\/+$/, "");
    if (!raw) {
      setError("Enter the address your team uses to reach the platform.");
      return;
    }
    const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setBusy(true);
    setError(null);
    try {
      // Prove it's really the platform before storing it, so a typo surfaces
      // here rather than as a wall of failures on the login screen.
      const res = await fetch(`${base}/health`);
      const body = await res.json();
      if (!res.ok || body?.status !== "ok") throw new Error("not the platform");
      serverStore.set(base);
      onDone();
    } catch {
      setError(`Couldn't reach the platform at ${base}. Check the address and your network.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <span
            className="grid h-10 w-10 flex-none place-items-center rounded-xl text-white"
            style={{ background: "var(--brand-600)" }}
          >
            <ServerCog size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2 className="m-0">Connect to your workspace</h2>
            <p className="muted m-0 text-sm">Your IT team will have given you this address.</p>
          </div>
        </div>

        <div className="field mt-4">
          <label htmlFor="server">Server address</label>
          <input
            id="server"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="platform.agholding.net"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <button className="btn-primary w-full" disabled={busy} onClick={connect}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
