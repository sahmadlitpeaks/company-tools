import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, FileText, Loader2 } from "lucide-react";
import { api, downloadFile } from "../../api/client";
import type { PublicDocMeta } from "../../api/types";

const FlipbookModal = lazy(() => import("../../components/FlipbookModal"));

/**
 * No-login viewer reached from a shared short link (/b/:id brochures, /a/:id
 * marketing assets). PDFs open as a flipbook; anything else offers a download.
 */
export default function PublicDocPage({ base }: { base: "brochures" | "assets" }) {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<PublicDocMeta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<PublicDocMeta>(`/api/public/${base}/${id}/meta`, { auth: false })
      .then(setMeta)
      .catch(() => setError(true));
  }, [base, id]);

  if (error)
    return (
      <div className="center-screen">
        <div className="login-card text-center">
          <h2>Document unavailable</h2>
          <p className="muted">
            This link is no longer active or the document isn't shared publicly.
          </p>
        </div>
      </div>
    );

  if (!meta)
    return (
      <div className="center-screen">
        <Loader2 className="animate-spin text-ink-muted" size={28} />
      </div>
    );

  const url = `/api/public/${base}/${id}/download`;
  const isPdf =
    meta.content_type === "application/pdf" ||
    meta.title.toLowerCase().endsWith(".pdf");

  if (!isPdf)
    return (
      <div className="center-screen">
        <div className="login-card text-center">
          <FileText className="mx-auto mb-3 text-brand-600" size={40} />
          <h2 className="mb-1">{meta.title}</h2>
          <p className="muted mb-4">Shared with you by the AG Holding team.</p>
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => downloadFile(url, meta.title)}
          >
            <Download size={16} /> Download
          </button>
        </div>
      </div>
    );

  return (
    <Suspense
      fallback={
        <div className="center-screen">
          <Loader2 className="animate-spin text-ink-muted" size={28} />
        </div>
      }
    >
      <FlipbookModal url={url} name={meta.title} auth={false} />
    </Suspense>
  );
}
