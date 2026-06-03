import { useState } from "react";
import { api, downloadFile } from "../api/client";
import type { QRCode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  AuthImage,
  ConfirmModal,
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
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit QR code" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label>Destination URL</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        {qr.dynamic && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            This is a dynamic code — the printed QR keeps working; only the
            destination changes.
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
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

  const previewPath =
    form.target_url.length > 3
      ? `/api/qrcodes/preview.png?data=${encodeURIComponent(form.target_url)}` +
        `&fill_color=${encodeURIComponent(form.fill_color)}` +
        `&back_color=${encodeURIComponent(form.back_color)}`
      : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/qrcodes", { method: "POST", body: form });
    notify("QR code saved.");
    setForm({ ...form, label: "", target_url: "" });
    reload();
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
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Create a QR code</h3>
          <form onSubmit={create}>
            <div className="field">
              <label>Label *</label>
              <input
                required
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Target URL *</label>
              <input
                required
                placeholder="https://…"
                value={form.target_url}
                onChange={(e) => set("target_url", e.target.value)}
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Foreground</label>
                <input
                  type="color"
                  value={form.fill_color}
                  onChange={(e) => set("fill_color", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Background</label>
                <input
                  type="color"
                  value={form.back_color}
                  onChange={(e) => set("back_color", e.target.value)}
                />
              </div>
            </div>
            <button className="btn-primary">Save QR code</button>
          </form>
        </div>
        <div className="card" style={{ display: "grid", placeItems: "center" }}>
          {previewPath ? (
            <div style={{ textAlign: "center" }}>
              <AuthImage path={previewPath} width={200} height={200} alt="QR preview" />
              <div className="muted" style={{ marginTop: 8 }}>
                Live preview
              </div>
            </div>
          ) : (
            <div className="muted">Enter a URL to preview the QR code.</div>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Saved QR codes</h3>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <Empty icon="▣" message="No saved QR codes yet" hint="Create one above — it'll appear here with scan analytics." />
      ) : (
        <div className="grid cols-4">
          {data.map((qr) => (
            <div className="card" key={qr.id} style={{ textAlign: "center" }}>
              <AuthImage
                path={`/api/qrcodes/${qr.id}/image.png`}
                width={140}
                height={140}
                alt={qr.label}
              />
              <div style={{ fontWeight: 600, marginTop: 8 }}>{qr.label}</div>
              <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {qr.target_url}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: "center" }}>
                <span className="badge blue">{qr.scan_count} scans</span>
                {qr.dynamic && <span className="badge">dynamic</span>}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                <button
                  className="btn btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() =>
                    downloadFile(`/api/qrcodes/${qr.id}/image.png`, `${qr.label}.png`)
                  }
                >
                  PNG
                </button>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setEditing(qr)}
                >
                  Edit
                </button>
                <button
                  className="btn-sm btn-danger"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setDeleting(qr)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <EditModal qr={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {deleting && (
        <ConfirmModal
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
