import { useEffect, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmModal, useToast } from "./ui";

interface DemoStatus {
  seeded: boolean;
  records: number;
  allowed: boolean;
  environment: string;
}

/** Admin-only sample-data loader (blocked on production).
 *
 * `variant="banner"` renders the dashed dashboard banner; `variant="card"`
 * renders a settings-page card so the same controls live in both places. */
export default function DemoDataCard({ variant = "banner" }: { variant?: "banner" | "card" }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"load" | "clear" | null>(null);

  async function load() {
    try {
      setStatus(await api<DemoStatus>("/api/demo/status"));
    } catch {
      setStatus(null);
    }
  }
  useEffect(() => {
    if (user?.is_admin) void load();
  }, [user]);

  if (!user?.is_admin || !status) return null;

  async function run(action: "seed" | "clear") {
    setBusy(true);
    try {
      const r = await api<{ records?: number; removed?: number }>(`/api/demo/${action}`, { method: "POST" });
      notify(action === "seed" ? `Loaded ${r.records} demo records.` : `Removed ${r.removed} demo records.`);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const detail = !status.allowed
    ? `Disabled on this environment (${status.environment}) for safety.`
    : status.seeded
      ? `${status.records} sample records loaded across all modules.`
      : "Populate every screen with realistic sample data to explore the app.";

  const buttons = status.allowed && (
    status.seeded ? (
      <button className="btn btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => setConfirm("clear")}>
        <Trash2 size={15} /> Remove demo data
      </button>
    ) : (
      <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => setConfirm("load")}>
        <Database size={15} /> Load demo data
      </button>
    )
  );

  const modals = (
    <>
      {confirm === "load" && (
        <ConfirmModal
          title="Load demo data?"
          message="This adds sample users, brands, assets, leads, cards, tickets, onboarding journeys and more across every screen so you can see how it looks. It's clearly tagged and can be removed in one click. Don't use this on production."
          confirmLabel="Load sample data"
          onConfirm={() => run("seed")}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "clear" && (
        <ConfirmModal
          title="Remove demo data?"
          message="This deletes only the records that were created by the demo loader. Your real data is untouched."
          confirmLabel="Remove"
          danger
          onConfirm={() => run("clear")}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );

  if (variant === "card") {
    return (
      <div className="card">
        <div className="spread mb-3">
          <h3 className="m-0 flex items-center gap-2">
            <span className="text-xl">🧪</span> Demo / sample data
          </h3>
          <span className={`badge ${!status.allowed ? "amber" : status.seeded ? "green" : ""}`}>
            {!status.allowed ? "Disabled" : status.seeded ? "Loaded" : "Not loaded"}
          </span>
        </div>
        <p className="muted mt-0 text-sm">{detail}</p>
        {buttons}
        {modals}
      </div>
    );
  }

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3.5"
      style={{ background: "var(--surface-2)", border: "1px dashed var(--border-strong)" }}
    >
      <Database size={18} className="text-brand-600" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Demo / sample data</div>
        <div className="muted text-xs">{detail}</div>
      </div>
      {buttons}
      {modals}
    </div>
  );
}
