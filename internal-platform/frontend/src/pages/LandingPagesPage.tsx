import { useState } from "react";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  Loading,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";

const STARTER_HTML = `<section style="font-family:Arial;text-align:center;padding:60px 20px;background:#0b5cab;color:#fff">
  <h1>Your headline here</h1>
  <p>A short, compelling subheading for the campaign.</p>
  <a href="#" style="display:inline-block;margin-top:16px;background:#fff;color:#0b5cab;padding:12px 26px;border-radius:8px;font-weight:700;text-decoration:none">Get started</a>
</section>`;

function PageForm({
  page,
  onClose,
  onSaved,
}: {
  page?: LandingPage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    title: page?.title ?? "",
    description: page?.description ?? "",
    html: page?.html ?? STARTER_HTML,
    status: page?.status ?? "draft",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (page) {
        await api(`/api/landing-pages/${page.id}`, { method: "PATCH", body: form });
      } else {
        await api("/api/landing-pages", { method: "POST", body: form });
      }
      notify("Saved.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <Modal title={page ? "Edit landing page" : "New landing page"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="field">
          <label>HTML content</label>
          <textarea
            rows={8}
            style={{ fontFamily: "monospace", fontSize: 12 }}
            value={form.html}
            onChange={(e) => set("html", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>
            Save page
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function LandingPagesPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<LandingPage[]>("/api/landing-pages");
  const [editing, setEditing] = useState<LandingPage | null>(null);
  const [creating, setCreating] = useState(false);

  async function remove(p: LandingPage) {
    if (!confirm(`Delete "${p.title}"?`)) return;
    await api(`/api/landing-pages/${p.id}`, { method: "DELETE" });
    notify("Deleted.");
    reload();
  }

  return (
    <div>
      <PageHead
        title="Landing Pages"
        subtitle="Lightweight marketing pages published at /p/{slug}."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New page
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No landing pages yet." />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Views</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td>
                    <code>/p/{p.slug}</code>
                  </td>
                  <td>
                    <span className={`badge ${p.status === "published" ? "green" : ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p.view_count}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {p.status === "published" && (
                        <a
                          className="btn-sm"
                          style={{ flex: "0 0 auto" }}
                          href={`/p/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      )}
                      <button
                        className="btn-sm"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-sm btn-danger"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => remove(p)}
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
      {creating && <PageForm onClose={() => setCreating(false)} onSaved={reload} />}
      {editing && (
        <PageForm page={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </div>
  );
}
