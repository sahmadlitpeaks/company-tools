import { useEffect, useState } from "react";
import { Download, Pencil, QrCode, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, downloadFile } from "../api/client";
import type { QRCode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useBrand } from "../brand/BrandContext";
import {
  AuthImage,
  ConfirmDialog,
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";

function brandColors(brand: { primary_color: string; secondary_color?: string | null; accent_color: string; palette?: string | null }) {
  let extra: string[] = [];
  try {
    const parsed = JSON.parse(brand.palette || "[]") as Array<{ hex?: string }>;
    extra = Array.isArray(parsed) ? parsed.map((item) => item.hex || "").filter(Boolean) : [];
  } catch {
    extra = [];
  }
  return [...new Set([brand.primary_color, brand.secondary_color, brand.accent_color, ...extra].filter((color): color is string => /^#[0-9a-f]{6}$/i.test(color || "")))];
}

function EditModal({
  qr,
  onClose,
  onSaved,
}: {
  qr: QRCode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [label, setLabel] = useState(qr.label);
  const [target, setTarget] = useState(qr.target_url);
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api(`/api/qrcodes/${qr.id}`, {
        method: "PATCH",
        body: { label, target_url: target },
      });
      notify("QR code updated.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal title="Edit QR code" onClose={onClose}>
      <form onSubmit={save}>
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="qr-edit-label">Label</FieldLabel>
          <Input id="qr-edit-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="qr-edit-target">Destination URL</FieldLabel>
          <Input id="qr-edit-target" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        {qr.dynamic && (
          <p className="text-xs text-muted-foreground">
            This is a dynamic code — the printed QR keeps working; only the
            destination changes.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}

export default function QRCodesPage() {
  const { notify } = useToast();
  const { brands, active } = useBrand();
  const { data, loading, reload } = useFetch<QRCode[]>("/api/qrcodes");
  const [editing, setEditing] = useState<QRCode | null>(null);
  const [deleting, setDeleting] = useState<QRCode | null>(null);
  const [form, setForm] = useState({
    label: "",
    target_url: "",
    company_id: active?.id ?? "",
    fill_color: active?.primary_color ?? "#000000",
    back_color: "#ffffff",
    dynamic: true,
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedBrand = brands.find((brand) => brand.id === form.company_id) ?? active;
  const colors = selectedBrand ? brandColors(selectedBrand) : ["#000000"];

  useEffect(() => {
    if (!form.company_id && active) {
      setForm((current) => ({
        ...current,
        company_id: active.id,
        fill_color: brandColors(active)[0] ?? active.primary_color,
      }));
    }
  }, [active, form.company_id]);

  function selectBrand(companyId: string) {
    const brand = brands.find((item) => item.id === companyId);
    setForm((current) => ({
      ...current,
      company_id: companyId,
      fill_color: brand ? brandColors(brand)[0] ?? brand.primary_color : current.fill_color,
    }));
  }

  const previewPath =
    form.target_url.length > 3
      ? `/api/qrcodes/preview.png?data=${encodeURIComponent(form.target_url)}` +
        `&fill_color=${encodeURIComponent(form.fill_color)}` +
        `&back_color=${encodeURIComponent(form.back_color)}`
      : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/qrcodes", { method: "POST", body: form });
      notify("QR code saved.");
      setForm({ ...form, label: "", target_url: "" });
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/qrcodes/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div>
      <PageHead
        title="QR Codes"
        subtitle="Create company-branded dynamic QR codes whose destination can change after printing."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Create a QR code</CardTitle></CardHeader>
          <CardContent>
          <form onSubmit={create}>
            <FieldGroup>
            <Field>
              <FieldLabel htmlFor="qr-label">Label *</FieldLabel>
              <Input id="qr-label"
                required
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qr-target">Target URL *</FieldLabel>
              <Input id="qr-target"
                required
                placeholder="https://…"
                value={form.target_url}
                onChange={(e) => set("target_url", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qr-company">Company brand</FieldLabel>
              <Select items={brands.map((brand) => ({ value: brand.id, label: brand.name }))} value={form.company_id || null} onValueChange={(value) => value && selectBrand(value)}>
                <SelectTrigger id="qr-company" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Brand color</FieldLabel>
              <ToggleGroup value={[form.fill_color]} onValueChange={(value) => value[0] && set("fill_color", value[0])} variant="outline" spacing={1} aria-label="QR brand color">
                {colors.map((color) => (
                  <ToggleGroupItem key={color} value={color} aria-label={`Use ${color}`} className="size-9 p-1">
                    <span className="size-5 border border-black/10" style={{ background: color }} aria-hidden="true" />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">Colors come from {selectedBrand?.name ?? "the selected company"} in Brand Center.</p>
            </Field>
            <div className="border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <strong className="text-foreground">Dynamic by default.</strong> The QR points to a permanent platform link. Edit the destination later and printed copies keep working.
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save QR code"}
            </Button>
            </FieldGroup>
          </form>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid min-h-64 place-items-center">
          {previewPath ? (
              <div className="text-center">
              <AuthImage path={previewPath} width={200} height={200} alt="QR preview" />
               <div className="mt-2 text-muted-foreground">
                Live preview
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">Enter a URL to preview the QR code.</div>
          )}
          </CardContent>
        </Card>
      </div>

      <h3 className="mt-6">Saved QR codes</h3>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <Empty icon={<QrCode />} message="No saved QR codes yet" hint="Create one above — it'll appear here with scan analytics." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.map((qr) => (
            <Card key={qr.id} className="text-center">
              <CardContent className="flex flex-col items-center gap-2">
              <AuthImage
                path={`/api/qrcodes/${qr.id}/image.png`}
                width={140}
                height={140}
                alt={qr.label}
              />
              <div className="font-semibold">{qr.label}</div>
              <div className="break-all text-xs text-muted-foreground">
                {qr.target_url}
              </div>
              <div className="flex justify-center gap-2">
                <Badge variant="info">{qr.scan_count} scans</Badge>
                {qr.dynamic && <Badge variant="secondary">dynamic</Badge>}
              </div>
              </CardContent>
              <CardFooter className="justify-center gap-2">
                <Button type="button" size="sm"
                  onClick={() =>
                    downloadFile(`/api/qrcodes/${qr.id}/image.png`, `${qr.label}.png`)
                  }
                >
                  <Download data-icon="inline-start" /> PNG
                </Button>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setEditing(qr)}
                >
                  <Pencil data-icon="inline-start" /> Edit
                </Button>
                <Button type="button" variant="destructive" size="sm"
                  onClick={() => setDeleting(qr)}
                >
                  <Trash2 data-icon="inline-start" /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <EditModal qr={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete QR code"
          message={`Delete the QR code “${deleting.label}”? Printed codes will stop working.`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await remove(deleting.id);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
