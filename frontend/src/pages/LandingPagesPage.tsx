import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import { useFetch } from "../hooks/useApi";
import type { LandingLead } from "../api/types";
import { Monitor, Smartphone } from "lucide-react";
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

function PreviewModal({ page, onClose }: { page: LandingPage; onClose: () => void }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const blocks = parseBlocks(page.blocks);
  return (
    <Modal title={`Preview — ${page.title}`} maxWidth={1040} onClose={onClose}>
      <div className="spread mb-3">
        <div className="muted text-xs">
          {page.status === "published" ? (
            <>
              Live at <code>/p/{page.slug}</code> ·{" "}
              <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
                open in new tab ↗
              </a>
            </>
          ) : (
            <>Draft preview — not publicly visible until published.</>
          )}
        </div>
        <div className="flex flex-none gap-1 rounded-lg border border-[var(--border)] p-0.5">
          <button
            className={`flex items-center gap-1 rounded-md border-0 px-2.5 py-1 text-sm ${device === "desktop" ? "bg-brand-50 text-brand-700" : "bg-transparent"}`}
            onClick={() => setDevice("desktop")}
            aria-label="Desktop preview"
          >
            <Monitor size={15} /> Desktop
          </button>
          <button
            className={`flex items-center gap-1 rounded-md border-0 px-2.5 py-1 text-sm ${device === "mobile" ? "bg-brand-50 text-brand-700" : "bg-transparent"}`}
            onClick={() => setDevice("mobile")}
            aria-label="Mobile preview"
          >
            <Smartphone size={15} /> Mobile
          </button>
        </div>
      </div>
      <div className="grid max-h-[70vh] place-items-start overflow-auto rounded-xl bg-slate-100 p-3">
        <div
          className="mx-auto overflow-hidden rounded-lg bg-white shadow-soft transition-all"
          style={{ width: device === "mobile" ? 390 : "100%" }}
        >
          {blocks.length > 0 ? (
            <BlockList blocks={blocks} />
          ) : page.html ? (
            <div dangerouslySetInnerHTML={{ __html: page.html }} />
          ) : (
            <div className="empty">This page has no content yet.</div>
          )}
        </div>
      </div>
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
        <PreviewModal page={previewing} onClose={() => setPreviewing(null)} />
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
