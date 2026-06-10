import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  Boxes,
  CalendarClock,
  Check,
  Cloud,
  FileDown,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  UserMinus,
  UserPlus,
  Wallet,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  AccessGrant,
  AssignedAsset,
  Brand,
  HrDocument,
  Journey,
  JourneyDetail,
  JourneyTask,
  ProvisionSuggestion,
  ProvisionSuggestions,
  User,
} from "../api/types";
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
  const { notify } = useToast();
  const journeys = useFetch<Journey[]>("/api/people/journeys");
  const expiring = useFetch<HrDocument[]>("/api/hr-documents/expiring?days=60");
  const [start, setStart] = useState<"onboarding" | "offboarding" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function remindExpiring() {
    try {
      const res = await api<{ reminders_sent: number }>(
        "/api/hr-documents/expiring/notify?days=60",
        { method: "POST" },
      );
      notify(`Sent ${res.reminders_sent} document reminder(s).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

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

      {(expiring.data?.length ?? 0) > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--amber-300, #fcd34d)" }}>
          <div className="spread mb-2">
            <h4 className="m-0 inline-flex items-center gap-2">
              <CalendarClock size={16} /> Documents expiring soon ({expiring.data!.length})
            </h4>
            <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={remindExpiring}>
              <BellRing size={13} /> Remind HR
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {expiring.data!.slice(0, 8).map((d) => {
              const expired = d.days_to_expiry != null && d.days_to_expiry < 0;
              return (
                <Link
                  key={d.id}
                  to={`/people/${d.user_id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-slate-50"
                >
                  <span><span className="badge mr-1">{d.category.replace("_", " ")}</span>{d.title} · {d.user_name}</span>
                  <span className={expired ? "text-rose-600" : "text-amber-600"}>
                    {expired ? "expired " : "expires "}{d.expiry_date}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        {journeys.loading ? (
          <Loading />
        ) : (journeys.data?.length ?? 0) === 0 ? (
          <Empty icon="🧭" message="No journeys yet" hint="Start an onboarding or offboarding above." />
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
            {journeys.data!.map((j) => {
              const pct = j.total_tasks ? Math.round((j.done_tasks / j.total_tasks) * 100) : 0;
              return (
                <button
                  key={j.id}
                  onClick={() => setOpenId(j.id)}
                  className="flex flex-col rounded-xl border border-slate-200 p-4 text-left transition hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <span className="org-avatar !h-11 !w-11 !text-sm" style={{ background: colorFor(j.target_name ?? j.id) }}>
                      {jInitials(j.target_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{j.target_name ?? "—"}</div>
                      <div className="mt-0.5 flex gap-1">
                        <span className={`badge ${j.kind === "onboarding" ? "green" : "amber"}`}>{j.kind}</span>
                        <span className={`badge ${STATUS_BADGE[j.status] ?? ""}`}>{j.status.replace("_", " ")}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--brand-600)" }} />
                    </div>
                    <span className="muted text-xs">{j.done_tasks}/{j.total_tasks}</span>
                  </div>
                  <div className="muted mt-2 text-xs">Started {new Date(j.created_at).toLocaleDateString()}</div>
                </button>
              );
            })}
          </div>
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

const ORG_COLORS = [
  "#0ea5e9", "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ORG_COLORS[h % ORG_COLORS.length];
}
function jInitials(name?: string | null): string {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
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
  const brands = useFetch<Brand[]>("/api/companies");
  // Onboarding is almost always a brand-new person, so default to that.
  const [mode, setMode] = useState<"new" | "existing">(
    kind === "onboarding" ? "new" : "existing",
  );
  const [targetId, setTargetId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(kind === "onboarding");
  const [busy, setBusy] = useState(false);
  const [emp, setEmp] = useState({
    given_name: "",
    surname: "",
    personal_email: "",
    email: "",
    job_title: "",
    department: "",
    mobile_phone: "",
    passport_no: "",
    nationality: "",
  });
  const setE = (k: string, v: string) => setEmp((f) => ({ ...f, [k]: v }));
  const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

  function validateNew(): string | null {
    if (!emp.given_name.trim() || !emp.surname.trim()) return "First and last name are required.";
    if (!emp.personal_email.trim() && !emp.email.trim())
      return "A personal or official email is required.";
    if (emp.personal_email.trim() && !emailOk(emp.personal_email.trim()))
      return "Personal email looks invalid.";
    if (emp.email.trim() && !emailOk(emp.email.trim()))
      return "Official email looks invalid.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let target = targetId;
      if (mode === "new") {
        const err = validateNew();
        if (err) {
          notify(err, "error");
          setBusy(false);
          return;
        }
        const u = await api<User>("/api/users", {
          method: "POST",
          body: {
            given_name: emp.given_name.trim(),
            surname: emp.surname.trim(),
            personal_email: emp.personal_email.trim() || null,
            email: emp.email.trim() || null,
            job_title: emp.job_title.trim() || null,
            department: emp.department.trim() || null,
            mobile_phone: emp.mobile_phone.trim() || null,
            passport_no: emp.passport_no.trim() || null,
            nationality: emp.nationality.trim() || null,
          },
        });
        target = u.id;
      }
      if (!target) {
        notify("Select an employee.", "error");
        setBusy(false);
        return;
      }
      await api("/api/people/journeys", {
        method: "POST",
        body: {
          kind,
          target_user_id: target,
          company_id: brandId || null,
          note: note || null,
          announce,
        },
      });
      notify(`${kind === "onboarding" ? "Onboarding" : "Offboarding"} started.`);
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === "onboarding" ? "Start onboarding" : "Start offboarding"} onClose={onClose} maxWidth={560}>
      <form onSubmit={submit}>
        <div className="field">
          <div className="spread">
            <label className="!mb-0">Employee *</label>
            <button
              type="button"
              className="!border-0 !bg-transparent !p-0 text-xs font-medium text-brand-600"
              onClick={() => setMode((m) => (m === "new" ? "existing" : "new"))}
            >
              {mode === "new" ? "Pick existing employee" : "+ New employee (not in Azure)"}
            </button>
          </div>

          {mode === "existing" ? (
            <select className="mt-1.5" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Select employee…</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email ?? u.personal_email}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1.5 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="row">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>First name *</label>
                  <input value={emp.given_name} onChange={(e) => setE("given_name", e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Last name *</label>
                  <input value={emp.surname} onChange={(e) => setE("surname", e.target.value)} />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Personal email *</label>
                  <input type="email" placeholder="name@gmail.com" value={emp.personal_email} onChange={(e) => setE("personal_email", e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Official email <span className="muted">(optional)</span></label>
                  <input type="email" placeholder="not yet assigned" value={emp.email} onChange={(e) => setE("email", e.target.value)} />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Job title</label>
                  <input value={emp.job_title} onChange={(e) => setE("job_title", e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Department</label>
                  <input value={emp.department} onChange={(e) => setE("department", e.target.value)} />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Phone</label>
                  <input value={emp.mobile_phone} onChange={(e) => setE("mobile_phone", e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Nationality</label>
                  <input value={emp.nationality} onChange={(e) => setE("nationality", e.target.value)} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Passport / ID no.</label>
                <input value={emp.passport_no} onChange={(e) => setE("passport_no", e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label>Branch / sub-company</label>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">—</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
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
  const assignable = useFetch<AssignedAsset[]>("/api/people/assignable-assets");
  const [newItem, setNewItem] = useState("");
  const [assetPick, setAssetPick] = useState("");
  const [grant, setGrant] = useState({ name: "", system: "", username: "" });
  const d = detail.data;
  const suggestions = useFetch<ProvisionSuggestions>(
    d?.kind === "onboarding" ? `/api/people/journeys/${id}/suggestions` : null,
  );

  async function provisionSub(s: ProvisionSuggestion) {
    if (!s.ref_id || !d?.target_user_id) return;
    await api(`/api/subscriptions/${s.ref_id}/seats`, {
      method: "POST",
      body: { user_ids: [d.target_user_id] },
    });
    suggestions.reload();
    detail.reload();
    onChanged();
  }
  async function provisionAccess(s: ProvisionSuggestion) {
    await api(`/api/people/journeys/${id}/grants`, {
      method: "POST",
      body: { name: s.label },
    });
    suggestions.reload();
    detail.reload();
    onChanged();
  }

  async function assignAsset() {
    if (!assetPick) return;
    await api(`/api/people/journeys/${id}/assets`, { method: "POST", body: { asset_id: assetPick } });
    setAssetPick("");
    detail.reload();
    assignable.reload();
    onChanged();
  }
  async function returnAsset(a: AssignedAsset) {
    await api(`/api/people/journeys/${id}/assets/${a.id}/return`, { method: "POST" });
    detail.reload();
    assignable.reload();
  }
  async function addGrant() {
    if (!grant.name.trim()) return;
    await api(`/api/people/journeys/${id}/grants`, {
      method: "POST",
      body: { name: grant.name, system: grant.system || null, username: grant.username || null },
    });
    setGrant({ name: "", system: "", username: "" });
    detail.reload();
  }
  async function revokeGrant(g: AccessGrant) {
    await api(`/api/people/grants/${g.id}/revoke`, { method: "POST" });
    detail.reload();
  }
  async function deleteGrant(g: AccessGrant) {
    await api(`/api/people/grants/${g.id}`, { method: "DELETE" });
    detail.reload();
  }
  async function revokeSeat(seatId: string) {
    await api(`/api/subscriptions/seats/${seatId}/revoke`, { method: "POST" });
    detail.reload();
  }

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
  async function syncAzure() {
    if (!d?.target) return;
    try {
      const r = await api<{ temp_password?: string }>(`/api/users/${d.target.id}/sync-azure`, { method: "POST" });
      notify(r.temp_password ? `Created in Azure. Temp password: ${r.temp_password}` : "Synced to Azure.");
      detail.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Azure sync failed", "error");
    }
  }
  async function syncBamboo() {
    if (!d?.target) return;
    try {
      await api(`/api/users/${d.target.id}/sync-bamboo`, { method: "POST" });
      notify("Pushed to BambooHR.");
      detail.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "BambooHR sync failed", "error");
    }
  }

  return (
    <Modal title={d ? `${d.kind} — ${d.target_name ?? ""}` : "Journey"} onClose={onClose} maxWidth={640}>
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="spread mb-3">
            <div className="muted text-sm">
              {d.company_name && <>Branch: <strong>{d.company_name}</strong> · </>}
              <span className={`badge ${d.kind === "onboarding" ? "green" : "amber"}`}>{d.kind}</span>
            </div>
            <button
              className="btn-sm inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={() => downloadFile(`/api/people/journeys/${id}/report.pdf`, `${d.kind}-record.pdf`)}
            >
              <FileDown size={14} /> PDF record
            </button>
          </div>

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
              {user?.is_admin && d.kind === "onboarding" && (
                <div className="row mt-2" style={{ gap: 6 }}>
                  <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={syncAzure}>
                    <Cloud size={13} /> {d.target.email ? "Sync to Azure" : "Azure (needs official email)"}
                  </button>
                  <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={syncBamboo}>
                    <Cloud size={13} /> Push to BambooHR
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Equipment (linked to the Asset Tracker) */}
          <div className="mb-4">
            <h4 className="mb-2 inline-flex items-center gap-1.5">
              <Boxes size={15} /> Equipment
            </h4>
            {d.assigned_assets.length === 0 ? (
              <p className="muted text-sm">No equipment assigned.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {d.assigned_assets.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="text-sm font-medium">{a.asset_tag} · {a.name}</span>
                    <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => returnAsset(a)}>
                      <RotateCcw size={12} /> Return
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="row mt-2" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0, flex: 4 }}>
                <select value={assetPick} onChange={(e) => setAssetPick(e.target.value)}>
                  <option value="">Assign an available asset…</option>
                  {(assignable.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.asset_tag} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={assignAsset}>
                <Plus size={14} /> Assign
              </button>
            </div>
          </div>

          {/* Account / system access */}
          <div className="mb-4">
            <h4 className="mb-2 inline-flex items-center gap-1.5">
              <KeyRound size={15} /> Account & system access
            </h4>
            {d.access_grants.length === 0 ? (
              <p className="muted text-sm">No access recorded.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {d.access_grants.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{g.name}</span>
                      {(g.username || g.system) && (
                        <span className="muted"> · {g.username || g.system}</span>
                      )}
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      <span className={`badge ${g.status === "active" ? "green" : ""}`}>{g.status}</span>
                      {g.status === "active" && (
                        <button className="btn-sm btn-danger inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => revokeGrant(g)}>
                          <Lock size={12} /> Revoke
                        </button>
                      )}
                      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => deleteGrant(g)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="row mt-2" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0, flex: 2 }}>
                <input placeholder="Access (e.g. Google Workspace)" value={grant.name} onChange={(e) => setGrant((g) => ({ ...g, name: e.target.value }))} />
              </div>
              <div className="field" style={{ marginBottom: 0, flex: 2 }}>
                <input placeholder="Username / system" value={grant.username} onChange={(e) => setGrant((g) => ({ ...g, username: e.target.value }))} />
              </div>
              <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={addGrant}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* Subscriptions the person is covered by */}
          {d.subscriptions.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 inline-flex items-center gap-1.5">
                <Wallet size={15} /> Subscriptions to review
              </h4>
              <div className="flex flex-col gap-1.5">
                {d.subscriptions.map((s) => (
                  <div
                    key={s.subscription_id + s.source}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{s.name}</span>
                      {s.vendor && <span className="muted"> · {s.vendor}</span>}
                      <span className="muted"> · {s.source === "seat" ? "personal seat" : `${s.source}-wide`}</span>
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      {s.source === "seat" ? (
                        s.seat_status === "active" ? (
                          <button
                            className="btn-sm btn-danger inline-flex items-center gap-1"
                            style={{ flex: "0 0 auto" }}
                            onClick={() => revokeSeat(s.seat_id!)}
                          >
                            <Lock size={12} /> Revoke seat
                          </button>
                        ) : (
                          <span className="badge red">revoked</span>
                        )
                      ) : (
                        <span className="badge">shared</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Onboarding: suggested provisioning from department peers */}
          {d.kind === "onboarding" &&
            ((suggestions.data?.subscriptions.length ?? 0) > 0 ||
              (suggestions.data?.access.length ?? 0) > 0) && (
              <div className="mb-4">
                <h4 className="mb-2 inline-flex items-center gap-1.5">
                  <UserPlus size={15} /> Suggested for {suggestions.data?.department_name ?? "this department"}
                </h4>
                <p className="muted mb-2 text-xs">
                  Commonly held by peers in the same department but not yet provisioned.
                </p>
                <div className="flex flex-col gap-1.5">
                  {suggestions.data!.subscriptions.map((s) => (
                    <div
                      key={`sub-${s.ref_id}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <span className="min-w-0 text-sm">
                        <Wallet size={12} className="mr-1 inline" />
                        <span className="font-medium">{s.label}</span>
                        {s.detail && <span className="muted"> · {s.detail}</span>}
                        <span className="muted"> · {s.peer_count}/{s.peer_total} peers</span>
                      </span>
                      <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => provisionSub(s)}>
                        <Plus size={12} /> Seat
                      </button>
                    </div>
                  ))}
                  {suggestions.data!.access.map((s) => (
                    <div
                      key={`acc-${s.label}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <span className="min-w-0 text-sm">
                        <KeyRound size={12} className="mr-1 inline" />
                        <span className="font-medium">{s.label}</span>
                        <span className="muted"> · {s.peer_count}/{s.peer_total} peers</span>
                      </span>
                      <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => provisionAccess(s)}>
                        <Plus size={12} /> Add access
                      </button>
                    </div>
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
