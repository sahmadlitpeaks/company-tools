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

/** Admin-only sample-data loader for the dashboard (blocked on production). */
export default function DemoDataCard() {
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

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3.5"
      style={{ background: "var(--surface-2)", border: "1px dashed var(--border-strong)" }}
    >
      <Database size={18} className="text-brand-600" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Demo / sample data</div>
        <div className="muted text-xs">
          {!status.allowed
            ? `Disabled on this environment (${status.environment}) for safety.`
            : status.seeded
              ? `${status.records} sample records loaded across all modules.`
              : "Populate every module with realistic sample data to explore the app."}
        </div>
      </div>
      {status.allowed && (
        status.seeded ? (
          <button className="btn btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => setConfirm("clear")}>
            <Trash2 size={15} /> Remove demo data
          </button>
        ) : (
          <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => setConfirm("load")}>
            <Database size={15} /> Load demo data
          </button>
        )
      )}

      {confirm === "load" && (
        <ConfirmModal
          title="Load demo data?"
          message="This adds sample users, brands, assets, leads, tickets and more across the app so you can see how it looks. It's clearly tagged and can be removed in one click. Don't use this on production."
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
    </div>
  );
}
