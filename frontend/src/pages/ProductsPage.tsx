import { useRef, useState } from "react";
import { api, apiUrl } from "../api/client";
import type { Brochure, Product } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  Loading,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";

function Brochures({ product, onClose }: { product: Product; onClose: () => void }) {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<Brochure[]>(
    `/api/products/${product.id}/brochures`,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", file.name);
    await api(`/api/products/${product.id}/brochures`, { method: "POST", form: fd });
    notify("Brochure uploaded.");
    reload();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Modal title={`${product.name} — brochures`} onClose={onClose}>
      <button className="btn-primary" onClick={() => fileRef.current?.click()}>
        Upload brochure
      </button>
      <input ref={fileRef} type="file" hidden onChange={upload} />
      <div style={{ marginTop: 14 }}>
        {loading ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty message="No brochures yet." />
        ) : (
          <table>
            <tbody>
              {data.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.title}</td>
                  <td className="muted">{bytes(b.size_bytes)}</td>
                  <td>
                    <span className="badge">{b.download_count} downloads</span>
                  </td>
                  <td>
                    <a
                      className="btn btn-sm"
                      href={apiUrl(`/api/public/brochures/${b.id}/download`)}
                    >
                      Download
                    </a>
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

export default function ProductsPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<Product[]>("/api/products");
  const [viewing, setViewing] = useState<Product | null>(null);

  async function create() {
    const name = prompt("Product / service name");
    if (!name) return;
    await api("/api/products", { method: "POST", body: { name } });
    notify("Product created.");
    reload();
  }

  return (
    <div>
      <PageHead
        title="Products & Brochures"
        subtitle="Catalogue products and host downloadable brochures."
        action={
          <button className="btn-primary" onClick={create}>
            + New product
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No products yet." />
      ) : (
        <div className="grid cols-3">
          {data.map((p) => (
            <div className="card" key={p.id}>
              <h3 style={{ marginTop: 0 }}>{p.name}</h3>
              {p.sku && <div className="muted">SKU: {p.sku}</div>}
              <div className="muted" style={{ marginTop: 6 }}>
                {p.description}
              </div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setViewing(p)}
              >
                Brochures
              </button>
            </div>
          ))}
        </div>
      )}
      {viewing && <Brochures product={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
