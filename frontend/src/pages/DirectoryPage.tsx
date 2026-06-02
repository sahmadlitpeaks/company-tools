import { useState } from "react";
import { api } from "../api/client";
import type { User } from "../api/types";
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
  const { data, loading, error, reload } = useFetch<User[]>(
    `/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  const isAdmin = user?.is_admin;

  async function changeRole(u: User, role: string) {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { role } });
      notify(`${u.display_name ?? u.email} is now a ${role}.`);
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
                <th>Title</th>
                <th>Department</th>
                <th>Email</th>
                <th>Role</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="avatar !h-8 !w-8 !text-[11px]">
                        {initials(u.display_name, u.email)}
                      </span>
                      <span className="font-semibold">{u.display_name ?? "—"}</span>
                    </div>
                  </td>
                  <td>{u.job_title ?? "—"}</td>
                  <td>{u.department ?? "—"}</td>
                  <td>{u.email}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="!w-auto !py-1 text-sm"
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className={`badge ${ROLE_BADGE[u.role] ?? ""}`}>{u.role}</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      {u.role === "manager" && (
                        <button className="btn-sm" onClick={() => setManaging(u)}>
                          Brands ({u.managed_brand_ids?.length ?? 0})
                        </button>
                      )}
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
    </div>
  );
}
