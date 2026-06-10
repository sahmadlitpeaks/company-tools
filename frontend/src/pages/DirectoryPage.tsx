import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, LayoutGrid, List, Upload } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Department, ModuleCatalogue, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ErrorBox,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";

const ROLE_BADGE: Record<string, string> = {
  admin: "blue",
  manager: "amber",
  member: "",
};

const STATUS_BADGE: Record<string, string> = {
  active: "green",
  pending: "amber",
  disabled: "red",
};

function AccessModal({
  u,
  onClose,
  onSaved,
}: {
  u: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { data: cat } = useFetch<ModuleCatalogue>("/api/users/modules");
  const { data: departments } = useFetch<Department[]>("/api/departments");
  const [role, setRole] = useState(u.role);
  const [status, setStatus] = useState(u.status);
  const [deptId, setDeptId] = useState(u.department_id ?? "");
  // What the person should end up with — we derive grant/revoke diffs on save.
  const [desired, setDesired] = useState<Set<string>>(new Set(u.effective_permissions));
  const [busy, setBusy] = useState(false);

  // Base permissions implied by the chosen department (or the role default).
  const dept = departments?.find((d) => d.id === deptId);
  const base = new Set(dept ? dept.permissions : cat?.role_defaults[role] ?? []);

  function toggle(key: string) {
    setDesired((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    try {
      const extra = [...desired].filter((k) => !base.has(k));
      const revoked = [...base].filter((k) => !desired.has(k));
      await api(`/api/users/${u.id}`, {
        method: "PATCH",
        body: {
          role,
          status,
          department_id: deptId || null,
          permissions: null, // department + grants/revokes now drive access
          extra_permissions: extra,
          revoked_permissions: revoked,
        },
      });
      notify("Access updated.");
      onSaved();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
      setBusy(false);
    }
  }

  const isAdminRole = role === "admin";

  return (
    <Modal
      title={`Access — ${u.display_name ?? u.email}`}
      onClose={onClose}
      maxWidth={580}
    >
      <div className="grid grid-cols-3 gap-3">
        <label className="field">
          <span className="mb-1 block text-sm font-medium">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="field">
          <span className="mb-1 block text-sm font-medium">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending approval</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label className="field">
          <span className="mb-1 block text-sm font-medium">Department</span>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)} disabled={isAdminRole}>
            <option value="">None</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isAdminRole ? (
        <p className="muted mt-1 text-sm">
          Admins have full access to every module and settings.
        </p>
      ) : (
        <>
          <p className="muted mt-1 text-sm">
            Base access comes from the {dept ? <strong>{dept.name}</strong> : `${role} role`}.
            Tick to grant extra modules to this person, or untick to revoke.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {cat?.modules.map((m) => {
              const inBase = base.has(m.key);
              const on = desired.has(m.key);
              const tag = on && !inBase ? "granted" : !on && inBase ? "revoked" : null;
              return (
                <label
                  key={m.key}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="!w-auto"
                    checked={on}
                    onChange={() => toggle(m.key)}
                  />
                  <span className="flex-1">{m.label}</span>
                  {tag === "granted" && <span className="badge green">+grant</span>}
                  {tag === "revoked" && <span className="badge red">revoked</span>}
                </label>
              );
            })}
          </div>
        </>
      )}

      <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          style={{ flex: "0 0 auto" }}
          disabled={busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save access"}
        </button>
      </div>
    </Modal>
  );
}

function ManageBrandsModal({
  u,
  onClose,
  onSaved,
}: {
  u: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [ids, setIds] = useState<string[]>(u.managed_company_ids ?? []);
  const [busy, setBusy] = useState(false);
  function toggle(id: string) {
    setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/users/${u.id}/brands`, {
        method: "PUT",
        body: { company_ids: ids },
      });
      notify("Company access updated.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Company access — ${u.display_name ?? u.email}`} onClose={onClose}>
      <div className="muted mb-3 text-sm">
        Choose which companies this manager can manage.
      </div>
      <div className="flex flex-col gap-1">
        {brands.map((b) => (
          <label
            key={b.id}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              className="!w-auto"
              checked={ids.includes(b.id)}
              onChange={() => toggle(b.id)}
            />
            <span
              className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
              style={{ background: b.primary_color }}
            />
            <span className="font-medium">{b.name}</span>
          </label>
        ))}
      </div>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function initials(name?: string | null, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#0ea5e9", "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function PersonAvatar({ u, size = 64 }: { u: User; size?: number }) {
  const seed = u.display_name ?? u.email ?? "?";
  return (
    <span
      className="grid flex-none place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{ height: size, width: size, background: colorFor(seed), fontSize: size * 0.36 }}
    >
      {u.avatar_url ? (
        <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(u.display_name, u.email ?? undefined)
      )}
    </span>
  );
}

export default function DirectoryPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState<User | null>(null);
  const [editingAccess, setEditingAccess] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch<User[]>(
    `/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  const isAdmin = user?.is_admin;
  const pendingCount = data?.filter((u) => u.status === "pending").length ?? 0;
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const departments = [...new Set((data ?? []).map((u) => u.department).filter(Boolean))].sort();
  const filtered = (data ?? []).filter(
    (u) =>
      (!deptFilter || u.department === deptFilter) &&
      (!statusFilter || u.status === statusFilter),
  );

  async function approve(u: User) {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { status: "active" } });
      notify(`${u.display_name ?? u.email} approved.`);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await api<{ synced: number }>("/api/users/sync", {
        method: "POST",
      });
      notify(`Synced ${res.synced} users from Entra ID.`);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>(
        "/api/users/import",
        { method: "POST", form: fd },
      );
      const errs = res.errors.length ? ` (${res.errors.length} issue${res.errors.length > 1 ? "s" : ""})` : "";
      notify(`Imported: ${res.created} new, ${res.updated} updated${errs}.`);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  return (
    <div>
      <input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
      <PageHead
        title="Employee Directory"
        subtitle="Synced from Azure Entra ID into the platform database."
        action={
          user?.is_admin && (
            <div className="flex flex-wrap gap-2">
              <button className="btn inline-flex items-center gap-1.5" onClick={() => downloadFile("/api/users/template.csv", "employees-template.csv").catch(() => notify("Download failed", "error"))}>
                <FileText size={15} /> Template
              </button>
              <button className="btn inline-flex items-center gap-1.5" onClick={() => importRef.current?.click()}>
                <Upload size={15} /> Import
              </button>
              <button className="btn inline-flex items-center gap-1.5" onClick={() => downloadFile("/api/users/export.csv", "employees.csv").catch(() => notify("Export failed", "error"))}>
                <Download size={15} /> Export
              </button>
              <button className="btn" onClick={sync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync from Entra ID"}
              </button>
              <button className="btn-primary" onClick={() => setAdding(true)}>
                Add user
              </button>
            </div>
          )
        }
      />
      {isAdmin && pendingCount > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <strong>{pendingCount}</strong> account{pendingCount > 1 ? "s" : ""} awaiting
          approval. Review and activate them below.
        </div>
      )}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
            <input
              placeholder="Search by name, email, department…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d as string}>{d}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            <button
              className={`px-2.5 py-1.5 ${view === "grid" ? "bg-brand-600 text-white" : "text-ink-muted"}`}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`px-2.5 py-1.5 ${view === "list" ? "bg-brand-600 text-white" : "text-ink-muted"}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <ListSkeleton rows={6} />
        ) : error ? (
          <ErrorBox message={error} />
        ) : filtered.length === 0 ? (
          <Empty
            icon="👥"
            message="No employees found"
            hint="Adjust filters, or run a sync to import staff from Azure Entra ID."
          />
        ) : view === "grid" ? (
          <>
            <div className="muted mb-2 text-xs">{filtered.length} people</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
              {filtered.map((u) => (
                <div key={u.id} className="flex flex-col items-center rounded-xl border border-slate-200 p-4 text-center transition hover:shadow-md">
                  <Link to={`/people/${u.id}`}><PersonAvatar u={u} size={72} /></Link>
                  <Link to={`/people/${u.id}`} className="mt-2 font-semibold leading-tight hover:text-brand-600">
                    {u.display_name ?? "—"}
                  </Link>
                  <div className="muted text-xs">{u.job_title ?? "—"}</div>
                  <div className="muted mt-0.5 text-xs">{u.department ?? "—"}</div>
                  <div className="mt-2 flex flex-wrap justify-center gap-1">
                    <span className={`badge ${STATUS_BADGE[u.status] ?? ""}`}>{u.status}</span>
                    {u.role !== "member" && <span className={`badge ${ROLE_BADGE[u.role] ?? ""}`}>{u.role}</span>}
                  </div>
                  {u.email && (
                    <a href={`mailto:${u.email}`} className="muted mt-2 truncate text-xs hover:text-brand-600" style={{ maxWidth: "100%" }}>
                      {u.email}
                    </a>
                  )}
                  {isAdmin && (
                    <div className="mt-2 flex flex-wrap justify-center gap-1">
                      {u.status === "pending" && (
                        <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => approve(u)}>Approve</button>
                      )}
                      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setEditingAccess(u)}>Access</button>
                      {u.role === "manager" && (
                        <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setManaging(u)}>Companies</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar u={u} size={32} />
                      <div className="min-w-0">
                        <Link
                          to={`/people/${u.id}`}
                          className="font-semibold hover:text-brand-600 hover:underline"
                        >
                          {u.display_name ?? "—"}
                        </Link>
                        <div className="muted text-xs">{u.job_title ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td>{u.department ?? "—"}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${ROLE_BADGE[u.role] ?? ""}`}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[u.status] ?? ""}`}>
                      {u.status}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {u.status === "pending" && (
                          <button
                            className="btn-sm btn-primary"
                            onClick={() => approve(u)}
                          >
                            Approve
                          </button>
                        )}
                        {u.role === "manager" && (
                          <button className="btn-sm" onClick={() => setManaging(u)}>
                            Brands ({u.managed_company_ids?.length ?? 0})
                          </button>
                        )}
                        <button className="btn-sm" onClick={() => setEditingAccess(u)}>
                          Access
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {managing && (
        <ManageBrandsModal
          u={managing}
          onClose={() => setManaging(null)}
          onSaved={reload}
        />
      )}

      {editingAccess && (
        <AccessModal
          u={editingAccess}
          onClose={() => setEditingAccess(null)}
          onSaved={reload}
        />
      )}

      {adding && (
        <AddUserModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    role: "member",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password && form.password.length < 8) {
      notify("Password must be at least 8 characters.", "error");
      return;
    }
    setBusy(true);
    try {
      await api("/api/users", {
        method: "POST",
        body: {
          display_name: form.display_name.trim(),
          email: form.email.trim().toLowerCase() || null,
          role: form.role,
          status: "active",
          password: form.password || null,
        },
      });
      notify("User added.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Full name *</label>
          <input
            required
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Email *</label>
          <input
            type="email"
            required
            placeholder="person@agholding.net"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={form.role} onChange={(e) => set("role", e.target.value)}>
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="field">
          <label>Initial password</label>
          <input
            type="text"
            placeholder="Set a temporary password (optional)"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
          <p className="muted mt-1 text-xs">
            If set, the user signs in with this and is prompted to change it on first login.
            Leave blank for SSO-only users.
          </p>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
