import { useState } from "react";
import { api, API_BASE_URL } from "../api/client";
import type { ShortLink } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "../components/ui";

export default function ShortenerPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<ShortLink[]>("/api/short-links");
  const [form, setForm] = useState({ target_url: "", code: "", campaign: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/short-links", {
        method: "POST",
        body: {
          target_url: form.target_url,
          code: form.code || undefined,
          campaign: form.campaign || undefined,
        },
      });
      notify("Short link created.");
      setForm({ target_url: "", code: "", campaign: "" });
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  async function remove(id: string) {
    await api(`/api/short-links/${id}`, { method: "DELETE" });
    reload();
  }

  function copy(code: string) {
    void navigator.clipboard.writeText(`${API_BASE_URL}/s/${code}`);
    notify("Short link copied.");
  }

  return (
    <div>
      <PageHead
        title="URL Shortener"
        subtitle="Branded short links with click tracking for campaigns."
      />
      <div className="card" style={{ marginBottom: 18 }}>
        <form onSubmit={create}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 3 }}>
              <label>Destination URL *</label>
              <input
                required
                placeholder="https://agholding.net/landing"
                value={form.target_url}
                onChange={(e) => set("target_url", e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Custom code</label>
              <input
                placeholder="optional"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Campaign</label>
              <input
                placeholder="optional"
                value={form.campaign}
                onChange={(e) => set("campaign", e.target.value)}
              />
            </div>
            <button className="btn-primary" style={{ flex: "0 0 auto" }}>
              Shorten
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No short links yet." />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Short link</th>
                <th>Destination</th>
                <th>Campaign</th>
                <th>Clicks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td>
                    <code>/s/{l.code}</code>
                  </td>
                  <td className="muted" style={{ maxWidth: 320, wordBreak: "break-all" }}>
                    {l.target_url}
                  </td>
                  <td>{l.campaign ? <span className="badge">{l.campaign}</span> : "—"}</td>
                  <td>
                    <span className="badge blue">{l.click_count}</span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn-sm"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => copy(l.code)}
                      >
                        Copy
                      </button>
                      <button
                        className="btn-sm btn-danger"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => remove(l.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
