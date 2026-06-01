import { useState } from "react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ErrorBox,
  Loading,
  PageHead,
  useToast,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";

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
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !data || data.length === 0 ? (
          <Empty message="No employees found. Run a sync to import from Entra ID." />
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
                  <td style={{ fontWeight: 600 }}>{u.display_name ?? "—"}</td>
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
