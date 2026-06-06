import { useState } from "react";
import {
  Boxes,
  Check,
  Lock,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { api } from "../api/client";
import type { Journey, JourneyDetail, JourneyTask, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const CAT_BADGE: Record<string, string> = {
  access: "red",
  accounts: "blue",
  equipment: "amber",
  hr: "green",
  other: "",
};
const STATUS_BADGE: Record<string, string> = {
  in_progress: "amber",
  completed: "green",
  cancelled: "",
};

export default function PeopleOpsPage() {
  const journeys = useFetch<Journey[]>("/api/people/journeys");
  const [start, setStart] = useState<"onboarding" | "offboarding" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <PageHead
        title="Onboarding & Offboarding"
        subtitle="Run a checklist when someone joins or leaves — access, equipment, accounts and HR."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setStart("offboarding")}>
              <UserMinus size={15} /> Offboard
            </button>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setStart("onboarding")}>
              <UserPlus size={15} /> Onboard
            </button>
          </div>
        }
      />

      <div className="card">
        {journeys.loading ? (
          <Loading />
        ) : (journeys.data?.length ?? 0) === 0 ? (
          <Empty icon="🧭" message="No journeys yet" hint="Start an onboarding or offboarding above." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {journeys.data!.map((j) => (
                <tr key={j.id} className="cursor-pointer" onClick={() => setOpenId(j.id)}>
                  <td className="font-semibold">{j.target_name ?? "—"}</td>
                  <td>
                    <span className={`badge ${j.kind === "onboarding" ? "green" : "amber"}`}>
                      {j.kind}
                    </span>
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <ProgressBar done={j.done_tasks} total={j.total_tasks} />
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[j.status] ?? ""}`}>{j.status.replace("_", " ")}</span></td>
                  <td className="muted text-sm">{new Date(j.created_at).toLocaleDateString()}</td>
                  <td className="text-right font-medium text-brand-600">Open ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {start && (
        <StartModal
          kind={start}
          onClose={() => setStart(null)}
          onSaved={() => {
            journeys.reload();
            setStart(null);
          }}
        />
      )}
      {openId && (
        <JourneyModal id={openId} onClose={() => setOpenId(null)} onChanged={journeys.reload} />
      )}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--brand-600)" }} />
      </div>
      <span className="muted text-xs">{done}/{total}</span>
    </div>
  );
}

function StartModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: "onboarding" | "offboarding";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const users = useFetch<User[]>("/api/users");
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(kind === "onboarding");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    setBusy(true);
    try {
      await api("/api/people/journeys", {
        method: "POST",
        body: { kind, target_user_id: targetId, note: note || null, announce },
      });
      notify(`${kind === "onboarding" ? "Onboarding" : "Offboarding"} started.`);
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === "onboarding" ? "Start onboarding" : "Start offboarding"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Employee *</label>
          <select required value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select employee…</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ?? u.email}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="field flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          Post an announcement to everyone
        </label>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Starting…" : "Start checklist"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JourneyModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<JourneyDetail>(`/api/people/journeys/${id}`);
  const users = useFetch<User[]>("/api/users");
  const [newItem, setNewItem] = useState("");
  const d = detail.data;

  async function toggle(t: JourneyTask) {
    await api(`/api/people/tasks/${t.id}`, {
      method: "PATCH",
      body: { status: t.status === "done" ? "pending" : "done" },
    });
    detail.reload();
    onChanged();
  }
  async function assign(t: JourneyTask, owner_id: string) {
    await api(`/api/people/tasks/${t.id}`, { method: "PATCH", body: { owner_id: owner_id || null } });
    detail.reload();
  }
  async function addItem() {
    if (!newItem.trim()) return;
    await api(`/api/people/journeys/${id}/tasks`, { method: "POST", body: { title: newItem } });
    setNewItem("");
    detail.reload();
    onChanged();
  }
  async function removeItem(t: JourneyTask) {
    await api(`/api/people/tasks/${t.id}`, { method: "DELETE" });
    detail.reload();
    onChanged();
  }
  async function access(action: string) {
    await api(`/api/people/journeys/${id}/access`, { method: "POST", body: { action } });
    notify("Access updated.");
    detail.reload();
  }

  return (
    <Modal title={d ? `${d.kind} — ${d.target_name ?? ""}` : "Journey"} onClose={onClose} maxWidth={640}>
      {!d ? (
        <Loading />
      ) : (
        <>
          {/* Access panel */}
          {d.target && (
            <div className="card mb-4" style={{ padding: 14, background: "var(--surface-2)" }}>
              <div className="spread mb-2">
                <h4 className="m-0">System access</h4>
                <span className={`badge ${d.target.status === "active" ? "green" : "red"}`}>
                  {d.target.status}
                </span>
              </div>
              <div className="muted mb-2 text-xs">
                Role: <strong>{d.target.role}</strong> · {d.target.effective_permissions.length} module(s)
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {d.target.effective_permissions.slice(0, 12).map((p) => (
                  <span key={p} className="badge">{p}</span>
                ))}
              </div>
              {user?.is_admin && (
                <div className="row" style={{ gap: 6 }}>
                  {d.target.status !== "active" ? (
                    <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => access("activate")}>
                      <Check size={13} /> Activate
                    </button>
                  ) : (
                    <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => access("disable")}>
                      <Lock size={13} /> Disable
                    </button>
                  )}
                  <button className="btn-sm btn-danger inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => access("revoke_access")}>
                    <UserMinus size={13} /> Revoke all access
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assigned assets to collect/grant */}
          {d.assigned_assets.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 inline-flex items-center gap-1.5">
                <Boxes size={15} /> Assigned equipment
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {d.assigned_assets.map((a) => (
                  <span key={a.id} className="badge amber">{a.asset_tag} · {a.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Checklist */}
          <div className="spread mb-2">
            <h4 className="m-0">Checklist</h4>
            <span className="muted text-xs">{d.done_tasks}/{d.total_tasks} done</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {d.tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                style={{ background: "var(--surface-2)" }}
              >
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={() => toggle(t)}
                />
                <span className={`flex-1 text-sm ${t.status === "done" ? "muted line-through" : "font-medium"}`}>
                  {t.title}
                </span>
                <span className={`badge ${CAT_BADGE[t.category] ?? ""}`}>{t.category}</span>
                <select
                  className="!w-auto !py-1 text-xs"
                  value={t.owner_id ?? ""}
                  onChange={(e) => assign(t, e.target.value)}
                  title="Owner"
                >
                  <option value="">Unassigned</option>
                  {(users.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name ?? u.email}
                    </option>
                  ))}
                </select>
                <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => removeItem(t)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="row mt-3" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 4 }}>
              <input
                placeholder="Add a checklist item…"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
              />
            </div>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={addItem}>
              <Plus size={14} /> Add
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
