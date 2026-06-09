import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AuditEntry, AuditPage as AuditPageData } from "../api/types";
import { Loading, PageHead } from "../components/ui";

const ACTION_BADGE: Record<string, string> = {
  created: "green",
  published: "green",
  updated: "blue",
  shared: "blue",
  deleted: "red",
  unshared: "amber",
  maintenance: "amber",
};

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [data, setData] = useState<AuditPageData | null>(null);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load(reset: boolean) {
    setLoading(true);
    const off = reset ? 0 : offset;
    const params = new URLSearchParams({ limit: "50", offset: String(off) });
    if (q) params.set("q", q);
    if (action) params.set("action", action);
    if (entityType) params.set("entity_type", entityType);
    const res = await api<AuditPageData>(`/api/audit?${params}`);
    setData(res);
    setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    setOffset(off + res.items.length);
    setLoading(false);
  }

  // Reload on filter change (debounced for search).
  useEffect(() => {
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, action, entityType]);

  return (
    <div>
      <PageHead
        title="Audit Log"
        subtitle="Every action recorded across the platform."
      />

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input placeholder="Search descriptions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Entity</label>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">All</option>
              {(data?.entity_types ?? []).map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading && items.length === 0 ? (
          <Loading />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="muted whitespace-nowrap text-sm">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="font-medium">{e.actor_name ?? "System"}</td>
                    <td>
                      <span className={`badge ${ACTION_BADGE[e.action] ?? ""}`}>{e.action}</span>
                    </td>
                    <td><span className="badge">{e.entity_type}</span></td>
                    <td>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 && <p className="muted py-4 text-center">No matching activity.</p>}
            {data?.has_more && (
              <div className="mt-3 text-center">
                <button className="btn" onClick={() => load(false)} disabled={loading}>
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
