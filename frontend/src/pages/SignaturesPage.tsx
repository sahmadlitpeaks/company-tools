import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EmailSignature, SignatureTemplate } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ListSkeleton, Modal, PageHead, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import { SIGNATURE_DESIGNS, type SigData } from "../signatures/templates";
import DOMPurify from "dompurify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const FIELDS: { key: keyof SigData; label: string }[] = [
  { key: "full_name", label: "Full name" },
  { key: "title", label: "Title" },
  { key: "department", label: "Department" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
];

function TemplateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ name: "", html: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  return (
    <Modal title="New signature template" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setIsSubmitting(true);
          try {
            await api("/api/signatures/templates", { method: "POST", body: form });
            notify("Template created.");
            onSaved();
            onClose();
          } catch (err) {
            notify(err instanceof Error ? err.message : "Failed", "error");
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="signature-name">Name *</FieldLabel>
          <Input id="signature-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={isSubmitting}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="signature-html">HTML (use {"{{ full_name }}"}, {"{{ title }}"}, …)</FieldLabel>
          <Textarea id="signature-html"
            required
            rows={8}
            className="font-mono text-xs"
            value={form.html}
            onChange={(e) => setForm({ ...form, html: e.target.value })}
            disabled={isSubmitting}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save template"}
          </Button>
        </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}

export default function SignaturesPage() {
  const { user } = useAuth();
  const { active } = useBrand();
  const { notify } = useToast();
  const templates = useFetch<SignatureTemplate[]>("/api/signatures/templates");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // "design:<id>" for built-ins, "custom:<id>" for DB templates.
  const [selected, setSelected] = useState<string>("design:classic");
  const [customResult, setCustomResult] = useState<{ requestKey: string; html: string } | null>(null);
  const [customRenderError, setCustomRenderError] = useState<{ requestKey: string; message: string } | null>(null);
  const [isRenderingCustom, setIsRenderingCustom] = useState(false);
  const [creating, setCreating] = useState(false);

  // Profile data → signature fields, with the user's overrides applied.
  const data: SigData = useMemo(() => {
    const base = {
      full_name: user?.display_name ?? "",
      title: user?.job_title ?? "",
      department: user?.department ?? "",
      email: user?.email ?? "",
      phone: user?.business_phone ?? user?.mobile_phone ?? active?.phone ?? "",
      website: active?.website ?? "agholding.net",
      company: active?.name ?? "AG Holding",
      accent: active?.accent_color ?? "#f78d2b",
    };
    for (const f of FIELDS) {
      const v = overrides[f.key];
      if (v && v.trim()) (base as Record<string, string>)[f.key] = v.trim();
    }
    return base;
  }, [user, overrides, active]);

  // Render the selected signature. Built-ins render instantly client-side;
  // custom DB templates render through the backend (debounced).
  const builtin = selected.startsWith("design:")
    ? SIGNATURE_DESIGNS.find((d) => d.id === selected.slice(7))
    : null;
  const customRequestKey = `${selected}:${JSON.stringify(overrides)}`;

  useEffect(() => {
    if (builtin) {
      setCustomRenderError(null);
      setIsRenderingCustom(false);
      return;
    }
    const id = selected.slice(7);
    const controller = new AbortController();
    let active = true;
    setCustomRenderError(null);
    setIsRenderingCustom(true);
    const handle = window.setTimeout(() => {
      void api<EmailSignature>("/api/signatures/render", {
        method: "POST",
        body: { template_id: id, data: overrides },
        signal: controller.signal,
      })
        .then((signature) => {
          if (active) {
            setCustomResult({
              requestKey: customRequestKey,
              html: signature.rendered_html ?? "",
            });
          }
        })
        .catch((err: unknown) => {
          if (active) {
            setCustomRenderError({
              requestKey: customRequestKey,
              message: err instanceof Error ? err.message : "Couldn't render this signature.",
            });
          }
        })
        .finally(() => {
          if (active) setIsRenderingCustom(false);
        });
    }, 250);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [selected, overrides, builtin, customRequestKey]);

  const rendered = builtin
    ? builtin.render(data)
    : customResult?.requestKey === customRequestKey
      ? customResult.html
      : "";
  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(rendered), [rendered]);
  const renderError = !builtin && customRenderError?.requestKey === customRequestKey
    ? customRenderError.message
    : null;

  async function copyHtml() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(sanitizedHtml);
      notify("Signature HTML copied — paste it into Outlook/Gmail signature settings.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't copy the signature.", "error");
    }
  }
  function downloadHtml() {
    const blob = new Blob([sanitizedHtml], {
      type: "text/html",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signature.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHead
        title="Email Signatures"
        subtitle="Pick a design, tweak the details, then paste it into Outlook or Gmail."
        action={
          user?.is_admin && (
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              + Custom template
            </Button>
          )
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle id="signature-design-heading" className="flex items-center gap-2">
            <span className="grid size-6 place-items-center bg-primary text-xs font-bold text-primary-foreground">
              1
            </span>
            Choose a design
          </CardTitle></CardHeader>
          <CardContent>
          <div role="group" aria-labelledby="signature-design-heading">
          <div className="grid grid-cols-2 gap-2.5">
            {SIGNATURE_DESIGNS.map((d) => {
              const id = `design:${d.id}`;
              const active = selected === id;
              return (
                <Button type="button"
                  key={d.id}
                  variant={active ? "default" : "outline"}
                  onClick={() => setSelected(id)}
                  aria-pressed={active}
                  className="h-auto flex-col items-start p-3 text-left"
                >
                  <div className="font-semibold">{d.name}</div>
                  <div className={cn("text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{d.description}</div>
                </Button>
              );
            })}
          </div>

          {templates.data && templates.data.length > 0 && (
            <>
              <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Custom templates
              </div>
              <div className="flex flex-col gap-2">
                {templates.data.map((t) => {
                  const id = `custom:${t.id}`;
                  const active = selected === id;
                  return (
                    <Button type="button"
                      key={t.id}
                      variant={active ? "default" : "outline"}
                      onClick={() => setSelected(id)}
                      aria-pressed={active}
                      className="h-auto w-full justify-between px-3 py-2.5 text-left"
                    >
                      <span className="font-semibold">{t.name}</span>
                      {t.is_default && <Badge variant="secondary">default</Badge>}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
          </div>

          <h3 className="mt-6 flex items-center gap-2">
            <span className="grid size-6 place-items-center bg-primary text-xs font-bold text-primary-foreground">
              2
            </span>
            Your details
          </h3>
          <div className="mb-3 text-xs text-muted-foreground">
            Pre-filled from your directory profile — edit anything you like.
          </div>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key}>
                <FieldLabel htmlFor={`signature-${f.key}`}>{f.label}</FieldLabel>
                <Input id={`signature-${f.key}`}
                  placeholder={String(data[f.key] ?? "")}
                  value={overrides[f.key] ?? ""}
                  onChange={(e) =>
                    setOverrides((o) => ({ ...o, [f.key]: e.target.value }))
                  }
                />
              </Field>
            ))}
          </FieldGroup>
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-[84px]">
          <CardHeader className="grid grid-cols-[1fr_auto] items-center">
            <CardTitle>Live preview</CardTitle>
            <div className="flex flex-none gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={downloadHtml} disabled={!sanitizedHtml || isRenderingCustom}>
                Download .html
              </Button>
              <Button type="button" size="sm" onClick={copyHtml} disabled={!sanitizedHtml || isRenderingCustom}>
                Copy signature
              </Button>
            </div>
          </CardHeader>
          <CardContent>
          {renderError ? (
            <div role="alert" className="border border-destructive bg-card p-3 text-sm text-destructive">
              Couldn't render this signature: {renderError}
            </div>
          ) : sanitizedHtml ? (
            <>
              <div className="mb-2 text-xs text-muted-foreground">
                Preview of the sanitized HTML. Email clients may render it differently.
              </div>
              <Card><CardContent><div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} /></CardContent></Card>
              <div className="mt-3 bg-muted p-3 text-xs text-foreground">
                <strong>To use it:</strong> click <em>Copy signature</em>, then in
                Outlook go to <em>File → Options → Mail → Signatures</em> (or Gmail{" "}
                <em>Settings → General → Signature</em>) and paste.
              </div>
            </>
          ) : (
            <ListSkeleton rows={3} />
          )}
          </CardContent>
        </Card>
      </div>

      {creating && (
        <TemplateForm onClose={() => setCreating(false)} onSaved={templates.reload} />
      )}
    </div>
  );
}
