import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EmailSignature, SignatureTemplate } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ListSkeleton, Modal, PageHead, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import { SIGNATURE_DESIGNS, type SigData } from "../signatures/templates";

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
  return (
    <Modal title="New signature template" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/api/signatures/templates", { method: "POST", body: form });
          notify("Template created.");
          onSaved();
          onClose();
        }}
      >
        <div className="field">
          <label>Name *</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>HTML (use {"{{ full_name }}"}, {"{{ title }}"}, …)</label>
          <textarea
            required
            rows={8}
            style={{ fontFamily: "monospace", fontSize: 12 }}
            value={form.html}
            onChange={(e) => setForm({ ...form, html: e.target.value })}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>
            Save template
          </button>
        </div>
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
  const [customHtml, setCustomHtml] = useState<string | null>(null);
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
      accent: active?.accent_color ?? "#0b5cab",
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

  useEffect(() => {
    if (builtin) {
      setCustomHtml(null);
      return;
    }
    const id = selected.slice(7);
    const handle = window.setTimeout(() => {
      void api<EmailSignature>("/api/signatures/render", {
        method: "POST",
        body: { template_id: id, data: overrides },
      }).then((s) => setCustomHtml(s.rendered_html ?? ""));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [selected, overrides, builtin]);

  const rendered = builtin ? builtin.render(data) : customHtml ?? "";

  function copyHtml() {
    void navigator.clipboard.writeText(rendered);
    notify("Signature HTML copied — paste it into Outlook/Gmail signature settings.");
  }
  function downloadHtml() {
    const blob = new Blob([`<!doctype html><meta charset="utf-8">${rendered}`], {
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
            <button className="btn" onClick={() => setCreating(true)}>
              + Custom template
            </button>
          )
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mt-0 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
              1
            </span>
            Choose a design
          </h3>
          <div className="grid grid-cols-2 gap-2.5">
            {SIGNATURE_DESIGNS.map((d) => {
              const id = `design:${d.id}`;
              const active = selected === id;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(id)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    active
                      ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30"
                      : "border-[var(--border)] bg-white hover:border-brand-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-xs text-ink-muted">{d.description}</div>
                </button>
              );
            })}
          </div>

          {templates.data && templates.data.length > 0 && (
            <>
              <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Custom templates
              </div>
              <div className="flex flex-col gap-2">
                {templates.data.map((t) => {
                  const id = `custom:${t.id}`;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelected(id)}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left ${
                        selected === id
                          ? "border-brand-200 bg-brand-50 text-brand-800"
                          : "border-[var(--border)] bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-semibold">{t.name}</span>
                      {t.is_default && <span className="badge">default</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <h3 className="mt-6 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
              2
            </span>
            Your details
          </h3>
          <div className="muted mb-3 text-xs">
            Pre-filled from your directory profile — edit anything you like.
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            {FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}</label>
                <input
                  placeholder={String(data[f.key] ?? "")}
                  value={overrides[f.key] ?? ""}
                  onChange={(e) =>
                    setOverrides((o) => ({ ...o, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card lg:sticky lg:top-[84px]">
          <div className="spread">
            <h3 className="mt-0">Live preview</h3>
            <div className="flex flex-none gap-1.5">
              <button className="btn-sm" onClick={downloadHtml}>
                Download .html
              </button>
              <button className="btn-sm btn-primary" onClick={copyHtml}>
                Copy signature
              </button>
            </div>
          </div>
          {rendered ? (
            <>
              <div className="muted mb-2 text-xs">Exactly how it will appear in an email:</div>
              <div className="rounded-xl border border-[var(--border)] bg-gradient-to-b from-slate-50 to-white p-5 shadow-card">
                <div dangerouslySetInnerHTML={{ __html: rendered }} />
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-ink-muted">
                <strong>To use it:</strong> click <em>Copy signature</em>, then in
                Outlook go to <em>File → Options → Mail → Signatures</em> (or Gmail{" "}
                <em>Settings → General → Signature</em>) and paste.
              </div>
            </>
          ) : (
            <ListSkeleton rows={3} />
          )}
        </div>
      </div>

      {creating && (
        <TemplateForm onClose={() => setCreating(false)} onSaved={templates.reload} />
      )}
    </div>
  );
}
