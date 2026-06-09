import { useState } from "react";
import {
  BookOpen,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  KeyRound,
  Lock,
  QrCode,
  UserPlus,
} from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { SharedDoc } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ErrorState,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";

export default function SharedPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useFetch<SharedDoc[]>("/api/shares");
  const [qr, setQr] = useState<SharedDoc | null>(null);

  const totalOpens = data?.reduce((s, d) => s + d.opens, 0) ?? 0;
  const totalDownloads = data?.reduce((s, d) => s + d.downloads, 0) ?? 0;

  async function revoke(d: SharedDoc) {
    const path =
      d.kind === "brochure"
        ? `/api/products/brochures/${d.id}/unshare`
        : `/api/assets/${d.id}/unshare`;
    await api(path, { method: "POST" });
    notify("Link revoked — now private.");
    reload();
  }

  function copy(url: string) {
    navigator.clipboard?.writeText(url);
    notify("Public link copied.");
  }

  return (
    <div>
      <PageHead
        title="Shared with clients"
        subtitle="Every brochure and asset you've published, with live open analytics."
      />

      {!loading && !error && (data?.length ?? 0) > 0 && (
        <div className="grid cols-3 mb-4">
          <div className="card stat">
            <div className="value">{data!.length}</div>
            <div className="label">Active shares</div>
          </div>
          <div className="card stat">
            <div className="value">{totalOpens}</div>
            <div className="label">Total opens</div>
          </div>
          <div className="card stat">
            <div className="value">{totalDownloads}</div>
            <div className="label">Total downloads</div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (data?.length ?? 0) === 0 ? (
          <Empty
            icon={<ExternalLink size={28} />}
            message="Nothing shared yet"
            hint="Use the Share button on a brochure or marketing asset to publish it."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Controls</th>
                <th>Opens</th>
                <th>Downloads</th>
                <th>Last opened</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data!.map((d) => (
                <tr key={`${d.kind}-${d.id}`}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand-50 text-brand-600">
                        {d.kind === "brochure" ? (
                          <BookOpen size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{d.title}</div>
                        <code className="text-xs text-ink-muted">/s/{d.share_code}</code>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {d.expires_at && (
                        <span
                          className="badge amber inline-flex items-center gap-1"
                          title={`Expires ${new Date(d.expires_at).toLocaleString()}`}
                        >
                          <Clock size={11} /> Expires
                        </span>
                      )}
                      {d.has_passcode && (
                        <span className="badge blue inline-flex items-center gap-1">
                          <KeyRound size={11} /> Passcode
                        </span>
                      )}
                      {d.require_lead && (
                        <span className="badge inline-flex items-center gap-1">
                          <UserPlus size={11} /> Lead gate
                        </span>
                      )}
                      {!d.expires_at && !d.has_passcode && !d.require_lead && (
                        <span className="muted text-xs">Open link</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge blue inline-flex items-center gap-1">
                      <Eye size={11} /> {d.opens}
                    </span>
                  </td>
                  <td>
                    <span className="badge">{d.downloads}</span>
                  </td>
                  <td className="muted text-sm">
                    {d.last_opened
                      ? new Date(d.last_opened).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        className="btn-sm"
                        title="QR code"
                        onClick={() => setQr(d)}
                      >
                        <QrCode size={14} />
                      </button>
                      <button
                        className="btn-sm"
                        title="Copy link"
                        onClick={() => copy(d.share_url)}
                      >
                        <Copy size={14} />
                      </button>
                      <a
                        className="btn-sm"
                        title="Open public page"
                        href={d.public_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        className="btn-sm btn-danger inline-flex items-center gap-1"
                        onClick={() => revoke(d)}
                      >
                        <Lock size={14} /> Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {qr && (
        <Modal title={`QR — ${qr.title}`} onClose={() => setQr(null)} maxWidth={360}>
          <div className="text-center">
            <img
              src={apiUrl(
                `/api/public/qr.png?data=${encodeURIComponent(qr.share_url)}`,
              )}
              alt="QR code"
              width={220}
              height={220}
              className="mx-auto rounded-xl border border-border bg-white p-2"
            />
            <code className="mt-3 block text-sm">{qr.share_url}</code>
            <button className="btn mt-3" onClick={() => copy(qr.share_url)}>
              Copy link
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
