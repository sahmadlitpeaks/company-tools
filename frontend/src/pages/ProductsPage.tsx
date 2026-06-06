import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BookOpen, History } from "lucide-react";
import { api, downloadFile } from "../api/client";
import ShareControl from "../components/ShareControl";
import PdfThumb from "../components/PdfThumb";
import VersionsModal from "../components/VersionsModal";
import type { Brochure, Product } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ListSkeleton,
  PageHead,
  PromptModal,
  bytes,
  useToast,
} from "../components/ui";

const FlipbookModal = lazy(() => import("../components/FlipbookModal"));

function isPdf(b: Brochure): boolean {
  return (
    b.content_type === "application/pdf" ||
    b.file_path.toLowerCase().endsWith(".pdf") ||
    b.title.toLowerCase().endsWith(".pdf")
  );
}

function BrochurePanel({ product }: { product: Product }) {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<Brochure[]>(
    `/api/products/${product.id}/brochures`,
  );
  const [reading, setReading] = useState<Brochure | null>(null);
  const [versioning, setVersioning] = useState<Brochure | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", file.name);
    try {
      await api(`/api/products/${product.id}/brochures`, { method: "POST", form: fd });
      notify("Brochure uploaded.");
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
          <h3 className="m-0">{product.name}</h3>
          {product.sku && <div className="muted text-sm">SKU: {product.sku}</div>}
        </div>
        <button
          className="btn-primary flex-none"
          onClick={() => fileRef.current?.click()}
        >
          + Upload brochure
        </button>
        <input ref={fileRef} type="file" hidden onChange={upload} />
      </div>
      {product.description && (
        <p className="muted mt-0">{product.description}</p>
      )}

      {loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="📄"
          message="No brochures yet"
          hint="Upload a PDF or document to share with customers."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Brochure</th>
              <th>Downloads</th>
              <th>Client sharing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id}>
                <td>
                  <div className="flex items-center gap-3">
                    {isPdf(b) ? (
                      <PdfThumb
                        url={`/api/products/brochures/${b.id}/download`}
                        size={40}
                      />
                    ) : (
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-slate-100 text-lg">
                        📄
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{b.title}</div>
                      <div className="muted text-xs">
                        {bytes(b.size_bytes)}
                        {b.version > 1 && ` · v${b.version}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge">{b.download_count}</span>
                </td>
                <td>
                  <ShareControl
                    base={`/api/products/brochures/${b.id}`}
                    name={b.title}
                    isPublic={b.is_public}
                    shareCode={b.share_code}
                    expiresAt={b.share_expires_at}
                    requireLead={b.share_require_lead}
                    hasPasscode={b.share_has_passcode}
                    onChange={() => reload()}
                  />
                </td>
                <td className="text-right">
                  <div className="inline-flex items-center gap-2">
                    {isPdf(b) && (
                      <button
                        className="btn-sm inline-flex items-center gap-1.5"
                        onClick={() => setReading(b)}
                        title="Read as flipbook"
                      >
                        <BookOpen size={14} /> Read
                      </button>
                    )}
                    <button
                      className="btn-sm inline-flex items-center gap-1.5"
                      onClick={() => setVersioning(b)}
                      title="Version history / upload new version"
                    >
                      <History size={14} /> v{b.version}
                    </button>
                    <button
                      className="btn-sm"
                      onClick={() =>
                        downloadFile(`/api/products/brochures/${b.id}/download`, b.title)
                      }
                    >
                      Download
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reading && (
        <Suspense fallback={null}>
          <FlipbookModal
            url={`/api/products/brochures/${reading.id}/download`}
            name={reading.title}
            onClose={() => setReading(null)}
          />
        </Suspense>
      )}

      {versioning && (
        <VersionsModal
          base={`/api/products/brochures/${versioning.id}`}
          name={versioning.title}
          currentVersion={versioning.version}
          onClose={() => setVersioning(null)}
          onReplaced={reload}
        />
      )}
    </div>
  );
}

export default function ProductsPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<Product[]>("/api/products");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Auto-select the first product so brochures are visible immediately.
  useEffect(() => {
    if (!selectedId && data && data.length > 0) setSelectedId(data[0].id);
  }, [data, selectedId]);

  const selected = data?.find((p) => p.id === selectedId) ?? null;

  async function create(name: string) {
    const p = await api<Product>("/api/products", { method: "POST", body: { name } });
    notify("Product created.");
    await reload();
    setSelectedId(p.id);
  }

  return (
    <div>
      <PageHead
        title="Products & Brochures"
        subtitle="Catalogue products and host downloadable brochures."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New product
          </button>
        }
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="📦"
          message="No products yet"
          hint="Add a product or service, then attach downloadable brochures."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New product
            </button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[210px_1fr]">
          {/* Product list */}
          <div className="card !p-2">
            {data.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-lg border-0 px-3 py-2.5 text-left ${
                  p.id === selectedId
                    ? "bg-brand-50 text-brand-800"
                    : "bg-transparent hover:bg-slate-50"
                }`}
              >
                <span className="font-semibold">{p.name}</span>
                {p.sku && <span className="text-xs text-ink-muted">SKU: {p.sku}</span>}
              </button>
            ))}
          </div>

          {/* Selected product's brochures */}
          {selected ? (
            <BrochurePanel key={selected.id} product={selected} />
          ) : (
            <div className="card">
              <Empty message="Select a product to see its brochures." />
            </div>
          )}
        </div>
      )}

      {creating && (
        <PromptModal
          title="New product"
          label="Product / service name"
          placeholder="e.g. Company Setup"
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
