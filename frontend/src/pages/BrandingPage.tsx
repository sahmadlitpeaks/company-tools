import { useEffect, useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { BrandAsset, BrandKit } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";

function KitPanel({ kit }: { kit: BrandKit }) {
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
    try {
      await api(`/api/branding/kits/${kit.id}/assets`, { method: "POST", form: fd });
      notify("Asset uploaded.");
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="card">
      <div className="spread mb-3">
        <div>
          <h3 className="m-0">{kit.name}</h3>
          {kit.description && <div className="muted text-sm">{kit.description}</div>}
        </div>
        <button className="btn-primary flex-none" onClick={() => fileRef.current?.click()}>
          + Upload asset
        </button>
        <input ref={fileRef} type="file" hidden onChange={upload} />
      </div>
      {kit.guidelines_url && (
        <div className="mb-3">
          <a href={kit.guidelines_url} target="_blank" rel="noreferrer">
            Brand guidelines ↗
          </a>
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="🎨"
          message="No brand assets yet"
          hint="Upload logos, fonts or colour swatches for this kit."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="font-semibold">{a.name}</td>
                <td>
                  <span className="badge">{a.category}</span>
                </td>
                <td className="muted">{bytes(a.size_bytes)}</td>
                <td className="text-right">
                  <button
                    className="btn-sm"
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
  );
}

function KitForm({ onClose, onSaved }: { onClose: () => void; onSaved: (kit: BrandKit) => void }) {
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
          const kit = await api<BrandKit>("/api/branding/kits", {
            method: "POST",
            body: form,
          });
          notify("Brand kit created.");
          onSaved(kit);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && data && data.length > 0) setSelectedId(data[0].id);
  }, [data, selectedId]);

  const selected = data?.find((k) => k.id === selectedId) ?? null;

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
        <ListSkeleton rows={5} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="🎨"
          message="No brand kits yet"
          hint="Create a kit to store guidelines, logos and downloadable assets."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New brand kit
            </button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
          <div className="card !p-2">
            {data.map((kit) => (
              <button
                key={kit.id}
                onClick={() => setSelectedId(kit.id)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-lg border-0 px-3 py-2.5 text-left ${
                  kit.id === selectedId
                    ? "bg-brand-50 text-brand-800"
                    : "bg-transparent hover:bg-slate-50"
                }`}
              >
                <span className="font-semibold">{kit.name}</span>
                {kit.description && (
                  <span className="truncate text-xs text-ink-muted">{kit.description}</span>
                )}
              </button>
            ))}
          </div>
          {selected ? (
            <KitPanel key={selected.id} kit={selected} />
          ) : (
            <div className="card">
              <Empty message="Select a brand kit to manage its assets." />
            </div>
          )}
        </div>
      )}

      {creating && (
        <KitForm
          onClose={() => setCreating(false)}
          onSaved={(kit) => {
            reload();
            setSelectedId(kit.id);
          }}
        />
      )}
    </div>
  );
}
