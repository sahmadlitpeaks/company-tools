import { useState } from "react";
import { api } from "../api/client";
import type { ModuleCatalogue, User } from "../api/types";
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
  const [role, setRole] = useState(u.role);
  const [status, setStatus] = useState(u.status);
  const [useDefaults, setUseDefaults] = useState(
    u.permissions === null || u.permissions === undefined,
  );
  const [perms, setPerms] = useState<Set<string>>(
    new Set(u.effective_permissions),
  );
  const [busy, setBusy] = useState(false);

  const roleDefaults = new Set(cat?.role_defaults[role] ?? []);
  const shown = useDefaults ? roleDefaults : perms;

  function toggle(key: string) {
    setPerms((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/api/users/${u.id}`, {
        method: "PATCH",
        body: {
          role,
          status,
          permissions: useDefaults ? null : [...perms],
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
      maxWidth={560}
    >
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      {isAdminRole ? (
        <p className="muted mt-1 text-sm">
          Admins have full access to every module and settings.
        </p>
      ) : (
        <>
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="!w-auto"
              checked={useDefaults}
              onChange={(e) => setUseDefaults(e.target.checked)}
            />
            Use the {role} role's default modules
          </label>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {cat?.modules.map((m) => (
              <label
                key={m.key}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  useDefaults ? "opacity-60" : "hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="!w-auto"
                  disabled={useDefaults}
                  checked={shown.has(m.key)}
                  onChange={() => toggle(m.key)}
                />
                {m.label}
              </label>
            ))}
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
  const [ids, setIds] = useState<string[]>(u.managed_brand_ids ?? []);
  const [busy, setBusy] = useState(false);
  function toggle(id: string) {
    setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/users/${u.id}/brands`, {
        method: "PUT",
        body: { brand_ids: ids },
      });
      notify("Brand access updated.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Brand access — ${u.display_name ?? u.email}`} onClose={onClose}>
      <div className="muted mb-3 text-sm">
        Choose which brands this manager can manage.
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

export default function DirectoryPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [managing, setManaging] = useState<User | null>(null);
  const [editingAccess, setEditingAccess] = useState<User | null>(null);
  const { data, loading, error, reload } = useFetch<User[]>(
    `/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  const isAdmin = user?.is_admin;
  const pendingCount = data?.filter((u) => u.status === "pending").length ?? 0;

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

  return (
    <div>
      <PageHead
        title="Employee Directory"
        subtitle="Synced from Azure Entra ID into the platform database."
        action={
          user?.is_admin && (
            <button className="btn-primary" onClick={sync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync from Entra ID"}
            </button>
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
        <input
          placeholder="Search by name, email, department…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 14 }}
        />
        {loading ? (
          <ListSkeleton rows={6} />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !data || data.length === 0 ? (
          <Empty
            icon="👥"
            message="No employees found"
            hint="Run a sync to import staff from Azure Entra ID."
          />
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
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="avatar !h-8 !w-8 !text-[11px]">
                        {initials(u.display_name, u.email ?? undefined)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold">{u.display_name ?? "—"}</div>
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
                            Brands ({u.managed_brand_ids?.length ?? 0})
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
    </div>
  );
}
