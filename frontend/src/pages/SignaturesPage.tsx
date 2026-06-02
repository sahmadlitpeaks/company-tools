import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { EmailSignature, SignatureTemplate } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";

const FIELDS = ["full_name", "title", "department", "email", "phone", "website"];

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
  const { notify } = useToast();
  const templates = useFetch<SignatureTemplate[]>("/api/signatures/templates");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);

  async function render(templateId: string, data = overrides) {
    const sig = await api<EmailSignature>("/api/signatures/render", {
      method: "POST",
      body: { template_id: templateId, data },
    });
    setRendered(sig.rendered_html ?? "");
  }

  // Auto-select the default (or first) template once they load.
  useEffect(() => {
    if (!selected && templates.data && templates.data.length > 0) {
      const pick = templates.data.find((t) => t.is_default) ?? templates.data[0];
      setSelected(pick.id);
    }
  }, [templates.data, selected]);

  // Live preview: re-render whenever the template or overrides change.
  useEffect(() => {
    if (!selected) return;
    const handle = window.setTimeout(() => void render(selected, overrides), 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, overrides]);

  function copyHtml() {
    if (rendered) {
      void navigator.clipboard.writeText(rendered);
      notify("Signature HTML copied — paste into Outlook/Gmail settings.");
    }
  }

  function downloadHtml() {
    if (!rendered) return;
    const blob = new Blob(
      [`<!doctype html><meta charset="utf-8">${rendered}`],
      { type: "text/html" },
    );
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
        subtitle="Generate a branded signature from your directory profile."
        action={
          user?.is_admin && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New template
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
            Pick a template
          </h3>
          {templates.loading ? (
            <ListSkeleton rows={3} />
          ) : !templates.data || templates.data.length === 0 ? (
            <Empty icon="✉️" message="No templates yet" hint="An admin can create one." />
          ) : (
            <div className="flex flex-col gap-2">
              {templates.data.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selected === t.id
                      ? "border border-brand-200 bg-brand-50 text-brand-800"
                      : "border border-[var(--border)] bg-white hover:bg-slate-50"
                  }`}
                >
                  <span className="font-semibold">{t.name}</span>
                  {t.is_default && <span className="badge">default</span>}
                </button>
              ))}
            </div>
          )}

          <h3 className="mt-6 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
              2
            </span>
            Customise <span className="text-sm font-normal text-ink-muted">(optional)</span>
          </h3>
          <div className="muted mb-3 text-xs">
            Leave blank to use your directory data. The preview updates as you type.
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            {FIELDS.map((f) => (
              <div className="field" key={f}>
                <label className="capitalize">{f.replace("_", " ")}</label>
                <input
                  value={overrides[f] ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, [f]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card lg:sticky lg:top-[84px]">
          <div className="spread">
            <h3 className="mt-0">Live preview</h3>
            {rendered && (
              <div className="flex flex-none gap-1.5">
                <button className="btn-sm" onClick={downloadHtml}>
                  Download .html
                </button>
                <button className="btn-sm btn-primary" onClick={copyHtml}>
                  Copy HTML
                </button>
              </div>
            )}
          </div>
          {rendered ? (
            <>
              <div className="muted mb-2 text-xs">How it will look in an email:</div>
              <div className="rounded-xl border border-[var(--border)] bg-gradient-to-b from-slate-50 to-white p-5 shadow-card">
                <div dangerouslySetInnerHTML={{ __html: rendered }} />
              </div>
            </>
          ) : templates.loading ? (
            <ListSkeleton rows={3} />
          ) : !templates.data || templates.data.length === 0 ? (
            <Empty icon="✉️" message="No templates yet" hint="An admin can create one to get started." />
          ) : (
            <Empty icon="👀" message="Select a template" hint="Pick a template on the left to preview your signature." />
          )}
        </div>
      </div>
      {creating && (
        <TemplateForm
          onClose={() => setCreating(false)}
          onSaved={templates.reload}
        />
      )}
    </div>
  );
}
