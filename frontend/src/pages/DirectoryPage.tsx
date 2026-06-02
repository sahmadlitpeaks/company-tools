import { useState } from "react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ErrorBox,
  ListSkeleton,
  PageHead,
  useToast,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";

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
  const { data, loading, error, reload } = useFetch<User[]>(
    `/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );

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
                <th>Phone</th>
                <th></th>
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
                  <td>{u.business_phone ?? u.mobile_phone ?? "—"}</td>
                  <td>{u.is_admin && <span className="badge blue">Admin</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
