import { useState } from "react";
import {
  BookOpen,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  KeyRound,
  Lock,
  QrCode,
  UserPlus,
} from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { SharedDoc } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ErrorState,
  ListSkeleton,
  MetricCard,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SharedPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useFetch<SharedDoc[]>("/api/shares");
  const [qr, setQr] = useState<SharedDoc | null>(null);

  const totalOpens = data?.reduce((s, d) => s + d.opens, 0) ?? 0;
  const totalDownloads = data?.reduce((s, d) => s + d.downloads, 0) ?? 0;

  async function revoke(d: SharedDoc) {
    const path =
      d.kind === "brochure"
        ? `/api/products/brochures/${d.id}/unshare`
        : `/api/assets/${d.id}/unshare`;
    await api(path, { method: "POST" });
    notify("Link revoked — now private.");
    reload();
  }

  function copy(url: string) {
    navigator.clipboard?.writeText(url);
    notify("Public link copied.");
  }

  return (
    <div>
      <PageHead
        title="Shared with clients"
        subtitle="Every brochure and asset you've published, with live open analytics."
      />

      {!loading && !error && (data?.length ?? 0) > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <MetricCard value={data!.length} label="Active shares" />
          <MetricCard value={totalOpens} label="Total opens" />
          <MetricCard value={totalDownloads} label="Total downloads" />
        </div>
      )}

      <Card className="py-0">
        <CardContent className="p-0">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (data?.length ?? 0) === 0 ? (
          <Empty
            icon={<ExternalLink size={28} />}
            message="Nothing shared yet"
            hint="Use the Share button on a brochure or marketing asset to publish it."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Controls</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Downloads</TableHead>
                <TableHead>Last opened</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.map((d) => (
                <TableRow key={`${d.kind}-${d.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 flex-none place-items-center bg-primary text-primary-foreground">
                        {d.kind === "brochure" ? (
                          <BookOpen size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                      </span>
                      <div className="min-w-0">
                         <div className="truncate font-semibold" title={d.title}>{d.title}</div>
                        <code className="text-xs text-muted-foreground">/s/{d.share_code}</code>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {d.expires_at && (
                        <Badge variant="warning"
                          title={`Expires ${new Date(d.expires_at).toLocaleString()}`}
                        >
                          <Clock size={11} /> Expires
                        </Badge>
                      )}
                      {d.has_passcode && (
                        <Badge variant="info">
                          <KeyRound size={11} /> Passcode
                        </Badge>
                      )}
                      {d.require_lead && (
                        <Badge variant="secondary">
                          <UserPlus size={11} /> Lead gate
                        </Badge>
                      )}
                      {!d.expires_at && !d.has_passcode && !d.require_lead && (
                        <span className="text-xs text-muted-foreground">Open link</span>
                      )}
                    </div>
                  </TableCell>
                   <TableCell className="text-right tabular-nums">
                     <span className="inline-flex items-center gap-1"><Eye size={14} /> {d.opens}</span>
                  </TableCell>
                   <TableCell className="text-right tabular-nums">
                     {d.downloads}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.last_opened
                      ? new Date(d.last_opened).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="icon-sm"
                        title="QR code"
                        aria-label="QR code"
                        onClick={() => setQr(d)}
                      >
                        <QrCode size={14} />
                      </Button>
                      <Button type="button" variant="outline" size="icon-sm"
                        title="Copy link"
                        aria-label="Copy link"
                        onClick={() => copy(d.share_url)}
                      >
                        <Copy size={14} />
                      </Button>
                      <a
                        href={d.public_url}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                        title="Open public page"
                        aria-label="Open public page"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <Button type="button" variant="destructive" size="sm"
                        onClick={() => revoke(d)}
                      >
                        <Lock size={14} /> Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

      {qr && (
        <Modal title={`QR — ${qr.title}`} onClose={() => setQr(null)} maxWidth={360}>
          <div className="text-center">
            <img
              src={apiUrl(
                `/api/public/qr.png?data=${encodeURIComponent(qr.share_url)}`,
              )}
              alt="QR code"
              width={220}
              height={220}
              className="mx-auto border border-border bg-card p-2"
            />
            <code className="mt-3 block text-sm">{qr.share_url}</code>
            <Button type="button" variant="outline" className="mt-3" onClick={() => copy(qr.share_url)}>
              Copy link
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
