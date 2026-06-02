import { useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { BrandAsset, BrandKit } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  Loading,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";

function KitAssets({ kit, onClose }: { kit: BrandKit; onClose: () => void }) {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<BrandAsset[]>(
    `/api/branding/kits/${kit.id}/assets`,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", "logo");
    await api(`/api/branding/kits/${kit.id}/assets`, { method: "POST", form: fd });
    notify("Asset uploaded.");
    reload();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Modal title={`${kit.name} — assets`} onClose={onClose}>
      <button className="btn-primary" onClick={() => fileRef.current?.click()}>
        Upload asset
      </button>
      <input ref={fileRef} type="file" hidden onChange={upload} />
      <div style={{ marginTop: 14 }}>
        {loading ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty message="No brand assets yet." />
        ) : (
          <table>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>
                    <span className="badge">{a.category}</span>
                  </td>
                  <td className="muted">{bytes(a.size_bytes)}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        downloadFile(`/api/branding/assets/${a.id}/download`, a.name)
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
      </div>
    </Modal>
  );
}

function KitForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    guidelines_url: "",
    fonts: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title="New brand kit" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/api/branding/kits", { method: "POST", body: form });
          notify("Brand kit created.");
          onSaved();
          onClose();
        }}
      >
        <div className="field">
          <label>Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Guidelines URL</label>
          <input
            value={form.guidelines_url}
            onChange={(e) => set("guidelines_url", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Fonts</label>
          <input value={form.fonts} onChange={(e) => set("fonts", e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function BrandingPage() {
  const { data, loading, reload } = useFetch<BrandKit[]>("/api/branding/kits");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<BrandKit | null>(null);

  return (
    <div>
      <PageHead
        title="Brand Center"
        subtitle="Logos, guidelines, fonts and colours — all in one place."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New brand kit
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No brand kits yet. Create one to store guidelines and assets." />
      ) : (
        <div className="grid cols-3">
          {data.map((kit) => (
            <div className="card" key={kit.id}>
              <h3 style={{ marginTop: 0 }}>{kit.name}</h3>
              <div className="muted">{kit.description}</div>
              {kit.guidelines_url && (
                <div style={{ marginTop: 8 }}>
                  <a href={kit.guidelines_url} target="_blank" rel="noreferrer">
                    Brand guidelines ↗
                  </a>
                </div>
              )}
              <button
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setViewing(kit)}
              >
                Manage assets
              </button>
            </div>
          ))}
        </div>
      )}
      {creating && <KitForm onClose={() => setCreating(false)} onSaved={reload} />}
      {viewing && <KitAssets kit={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
