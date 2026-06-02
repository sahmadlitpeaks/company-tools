import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "../components/ui";

export default function LandingPagesPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<LandingPage[]>("/api/landing-pages");
  const [creating, setCreating] = useState(false);

  async function create() {
    const title = prompt("Landing page title");
    if (!title) return;
    setCreating(true);
    try {
      const page = await api<LandingPage>("/api/landing-pages", {
        method: "POST",
        body: { title, status: "draft", blocks: "[]" },
      });
      navigate(`/landing-pages/${page.id}/edit`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setCreating(false);
    }
  }

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
        subtitle="Build marketing pages with the block editor, published at /p/{slug}."
        action={
          <button className="btn-primary" onClick={create} disabled={creating}>
            + New page
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No landing pages yet. Create one to open the builder." />
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
                        onClick={() => navigate(`/landing-pages/${p.id}/edit`)}
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
    </div>
  );
}
