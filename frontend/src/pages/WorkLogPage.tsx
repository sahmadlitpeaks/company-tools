import { useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { WorkLog, WorkLogSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const KINDS = ["ticket", "task", "rnd", "support", "meeting", "admin", "other"];
const KIND_BADGE: Record<string, string> = {
  ticket: "blue",
  rnd: "green",
  support: "amber",
  meeting: "",
  admin: "",
  task: "blue",
  other: "",
};

export function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

export default function WorkLogPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const logs = useFetch<WorkLog[]>(`/api/worklogs?scope=${scope}`);
  const summary = useFetch<WorkLogSummary>(`/api/worklogs/summary?scope=${scope}`);
  const [adding, setAdding] = useState(false);
  const canTeam = user?.is_admin || user?.role === "manager";
  const { notify } = useToast();

  async function remove(l: WorkLog) {
    await api(`/api/worklogs/${l.id}`, { method: "DELETE" });
    notify("Entry deleted.");
    logs.reload();
    summary.reload();
  }

  return (
    <div>
      <PageHead
        title="Work Log"
        subtitle="Capture effort on tickets and tasks — and the R&D/ad-hoc work that usually goes unrecorded."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            {canTeam && (
              <button
                className={`btn ${scope === "team" ? "btn-primary" : ""}`}
                style={{ flex: "0 0 auto" }}
                onClick={() => setScope((s) => (s === "team" ? "mine" : "team"))}
              >
                {scope === "team" ? "Team" : "My log"}
              </button>
            )}
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>
              <Plus size={15} /> Log work
            </button>
          </div>
        }
      />

      <div className="grid cols-4 mb-4">
        <div className="card stat">
          <div className="value">{hm(summary.data?.total_minutes ?? 0)}</div>
          <div className="label">Total logged</div>
        </div>
        <div className="card stat">
          <div className="value">{summary.data?.entries ?? 0}</div>
          <div className="label">Entries</div>
        </div>
        <div className="card stat">
          <div className="value">{hm(summary.data?.by_kind?.rnd ?? 0)}</div>
          <div className="label">R&D / dev</div>
        </div>
        <div className="card stat">
          <div className="value">{hm(summary.data?.by_kind?.ticket ?? 0)}</div>
          <div className="label">On tickets</div>
        </div>
      </div>

      <div className="card">
        {logs.loading ? (
          <Loading />
        ) : (logs.data?.length ?? 0) === 0 ? (
          <Empty icon="⏱" message="Nothing logged yet" hint="Record what you worked on — it takes seconds." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {scope === "team" && <th>Who</th>}
                <th>Type</th>
                <th>What</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.data!.map((l) => (
                <tr key={l.id}>
                  <td className="muted whitespace-nowrap text-sm">{l.work_date}</td>
                  {scope === "team" && <td className="font-medium">{l.user_name}</td>}
                  <td><span className={`badge ${KIND_BADGE[l.kind] ?? ""}`}>{l.kind}</span></td>
                  <td>
                    {l.description}
                    {l.entity_label && (
                      <span className="muted text-xs"> · {l.entity_label}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-semibold">{hm(l.minutes)}</td>
                  <td className="text-right">
                    {(l.user_id === user?.id || user?.is_admin) && (
                      <button className="btn-sm btn-danger" onClick={() => remove(l)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <LogModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            logs.reload();
            summary.reload();
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function LogModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    minutes: "30",
    description: "",
    kind: "rnd",
    work_date: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/worklogs", {
        method: "POST",
        body: {
          minutes: Number(form.minutes) || 0,
          description: form.description,
          kind: form.kind,
          work_date: form.work_date || null,
        },
      });
      notify("Work logged.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Log work" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>What did you work on? *</label>
          <textarea required rows={3} placeholder="e.g. R&D on the new report engine" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label>Type</label>
            <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.work_date} onChange={(e) => set("work_date", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="mb-1 flex items-center gap-1.5"><Clock size={14} /> Minutes</label>
          <input type="number" min="0" value={form.minutes} onChange={(e) => set("minutes", e.target.value)} />
          <div className="mt-2 flex gap-1.5">
            {[15, 30, 60, 120].map((m) => (
              <button key={m} type="button" className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => set("minutes", String(m))}>
                {hm(m)}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Save entry"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
