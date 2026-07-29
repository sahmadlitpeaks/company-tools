import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Building2,
  FileText,
  Folder,
  Image,
  Paperclip,
  Type,
  type LucideIcon,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Brand, BrandDocument, BrandDocumentVersion } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import {
  ConfirmDialog,
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
const DOC_ICON: Record<string, LucideIcon> = {
  logo: Image,
  guideline: BookOpen,
  font: Type,
  document: FileText,
  other: Paperclip,
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
      <Input aria-label={`${label} color`}
        type="color"
        value={value || "#f78d2b"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="!h-12 !w-16 !p-1"
      />
      <span className="text-xs font-medium capitalize">{label}</span>
      <span className="text-[10px] text-muted-foreground">{value}</span>
    </div>
  );
}

function VersionsModal({ doc, onClose }: { doc: BrandDocument; onClose: () => void }) {
  const { notify } = useToast();
  const { data, loading } = useFetch<BrandDocumentVersion[]>(
    `/api/companies/documents/${doc.id}/versions`,
  );
  return (
    <Modal title={`${doc.name} — version history`} onClose={onClose}>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : (
        <Table>
          <TableBody>
            {(data ?? []).map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-semibold">v{v.version}</TableCell>
                <TableCell className="text-muted-foreground">{bytes(v.size_bytes)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="outline" size="sm"
                    onClick={() =>
                      downloadFile(
                        `/api/companies/document-versions/${v.id}/download`,
                        `${doc.name}-v${v.version}`,
                      ).catch(() => notify("Download failed", "error"))
                    }
                  >
                    Download
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Modal>
  );
}

function BrandHub({ brand, canManage, onSaved }: { brand: Brand; canManage: boolean; onSaved: () => void }) {
  const { notify } = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(brand);
  const [palette, setPalette] = useState<PaletteColor[]>(() => parsePalette(brand.palette));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [docName, setDocName] = useState("");
  const [docCategory, setDocCategory] = useState("guideline");
  const [versionsFor, setVersionsFor] = useState<BrandDocument | null>(null);
  const docs = useFetch<BrandDocument[]>(`/api/companies/${brand.id}/documents`);

  useEffect(() => {
    setForm(brand);
    setPalette(parsePalette(brand.palette));
  }, [brand]);

  const set = (k: keyof Brand, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function saveIdentity() {
    setIsSubmitting(true);
    try {
      await api(`/api/companies/${brand.id}`, {
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
      setIsSubmitting(false);
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const u = await api<Brand>(`/api/companies/${brand.id}/logo`, { method: "POST", form: fd });
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
      await api(`/api/companies/${brand.id}/documents`, { method: "POST", form: fd });
      notify(`Uploaded “${name}”. New versions are kept automatically.`);
      setDocName("");
      docs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (docRef.current) docRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{brand.name} — identity</CardTitle>
          {canManage && (
            <Button type="button" disabled={isSubmitting} onClick={saveIdentity}>
              {isSubmitting ? "Saving…" : "Save identity"}
            </Button>
          )}
        </CardHeader>
        <CardContent>

        <div className="mb-5 flex items-center gap-4">
          <div
            className="grid size-24 flex-none place-items-center overflow-hidden border"
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
              <Button type="button" variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
                Upload logo
              </Button>
              <Input aria-label="Upload logo" ref={logoRef} type="file" accept="image/*" hidden onChange={uploadLogo} />
              <div className="mt-1 text-xs text-muted-foreground">PNG or SVG, transparent background.</div>
            </div>
          )}
        </div>

        {/* Colors */}
        <div className="mb-2 text-sm font-semibold">Brand colours</div>
        <div className="mb-4 flex flex-wrap items-start gap-5">
          <ColorField label="primary" value={form.primary_color} disabled={!canManage} onChange={(v) => set("primary_color", v)} />
          <ColorField label="secondary" value={form.secondary_color ?? "#71717a"} disabled={!canManage} onChange={(v) => set("secondary_color", v)} />
          <ColorField label="accent" value={form.accent_color} disabled={!canManage} onChange={(v) => set("accent_color", v)} />
          {palette.map((c, i) => (
            <div key={`${c.name}-${c.hex}`} className="flex flex-col items-center gap-1">
              <Input aria-label={`${c.name} color`}
                type="color"
                value={c.hex}
                disabled={!canManage}
                onChange={(e) =>
                  setPalette((p) => p.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))
                }
                className="!h-12 !w-16 !p-1"
              />
              <Input aria-label="Color name"
                value={c.name}
                disabled={!canManage}
                placeholder="name"
                onChange={(e) =>
                  setPalette((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                className="!w-16 !py-0.5 text-center !text-xs"
              />
              {canManage && (
                <Button type="button" variant="link" size="xs" className="text-destructive"
                  onClick={() => setPalette((p) => p.filter((_, j) => j !== i))}
                >
                  remove
                </Button>
              )}
            </div>
          ))}
          {canManage && (
            <Button type="button" variant="outline"
              className="h-12 w-16 border-2 border-dashed text-lg text-muted-foreground"
              onClick={() => setPalette((p) => [...p, { name: "Colour", hex: "#888888" }])}
              title="Add palette colour"
            >
              +
            </Button>
          )}
        </div>

        <FieldGroup>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="rd-brandingpage-275-font-family">Font family</FieldLabel>
              <Input id="rd-brandingpage-275-font-family" aria-label="e.g. Montserrat, Arial" disabled={!canManage} value={form.font_family ?? ""} onChange={(e) => set("font_family", e.target.value)} placeholder="e.g. Montserrat, Arial" />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-brandingpage-279-website">Website</FieldLabel>
              <Input id="rd-brandingpage-279-website" disabled={!canManage} value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-brandingpage-283-contact-email">Contact email</FieldLabel>
              <Input id="rd-brandingpage-283-contact-email" disabled={!canManage} value={form.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-brandingpage-287-phone">Phone</FieldLabel>
              <Input id="rd-brandingpage-287-phone" disabled={!canManage} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="rd-brandingpage-292-tagline">Tagline</FieldLabel>
            <Input id="rd-brandingpage-292-tagline" disabled={!canManage} value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
        </FieldGroup>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card className="py-0">
        <CardHeader className="pt-4">
          <CardTitle>Brand documents</CardTitle>
          <CardDescription>
            Re-upload a document with the same name to add a new version. Full history is kept.
          </CardDescription>
          {canManage && (
            <FieldGroup className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
              <Field>
              <FieldLabel htmlFor="brand-document-name">Document name</FieldLabel>
              <Input id="brand-document-name"
                placeholder="Document name (e.g. Logo Pack)"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
              />
              </Field>
              <Field>
              <FieldLabel htmlFor="brand-document-category">Category</FieldLabel>
              <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={docCategory} onValueChange={(value) => setDocCategory(value ?? "")}>
                <SelectTrigger className="w-full" id="brand-document-category"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              </Field>
              <Button type="button" onClick={() => docRef.current?.click()}>
                Upload
              </Button>
              <Input aria-label="Upload document" ref={docRef} type="file" hidden onChange={uploadDoc} />
            </FieldGroup>
          )}
        </CardHeader>

        <CardContent className="p-0">
        {docs.loading ? (
          <div className="p-4"><ListSkeleton rows={3} /></div>
        ) : !docs.data || docs.data.length === 0 ? (
          <Empty icon={<Folder />} message="No documents yet" hint="Upload logos, guideline PDFs or fonts above." />
        ) : (
          <Table>
            <TableBody>
              {docs.data.map((d) => {
                const DocumentIcon = DOC_ICON[d.category] ?? FileText;
                return <TableRow key={d.id}>
                  <TableCell className="max-w-[28rem] whitespace-normal">
                    <DocumentIcon className="mr-2 inline-block" aria-hidden="true" />
                    <span className="inline-block max-w-72 truncate align-middle font-semibold" title={d.name}>{d.name}</span>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{d.category}</Badge></TableCell>
                  <TableCell>
                      <Button type="button" variant="link" size="sm" className="text-foreground" onClick={() => setVersionsFor(d)}>
                      v{d.current_version} · {d.version_count} versions
                    </Button>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{d.latest_size != null ? bytes(d.latest_size) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => setVersionsFor(d)}
                    >
                      History
                    </Button>
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

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
    isAdmin || (user?.managed_company_ids ?? []).includes(b.id);

  async function createBrand(name: string) {
    const b = await api<Brand>("/api/companies", { method: "POST", body: { name } });
    notify("Brand created.");
    await reload();
    setSelectedId(b.id);
  }

  async function remove(b: Brand) {
    await api(`/api/companies/${b.id}`, { method: "DELETE" });
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
            <Button type="button" onClick={() => setCreating(true)}>
              + New brand
            </Button>
          )
        }
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : brands.length === 0 ? (
        <Empty icon={<Building2 />} message="No brands yet" hint="Create your first company brand to get started." />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Brand selector */}
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => {
              const active = b.id === selectedId;
              return (
                <Button aria-label={`Select ${b.name}`} type="button"
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  variant={active ? "default" : "outline"}
                >
                  {b.logo_url ? (
                    <img src={b.logo_url} alt="" className="size-5 flex-none object-contain" />
                  ) : (
                    <span
                      className="size-3.5 flex-none ring-1 ring-foreground/10"
                      style={{ background: b.primary_color }}
                    />
                  )}
                  <span className="truncate">{b.name}</span>
                  {b.is_default && (
                    <span className="text-[10px] font-medium opacity-70">
                      default
                    </span>
                  )}
                </Button>
              );
            })}
          </div>

          {selected ? (
            <div className="flex flex-col gap-3">
              <BrandHub key={selected.id} brand={selected} canManage={canManage(selected)} onSaved={reload} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm"
                  onClick={() => {
                    setActive(selected.id);
                    notify(`Switched active brand to ${selected.name}.`);
                  }}
                >
                  Make active brand
                </Button>
                {isAdmin && !selected.is_default && (
                  <Button type="button" variant="destructive" size="sm"
                    onClick={() => setDeleting(selected)}
                  >
                    Delete brand
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent><Empty message="Select a brand to manage." /></CardContent>
            </Card>
          )}
        </div>
      )}

      {creating && (
        <PromptModal
          title="New brand"
          label="Brand / company name"
          placeholder="e.g. Agiomix"
          submitLabel="Create brand"
          onConfirm={createBrand}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
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
