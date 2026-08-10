import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const accent = brand?.primary_color || "var(--primary)";

  if (error)
    return (
      <Shell accent={accent} brand={brand}>
        <h2>Document unavailable</h2>
        <p className="text-muted-foreground">
          This link is no longer active or the document isn't shared publicly.
        </p>
      </Shell>
    );

  if (!meta)
    return (
      <div className="grid min-h-dvh place-items-center bg-muted p-5">
        <Loader2 className="animate-spin text-muted-foreground" size={28} />
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
          <div className="grid min-h-dvh place-items-center bg-muted p-5">
            <Loader2 className="animate-spin text-muted-foreground" size={28} />
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
        <img src={apiUrl(url)} alt={meta.title} className="mx-auto max-h-[70vh]" />
        <DownloadBtn url={url} name={meta.title} />
      </Shell>
    );

  if (isVideo)
    return (
      <Shell accent={accent} brand={brand} wide>
        <video src={apiUrl(url)} controls className="mx-auto max-h-[70vh] w-full" />
        <DownloadBtn url={url} name={meta.title} />
      </Shell>
    );

  return (
    <Shell accent={accent} brand={brand}>
      <FileText className="mx-auto mb-3" size={40} style={{ color: accent }} />
      <h2 className="mb-1">{meta.title}</h2>
      <p className="mb-4 text-muted-foreground">Shared with you.</p>
      <DownloadBtn url={url} name={meta.title} />
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
    <div className="grid min-h-dvh place-items-center bg-muted p-5">
      <Card
        className="w-full text-center"
        style={{ maxWidth: wide ? 720 : 420, borderTop: `4px solid ${accent}` }}
      >
        {brand && (
          <CardHeader>
            {brand.logo_url ? (
              <img src={brand.logo_url} alt={brand.name} className="mx-auto h-9" />
            ) : (
              <CardTitle style={{ color: accent }}>{brand.name}</CardTitle>
            )}
          </CardHeader>
        )}
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
        {brand?.website && (
          <CardFooter className="justify-center">
            <a
              href={brand.website}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground"
            >
              {brand.website.replace(/^https?:\/\//, "")}
            </a>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

function DownloadBtn({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  return (
    <Button type="button"
      className="mx-auto"
      onClick={() => downloadFile(url, name)}
    >
      <Download data-icon="inline-start" /> Download
    </Button>
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={isSubmitting || undefined} className="flex flex-col gap-4 text-left">
      <div className="mb-4 text-center">
        <Lock className="mx-auto mb-2 text-muted-foreground" size={28} />
        <h2 className="mb-1">{meta.title}</h2>
        <p className="text-sm text-muted-foreground">
          {meta.requires_lead
            ? "Tell us where to send it and you'll get instant access."
            : "Enter the passcode to view this document."}
        </p>
      </div>

      <FieldGroup>
      {meta.requires_lead && (
        <>
          <Field><FieldLabel htmlFor="public-doc-name" className="sr-only">Your name</FieldLabel>
            <Input id="public-doc-name" aria-label="Your name"
              placeholder="Your name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            /></Field>
          <Field><FieldLabel htmlFor="public-doc-email" className="sr-only">Email address</FieldLabel>
            <Input id="public-doc-email" aria-label="Email address"
              type="email"
              required
              placeholder="Email address"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            /></Field>
          <Field><FieldLabel htmlFor="public-doc-phone" className="sr-only">Phone</FieldLabel>
            <Input id="public-doc-phone" aria-label="Phone (optional)"
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            /></Field>
        </>
      )}

      {meta.requires_passcode && (
        <Field>
          <FieldLabel htmlFor="public-doc-passcode"><KeyRound /> Passcode</FieldLabel>
          <Input id="public-doc-passcode"
            required
            value={form.passcode}
            onChange={(e) => set("passcode", e.target.value)}
          />
        </Field>
      )}
      </FieldGroup>

      {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Unlocking…" : "View document"}
      </Button>
    </form>
  );
}
