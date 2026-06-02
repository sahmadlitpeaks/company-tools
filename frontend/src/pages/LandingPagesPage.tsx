import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import { useFetch } from "../hooks/useApi";
import type { LandingLead } from "../api/types";
import { parseBlocks } from "../landing/blocks";
import { BlockList } from "../landing/BlockRenderer";
import {
  ConfirmModal,
  Empty,
  ListSkeleton,
  Loading,
  Modal,
  PageHead,
  PromptModal,
  useToast,
} from "../components/ui";

function LeadsModal({ page, onClose }: { page: LandingPage; onClose: () => void }) {
  const { data, loading } = useFetch<LandingLead[]>(
    `/api/landing-pages/${page.id}/leads`,
  );
  return (
    <Modal title={`Leads — ${page.title}`} maxWidth={720} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No leads captured yet. Add a Lead form block and publish the page." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Message</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 600 }}>{l.name ?? "—"}</td>
                <td>
                  <div>{l.email}</div>
                  <div className="muted">{l.phone}</div>
                </td>
                <td className="muted">{l.message ?? "—"}</td>
                <td className="muted">{new Date(l.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export default function LandingPagesPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<LandingPage[]>("/api/landing-pages");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<LandingPage | null>(null);
  const [previewing, setPreviewing] = useState<LandingPage | null>(null);
  const [leadsFor, setLeadsFor] = useState<LandingPage | null>(null);

  async function create(title: string) {
    const page = await api<LandingPage>("/api/landing-pages", {
      method: "POST",
      body: { title, status: "draft", blocks: "[]" },
    });
    navigate(`/landing-pages/${page.id}/edit`);
  }

  async function remove(p: LandingPage) {
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
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New page
          </button>
        }
      />
      {loading ? (
        <ListSkeleton rows={4} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="🖥"
          message="No landing pages yet"
          hint="Create a page to open the block builder."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New page
            </button>
          }
        />
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
                        onClick={() => setPreviewing(p)}
                      >
                        Preview
                      </button>
                      <button
                        className="btn-sm"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => setLeadsFor(p)}
                      >
                        Leads
                      </button>
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
                        onClick={() => setDeleting(p)}
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

      {creating && (
        <PromptModal
          title="New landing page"
          label="Page title"
          placeholder="e.g. Summer Promo"
          submitLabel="Create & open editor"
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}
      {leadsFor && <LeadsModal page={leadsFor} onClose={() => setLeadsFor(null)} />}
      {previewing && (
        <Modal
          title={`Preview — ${previewing.title}`}
          maxWidth={980}
          onClose={() => setPreviewing(null)}
        >
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {previewing.status === "published" ? (
              <>
                Live at <code>/p/{previewing.slug}</code> ·{" "}
                <a href={`/p/${previewing.slug}`} target="_blank" rel="noreferrer">
                  open in new tab ↗
                </a>
              </>
            ) : (
              <>Draft preview — not publicly visible until published.</>
            )}
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "auto",
              maxHeight: "70vh",
              background: "#fff",
            }}
          >
            {(() => {
              const blocks = parseBlocks(previewing.blocks);
              if (blocks.length > 0) return <BlockList blocks={blocks} />;
              if (previewing.html)
                return <div dangerouslySetInnerHTML={{ __html: previewing.html }} />;
              return (
                <div className="empty">This page has no content yet.</div>
              );
            })()}
          </div>
        </Modal>
      )}
      {deleting && (
        <ConfirmModal
          title="Delete landing page"
          message={`Delete "${deleting.title}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
