import { useState } from "react";
import { QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, downloadFile } from "../api/client";
import type { QRCode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  AuthImage,
  ConfirmDialog,
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";

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
  const { data, loading, reload } = useFetch<QRCode[]>("/api/qrcodes");
  const [editing, setEditing] = useState<QRCode | null>(null);
  const [deleting, setDeleting] = useState<QRCode | null>(null);
  const [form, setForm] = useState({
    label: "",
    target_url: "",
    fill_color: "#000000",
    back_color: "#ffffff",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        subtitle="Generate QR codes for products, links and print collateral."
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
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="qr-foreground">Foreground</FieldLabel>
                <Input id="qr-foreground"
                  type="color"
                  value={form.fill_color}
                  onChange={(e) => set("fill_color", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="qr-background">Background</FieldLabel>
                <Input id="qr-background"
                  type="color"
                  value={form.back_color}
                  onChange={(e) => set("back_color", e.target.value)}
                />
              </Field>
            </FieldGroup>
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
                <Button type="button" variant="outline" size="sm"
                  onClick={() =>
                    downloadFile(`/api/qrcodes/${qr.id}/image.png`, `${qr.label}.png`)
                  }
                >
                  PNG
                </Button>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setEditing(qr)}
                >
                  Edit
                </Button>
                <Button type="button" variant="destructive" size="sm"
                  onClick={() => setDeleting(qr)}
                >
                  Delete
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
