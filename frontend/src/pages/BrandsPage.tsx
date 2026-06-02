import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Brand } from "../api/types";
import { useBrand } from "../brand/BrandContext";
import { Empty, ListSkeleton, PageHead, useToast } from "../components/ui";

const TEXT_FIELDS: { key: keyof Brand; label: string; placeholder?: string }[] = [
  { key: "website", label: "Website", placeholder: "agiomix.com" },
  { key: "contact_email", label: "Contact email", placeholder: "hello@agiomix.com" },
  { key: "email_domain", label: "Email domain", placeholder: "agiomix.com" },
  { key: "phone", label: "Phone" },
  { key: "tagline", label: "Tagline" },
  { key: "font_family", label: "Font family", placeholder: "Arial, sans-serif" },
];

function BrandEditor({ brand, onSaved }: { brand: Brand; onSaved: () => void }) {
  const { notify } = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Brand>(brand);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(brand), [brand]);
  const set = (k: keyof Brand, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/brands/${brand.id}`, {
        method: "PATCH",
        body: {
          name: form.name,
          primary_color: form.primary_color,
          secondary_color: form.secondary_color,
          accent_color: form.accent_color,
          website: form.website || null,
          contact_email: form.contact_email || null,
          email_domain: form.email_domain || null,
          phone: form.phone || null,
          tagline: form.tagline || null,
          font_family: form.font_family || null,
          address: form.address || null,
        },
      });
      notify("Brand saved.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const updated = await api<Brand>(`/api/brands/${brand.id}/logo`, {
        method: "POST",
        form: fd,
      });
      setForm((f) => ({ ...f, logo_url: updated.logo_url }));
      notify("Logo updated.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (logoRef.current) logoRef.current.value = "";
  }

  return (
    <div className="card">
      <div className="spread mb-4">
        <h3 className="m-0">{form.name || "Brand"}</h3>
        <button className="btn-primary flex-none" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="mb-4 flex items-center gap-4">
        <div
          className="grid h-20 w-20 flex-none place-items-center overflow-hidden rounded-xl border border-[var(--border)] bg-slate-50"
          style={{ color: form.primary_color }}
        >
          {form.logo_url ? (
            <img src={form.logo_url} alt="" className="h-full w-full object-contain p-1" />
          ) : (
            <span className="text-2xl font-bold">{form.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div>
          <button className="btn-sm" onClick={() => logoRef.current?.click()}>
            Upload logo
          </button>
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={uploadLogo} />
          <div className="muted mt-1 text-xs">PNG or SVG, transparent background.</div>
        </div>
      </div>

      <div className="field">
        <label>Brand name</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-x-3">
        {(["primary_color", "secondary_color", "accent_color"] as const).map((k) => (
          <div className="field" key={k}>
            <label className="capitalize">{k.replace("_color", "")}</label>
            <input
              type="color"
              value={(form[k] as string) || "#0b5cab"}
              onChange={(e) => set(k, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-3">
        {TEXT_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input
              placeholder={f.placeholder}
              value={(form[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label>Address</label>
        <textarea
          rows={2}
          value={form.address ?? ""}
          onChange={(e) => set("address", e.target.value)}
        />
      </div>
    </div>
  );
}

export default function BrandsPage() {
  const { notify } = useToast();
  const { brands, loading, reload, setActive } = useBrand();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && brands.length > 0) setSelectedId(brands[0].id);
  }, [brands, selectedId]);

  const selected = brands.find((b) => b.id === selectedId) ?? null;

  async function createBrand() {
    const name = window.prompt("New brand name");
    if (!name) return;
    try {
      const b = await api<Brand>("/api/brands", { method: "POST", body: { name } });
      notify("Brand created.");
      await reload();
      setSelectedId(b.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Brands"
        subtitle="Manage each company brand's identity — used across cards, signatures, pages and more."
        action={
          <button className="btn-primary" onClick={createBrand}>
            + New brand
          </button>
        }
      />
      {loading ? (
        <ListSkeleton rows={5} />
      ) : brands.length === 0 ? (
        <Empty icon="🏢" message="No brands yet" hint="Create your first brand to get started." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
          <div className="card !p-2">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border-0 px-3 py-2.5 text-left ${
                  b.id === selectedId ? "bg-brand-50" : "bg-transparent hover:bg-slate-50"
                }`}
              >
                {b.logo_url ? (
                  <img src={b.logo_url} alt="" className="h-5 w-5 flex-none rounded object-contain" />
                ) : (
                  <span
                    className="h-4 w-4 flex-none rounded-full ring-1 ring-black/10"
                    style={{ background: b.primary_color }}
                  />
                )}
                <span className="flex-1 truncate font-semibold">{b.name}</span>
                {b.is_default && <span className="badge">default</span>}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="space-y-3">
              <BrandEditor key={selected.id} brand={selected} onSaved={reload} />
              <button
                className="btn-sm"
                onClick={() => {
                  setActive(selected.id);
                  notify(`Switched to ${selected.name}.`);
                }}
              >
                Make this my active brand
              </button>
            </div>
          ) : (
            <div className="card">
              <Empty message="Select a brand to edit." />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
