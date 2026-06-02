import { useState } from "react";
import { api, apiUrl } from "../api/client";
import type { QRCode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "../components/ui";

export default function QRCodesPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<QRCode[]>("/api/qrcodes");
  const [form, setForm] = useState({
    label: "",
    target_url: "",
    fill_color: "#000000",
    back_color: "#ffffff",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const previewSrc =
    form.target_url.length > 3
      ? apiUrl(
          `/api/qrcodes/preview.png?data=${encodeURIComponent(form.target_url)}` +
            `&fill_color=${encodeURIComponent(form.fill_color)}` +
            `&back_color=${encodeURIComponent(form.back_color)}`,
        )
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
          {previewSrc ? (
            <div style={{ textAlign: "center" }}>
              <img src={previewSrc} width={200} height={200} alt="QR preview" />
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
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No saved QR codes yet." />
      ) : (
        <div className="grid cols-4">
          {data.map((qr) => (
            <div className="card" key={qr.id} style={{ textAlign: "center" }}>
              <img
                src={apiUrl(`/api/qrcodes/${qr.id}/image.png`)}
                width={140}
                height={140}
                alt={qr.label}
              />
              <div style={{ fontWeight: 600, marginTop: 8 }}>{qr.label}</div>
              <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {qr.target_url}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                <a
                  className="btn btn-sm"
                  href={apiUrl(`/api/qrcodes/${qr.id}/image.png`)}
                  download={`${qr.label}.png`}
                  style={{ flex: "0 0 auto" }}
                >
                  PNG
                </a>
                <button
                  className="btn-sm btn-danger"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => remove(qr.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
