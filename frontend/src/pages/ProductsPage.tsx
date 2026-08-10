import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, History, Package } from "lucide-react";
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
    <Card className="py-0">
      <CardHeader className="py-(--card-spacing)">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <CardTitle>{product.name}</CardTitle>
          {product.sku && <div className="text-sm text-muted-foreground">SKU: {product.sku}</div>}
        </div>
        <Button type="button"
          onClick={() => fileRef.current?.click()}
        >
          + Upload brochure
        </Button>
        <Input aria-label="Upload" ref={fileRef} type="file" hidden onChange={upload} />
      </div>
      {product.description && (
        <p className="text-muted-foreground">{product.description}</p>
      )}
      </CardHeader>

      <CardContent className={data && data.length > 0 ? "p-0" : undefined}>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon={<FileText />}
          message="No brochures yet"
          hint="Upload a PDF or document to share with customers."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brochure</TableHead>
              <TableHead className="text-right">Downloads</TableHead>
              <TableHead>Client sharing</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="max-w-[28rem] whitespace-normal">
                  <div className="flex items-center gap-3">
                    {isPdf(b) ? (
                      <PdfThumb
                        url={`/api/products/brochures/${b.id}/download`}
                        size={40}
                      />
                    ) : (
                      <span className="grid size-10 flex-none place-items-center bg-muted text-lg">
                        <FileText aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground" title={b.title}>{b.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {bytes(b.size_bytes)}
                        {b.version > 1 && ` · v${b.version}`}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.download_count}
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-2">
                    {isPdf(b) && (
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => setReading(b)}
                        title="Read as flipbook"
                      >
                        <BookOpen data-icon="inline-start" /> Read
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="outline"
                      onClick={() => setVersioning(b)}
                      title="Version history / upload new version"
                    >
                      <History data-icon="inline-start" /> v{b.version}
                    </Button>
                    <Button type="button" size="sm" variant="outline"
                      onClick={() =>
                        downloadFile(`/api/products/brochures/${b.id}/download`, b.title)
                      }
                    >
                      Download
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </CardContent>

      {reading && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 grid place-items-center bg-background/80" role="status" aria-live="polite">
              Loading document viewer…
            </div>
          }
        >
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
    </Card>
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
          <Button type="button" onClick={() => setCreating(true)}>
            + New product
          </Button>
        }
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon={<Package />}
          message="No products yet"
          hint="Add a product or service, then attach downloadable brochures."
          action={
            <Button type="button" onClick={() => setCreating(true)}>
              + New product
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Product selector */}
          <ToggleGroup value={[selectedId ?? ""]} onValueChange={(value) => value[0] && setSelectedId(value[0])} className="flex flex-wrap justify-start">
            {data.map((p) => {
              return (
                <ToggleGroupItem aria-label={`Select ${p.name}`}
                  key={p.id}
                  value={p.id}
                >
                  {p.name}
                  {p.sku && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {p.sku}
                    </span>
                  )}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          {/* Selected product's brochures */}
          {selected ? (
            <BrochurePanel key={selected.id} product={selected} />
          ) : (
            <Card><CardContent><Empty message="Select a product to see its brochures." /></CardContent></Card>
          )}
        </div>
      )}

      {creating && (
        <PromptModal
          title="New product"
          label="Product / service name"
          placeholder="e.g. Company Setup"
          onConfirm={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
