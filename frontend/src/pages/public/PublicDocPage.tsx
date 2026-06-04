import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, FileText, KeyRound, Loader2, Lock } from "lucide-react";
import { api, apiUrl, downloadFile } from "../../api/client";
import type { PublicDocMeta } from "../../api/types";

const FlipbookModal = lazy(() => import("../../components/FlipbookModal"));

/**
 * No-login viewer reached from a shared short link (/b/:id brochures,
 * /a/:id assets). Applies the share's brand skin and any passcode / lead gate,
 * then opens PDFs as a flipbook and previews images/video inline.
 */
export default function PublicDocPage({ base }: { base: "brochures" | "assets" }) {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<PublicDocMeta | null>(null);
  const [error, setError] = useState(false);
  // `query` is appended to the download URL once the gate is satisfied.
  const [query, setQuery] = useState<string | null>(null);

  useEffect(() => {
    api<PublicDocMeta>(`/api/public/${base}/${id}/meta`, { auth: false })
      .then((m) => {
        setMeta(m);
        if (!m.requires_passcode && !m.requires_lead) setQuery("");
      })
      .catch(() => setError(true));
  }, [base, id]);

  const brand = meta?.brand;
  const accent = brand?.primary_color ?? "#0b5cab";

  if (error)
    return (
      <Shell accent={accent} brand={brand}>
        <h2>Document unavailable</h2>
        <p className="muted">
          This link is no longer active or the document isn't shared publicly.
        </p>
      </Shell>
    );

  if (!meta)
    return (
      <div className="center-screen">
        <Loader2 className="animate-spin text-ink-muted" size={28} />
      </div>
    );

  // Gate: collect passcode and/or lead details before unlocking.
  if (query === null)
    return (
      <Shell accent={accent} brand={brand}>
        <GateForm
          base={base}
          id={id!}
          meta={meta}
          onUnlock={(q) => setQuery(q)}
        />
      </Shell>
    );

  const url = `/api/public/${base}/${id}/download${query}`;
  const ct = meta.content_type ?? "";
  const isPdf = ct === "application/pdf" || meta.title.toLowerCase().endsWith(".pdf");
  const isImage = ct.startsWith("image/");
  const isVideo = ct.startsWith("video/");

  if (isPdf)
    return (
      <Suspense
        fallback={
          <div className="center-screen">
            <Loader2 className="animate-spin text-ink-muted" size={28} />
          </div>
        }
      >
        <FlipbookModal
          url={url}
          name={meta.title}
          auth={false}
          brandName={brand?.name}
          brandLogo={brand?.logo_url}
        />
      </Suspense>
    );

  if (isImage)
    return (
      <Shell accent={accent} brand={brand} wide>
        <img src={apiUrl(url)} alt={meta.title} className="mx-auto max-h-[70vh] rounded-xl" />
        <DownloadBtn url={url} name={meta.title} accent={accent} />
      </Shell>
    );

  if (isVideo)
    return (
      <Shell accent={accent} brand={brand} wide>
        <video src={apiUrl(url)} controls className="mx-auto max-h-[70vh] w-full rounded-xl" />
        <DownloadBtn url={url} name={meta.title} accent={accent} />
      </Shell>
    );

  return (
    <Shell accent={accent} brand={brand}>
      <FileText className="mx-auto mb-3" size={40} style={{ color: accent }} />
      <h2 className="mb-1">{meta.title}</h2>
      <p className="muted mb-4">Shared with you.</p>
      <DownloadBtn url={url} name={meta.title} accent={accent} />
    </Shell>
  );
}

function Shell({
  children,
  accent,
  brand,
  wide,
}: {
  children: React.ReactNode;
  accent: string;
  brand?: PublicDocMeta["brand"];
  wide?: boolean;
}) {
  return (
    <div className="center-screen" style={{ background: `${accent}0d` }}>
      <div
        className="login-card text-center"
        style={{ maxWidth: wide ? 720 : undefined, borderTop: `4px solid ${accent}` }}
      >
        {brand &&
          (brand.logo_url ? (
            <img src={brand.logo_url} alt={brand.name} className="mx-auto mb-4 h-9" />
          ) : (
            <div className="mb-3 text-lg font-bold" style={{ color: accent }}>
              {brand.name}
            </div>
          ))}
        {children}
        {brand?.website && (
          <a
            href={brand.website}
            target="_blank"
            rel="noreferrer"
            className="muted mt-4 block text-xs"
          >
            {brand.website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>
    </div>
  );
}

function DownloadBtn({
  url,
  name,
  accent,
}: {
  url: string;
  name: string;
  accent: string;
}) {
  return (
    <button
      className="btn-primary mx-auto inline-flex items-center gap-2"
      style={{ background: accent }}
      onClick={() => downloadFile(url, name)}
    >
      <Download size={16} /> Download
    </button>
  );
}

function GateForm({
  base,
  id,
  meta,
  onUnlock,
}: {
  base: "brochures" | "assets";
  id: string;
  meta: PublicDocMeta;
  onUnlock: (query: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    passcode: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (meta.requires_passcode) params.set("passcode", form.passcode);
      if (meta.requires_lead) {
        const lead = await api<{ id: string }>(`/api/public/${base}/${id}/lead`, {
          method: "POST",
          auth: false,
          body: { name: form.name, email: form.email, phone: form.phone },
        });
        params.set("lead", lead.id);
      }
      // Validate access (passcode/lead) without side effects before unlocking.
      await api(`/api/public/${base}/${id}/check?${params.toString()}`, {
        auth: false,
      });
      onUnlock(`?${params.toString()}`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setErr(
        status === 401
          ? "That passcode is incorrect."
          : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="text-left">
      <div className="mb-4 text-center">
        <Lock className="mx-auto mb-2 text-ink-muted" size={28} />
        <h2 className="mb-1">{meta.title}</h2>
        <p className="muted text-sm">
          {meta.requires_lead
            ? "Tell us where to send it and you'll get instant access."
            : "Enter the passcode to view this document."}
        </p>
      </div>

      {meta.requires_lead && (
        <>
          <div className="field">
            <input
              placeholder="Your name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="field">
            <input
              type="email"
              required
              placeholder="Email address"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div className="field">
            <input
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
        </>
      )}

      {meta.requires_passcode && (
        <div className="field">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <KeyRound size={14} /> Passcode
          </label>
          <input
            required
            value={form.passcode}
            onChange={(e) => set("passcode", e.target.value)}
          />
        </div>
      )}

      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Unlocking…" : "View document"}
      </button>
    </form>
  );
}
