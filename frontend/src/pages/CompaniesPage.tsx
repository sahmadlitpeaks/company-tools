import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { Company } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function CompaniesPage() {
  const { notify } = useToast();
  const companies = useFetch<Company[]>("/api/companies");
  const [editing, setEditing] = useState<Company | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(b: Company) {
    if (b.is_default) {
      notify("The default company can't be deleted.", "error");
      return;
    }
    if (!confirm(`Delete the “${b.name}” company?`)) return;
    try {
      await api(`/api/companies/${b.id}`, { method: "DELETE" });
      notify("Company deleted.");
      companies.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Companys"
        subtitle="The companies / sub-companies content can be scoped to."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={15} /> New company
          </button>
        }
      />

      {companies.loading ? (
        <Loading />
      ) : (companies.data?.length ?? 0) === 0 ? (
        <Empty message="No companies yet." />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {companies.data!.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-xl text-sm font-bold text-white"
                  style={{ background: b.primary_color }}
                >
                  {b.logo_url ? (
                    <img src={apiUrl(b.logo_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    b.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{b.name}</span>
                    {b.is_default && <span className="badge blue">default</span>}
                  </div>
                  {b.tagline && <div className="muted truncate text-xs">{b.tagline}</div>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-sm inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setEditing(b)}>
                  <Pencil size={13} /> Edit
                </button>
                {!b.is_default && (
                  <button className="btn-sm btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => remove(b)}>
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <CompanyModal
          company={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            companies.reload();
          }}
        />
      )}
    </div>
  );
}

function CompanyModal({ company, onClose, onSaved }: { company: Company | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    name: company?.name ?? "",
    tagline: company?.tagline ?? "",
    website: company?.website ?? "",
    email_domain: company?.email_domain ?? "",
    primary_color: company?.primary_color ?? "#0b5cab",
    accent_color: company?.accent_color ?? "#0b5cab",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        tagline: form.tagline || null,
        website: form.website || null,
        email_domain: form.email_domain || null,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
      };
      const saved = company
        ? await api<Company>(`/api/companies/${company.id}`, { method: "PATCH", body })
        : await api<Company>("/api/companies", { method: "POST", body });
      if (logo) {
        const fd = new FormData();
        fd.append("file", logo);
        await api(`/api/companies/${saved.id}/logo`, { method: "POST", form: fd });
      }
      notify(company ? "Company updated." : "Company created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={company ? `Edit ${company.name}` : "New company"} onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label>Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label>Website</label>
            <input placeholder="https://…" value={form.website} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="field">
            <label>Email domain</label>
            <input placeholder="company.com" value={form.email_domain} onChange={(e) => set("email_domain", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Primary colour</label>
            <input type="color" value={form.primary_color} onChange={(e) => set("primary_color", e.target.value)} />
          </div>
          <div className="field">
            <label>Accent colour</label>
            <input type="color" value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
          </div>
          <div className="field">
            <label>Logo</label>
            <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : company ? "Save changes" : "Create company"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
