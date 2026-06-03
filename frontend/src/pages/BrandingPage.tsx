import { useEffect, useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { Brand, BrandDocument, BrandDocumentVersion } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import {
  ConfirmModal,
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  PromptModal,
  bytes,
  useToast,
} from "../components/ui";

interface PaletteColor {
  name: string;
  hex: string;
}

function parsePalette(raw?: string | null): PaletteColor[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const CATEGORIES = ["logo", "guideline", "font", "document", "other"];
const DOC_ICON: Record<string, string> = {
  logo: "🖼",
  guideline: "📘",
  font: "🔤",
  document: "📄",
  other: "📎",
};

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="color"
        value={value || "#0b5cab"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="!h-12 !w-16 !p-1"
      />
      <span className="text-xs font-medium capitalize">{label}</span>
      <span className="text-[10px] text-ink-muted">{value}</span>
    </div>
  );
}

function VersionsModal({ doc, onClose }: { doc: BrandDocument; onClose: () => void }) {
  const { notify } = useToast();
  const { data, loading } = useFetch<BrandDocumentVersion[]>(
    `/api/brands/documents/${doc.id}/versions`,
  );
  return (
    <Modal title={`${doc.name} — version history`} onClose={onClose}>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : (
        <table>
          <tbody>
            {(data ?? []).map((v) => (
              <tr key={v.id}>
                <td className="font-semibold">v{v.version}</td>
                <td className="muted">{bytes(v.size_bytes)}</td>
                <td className="muted text-xs">
                  {new Date(v.created_at).toLocaleString()}
                </td>
                <td className="text-right">
                  <button
                    className="btn-sm"
                    onClick={() =>
                      downloadFile(
                        `/api/brands/document-versions/${v.id}/download`,
                        `${doc.name}-v${v.version}`,
                      ).catch(() => notify("Download failed", "error"))
                    }
                  >
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function BrandHub({ brand, canManage, onSaved }: { brand: Brand; canManage: boolean; onSaved: () => void }) {
  const { notify } = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(brand);
  const [palette, setPalette] = useState<PaletteColor[]>(parsePalette(brand.palette));
  const [busy, setBusy] = useState(false);
  const [docName, setDocName] = useState("");
  const [docCategory, setDocCategory] = useState("guideline");
  const [versionsFor, setVersionsFor] = useState<BrandDocument | null>(null);
  const docs = useFetch<BrandDocument[]>(`/api/brands/${brand.id}/documents`);

  useEffect(() => {
    setForm(brand);
    setPalette(parsePalette(brand.palette));
  }, [brand]);

  const set = (k: keyof Brand, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function saveIdentity() {
    setBusy(true);
    try {
      await api(`/api/brands/${brand.id}`, {
        method: "PATCH",
        body: {
          name: form.name,
          primary_color: form.primary_color,
          secondary_color: form.secondary_color,
          accent_color: form.accent_color,
          font_family: form.font_family || null,
          palette: JSON.stringify(palette),
          website: form.website || null,
          contact_email: form.contact_email || null,
          phone: form.phone || null,
          tagline: form.tagline || null,
          address: form.address || null,
        },
      });
      notify("Brand identity saved.");
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
      const u = await api<Brand>(`/api/brands/${brand.id}/logo`, { method: "POST", form: fd });
      setForm((f) => ({ ...f, logo_url: u.logo_url }));
      notify("Logo updated.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (logoRef.current) logoRef.current.value = "";
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = docName.trim() || file.name;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    fd.append("category", docCategory);
    try {
      await api(`/api/brands/${brand.id}/documents`, { method: "POST", form: fd });
      notify(`Uploaded “${name}”. New versions are kept automatically.`);
      setDocName("");
      docs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (docRef.current) docRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="card">
        <div className="spread mb-4">
          <h3 className="m-0">{brand.name} — identity</h3>
          {canManage && (
            <button className="btn-primary flex-none" disabled={busy} onClick={saveIdentity}>
              {busy ? "Saving…" : "Save identity"}
            </button>
          )}
        </div>

        <div className="mb-5 flex items-center gap-4">
          <div
            className="grid h-24 w-24 flex-none place-items-center overflow-hidden rounded-2xl border border-[var(--border)]"
            style={{ background: `${form.primary_color}14`, color: form.primary_color }}
          >
            {form.logo_url ? (
              <img src={form.logo_url} alt="" className="h-full w-full object-contain p-2" />
            ) : (
              <span className="text-2xl font-bold">{form.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          {canManage && (
            <div>
              <button className="btn-sm" onClick={() => logoRef.current?.click()}>
                Upload logo
              </button>
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={uploadLogo} />
              <div className="muted mt-1 text-xs">PNG or SVG, transparent background.</div>
            </div>
          )}
        </div>

        {/* Colors */}
        <div className="mb-2 text-sm font-semibold">Brand colours</div>
        <div className="mb-4 flex flex-wrap items-start gap-5">
          <ColorField label="primary" value={form.primary_color} disabled={!canManage} onChange={(v) => set("primary_color", v)} />
          <ColorField label="secondary" value={form.secondary_color ?? "#64748b"} disabled={!canManage} onChange={(v) => set("secondary_color", v)} />
          <ColorField label="accent" value={form.accent_color} disabled={!canManage} onChange={(v) => set("accent_color", v)} />
          {palette.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <input
                type="color"
                value={c.hex}
                disabled={!canManage}
                onChange={(e) =>
                  setPalette((p) => p.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))
                }
                className="!h-12 !w-16 !p-1"
              />
              <input
                value={c.name}
                disabled={!canManage}
                placeholder="name"
                onChange={(e) =>
                  setPalette((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                className="!w-16 !py-0.5 text-center !text-xs"
              />
              {canManage && (
                <button
                  className="text-[10px] text-red-500"
                  onClick={() => setPalette((p) => p.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <button
              className="grid h-12 w-16 place-items-center rounded-lg border-2 border-dashed border-slate-300 text-lg text-slate-400 hover:border-brand-400"
              onClick={() => setPalette((p) => [...p, { name: "Colour", hex: "#888888" }])}
              title="Add palette colour"
            >
              +
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3">
          <div className="field">
            <label>Font family</label>
            <input disabled={!canManage} value={form.font_family ?? ""} onChange={(e) => set("font_family", e.target.value)} placeholder="e.g. Montserrat, Arial" />
          </div>
          <div className="field">
            <label>Website</label>
            <input disabled={!canManage} value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="field">
            <label>Contact email</label>
            <input disabled={!canManage} value={form.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input disabled={!canManage} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Tagline</label>
          <input disabled={!canManage} value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} />
        </div>
      </div>

      {/* Documents */}
      <div className="card">
        <div className="spread mb-3">
          <h3 className="m-0">Brand documents</h3>
          {canManage && (
            <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
              <input
                placeholder="Document name (e.g. Logo Pack)"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                style={{ width: 200 }}
              />
              <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className="!w-auto">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="btn-primary flex-none" onClick={() => docRef.current?.click()}>
                Upload
              </button>
              <input ref={docRef} type="file" hidden onChange={uploadDoc} />
            </div>
          )}
        </div>
        <div className="muted mb-3 text-xs">
          Re-upload a document with the same name to add a new version — full history is kept.
        </div>

        {docs.loading ? (
          <ListSkeleton rows={3} />
        ) : !docs.data || docs.data.length === 0 ? (
          <Empty icon="📁" message="No documents yet" hint="Upload logos, guideline PDFs or fonts above." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Version</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id}>
                  <td className="font-semibold">
                    <span className="mr-2">{DOC_ICON[d.category] ?? "📄"}</span>
                    {d.name}
                  </td>
                  <td><span className="badge">{d.category}</span></td>
                  <td>
                    <button className="badge blue" onClick={() => setVersionsFor(d)}>
                      v{d.current_version} · {d.version_count} versions
                    </button>
                  </td>
                  <td className="muted">{d.latest_size != null ? bytes(d.latest_size) : "—"}</td>
                  <td className="text-right">
                    <button
                      className="btn-sm"
                      onClick={() => setVersionsFor(d)}
                    >
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {versionsFor && (
        <VersionsModal doc={versionsFor} onClose={() => setVersionsFor(null)} />
      )}
    </div>
  );
}

export default function BrandingPage() {
  const { user } = useAuth();
  const { brands, loading, reload, setActive } = useBrand();
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Brand | null>(null);

  useEffect(() => {
    if (!selectedId && brands.length > 0) setSelectedId(brands[0].id);
  }, [brands, selectedId]);

  const selected = brands.find((b) => b.id === selectedId) ?? null;
  const isAdmin = !!user?.is_admin;
  const canManage = (b: Brand) =>
    isAdmin || (user?.managed_brand_ids ?? []).includes(b.id);

  async function createBrand(name: string) {
    const b = await api<Brand>("/api/brands", { method: "POST", body: { name } });
    notify("Brand created.");
    await reload();
    setSelectedId(b.id);
  }

  async function remove(b: Brand) {
    await api(`/api/brands/${b.id}`, { method: "DELETE" });
    notify("Brand deleted.");
    await reload();
    setSelectedId(null);
  }

  return (
    <div>
      <PageHead
        title="Brand Center"
        subtitle="Each company's colours, fonts, logo and versioned brand documents — all in one place."
        action={
          isAdmin && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New brand
            </button>
          )
        }
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : brands.length === 0 ? (
        <Empty icon="🏢" message="No brands yet" hint="Create your first company brand to get started." />
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
                  <img src={b.logo_url} alt="" className="h-6 w-6 flex-none rounded object-contain" />
                ) : (
                  <span className="h-5 w-5 flex-none rounded-full ring-1 ring-black/10" style={{ background: b.primary_color }} />
                )}
                <span className="flex-1 truncate font-semibold">{b.name}</span>
                {b.is_default && <span className="badge">default</span>}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-3">
              <BrandHub key={selected.id} brand={selected} canManage={canManage(selected)} onSaved={reload} />
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => {
                    setActive(selected.id);
                    notify(`Switched active brand to ${selected.name}.`);
                  }}
                >
                  Make active brand
                </button>
                {isAdmin && !selected.is_default && (
                  <button
                    className="btn-sm btn-danger"
                    style={{ flex: "0 0 auto" }}
                    onClick={() => setDeleting(selected)}
                  >
                    Delete brand
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <Empty message="Select a brand to manage." />
            </div>
          )}
        </div>
      )}

      {creating && (
        <PromptModal
          title="New brand"
          label="Brand / company name"
          placeholder="e.g. Agiomix"
          submitLabel="Create brand"
          onSubmit={createBrand}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete brand"
          message={`Delete ${deleting.name}? Its documents will be removed; linked items keep working but lose their brand.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
