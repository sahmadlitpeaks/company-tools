import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleCheck, Clock3, Download, Flame, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, API_BASE_URL } from "../../api/client";
import type { TransferMeta } from "../../api/types";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PublicTransferPage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<TransferMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<TransferMeta>(`/api/public/transfers/${token}/meta`, { auth: false })
      .then(setMeta)
      .catch(() => setNotFound(true));
  }, [token]);

  async function download() {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/transfers/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || null }),
      });
      if (!res.ok) {
        let detail = "Download failed";
        try {
          detail = (await res.json()).detail ?? detail;
        } catch {
          /* ignore */
        }
        setError(detail);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta?.filename ?? "download";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const card = (title: React.ReactNode, children: React.ReactNode) => (
    <main className="grid min-h-dvh place-items-center bg-muted p-5">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  );

  if (notFound)
    return card(
      "Link not found",
      <p className="text-muted-foreground">This secure transfer doesn't exist.</p>,
    );
  if (!meta) return card("Secure transfer", <p className="text-muted-foreground">Loading…</p>);

  if (meta.status === "consumed")
    return card(
      <span className="flex items-center gap-2"><Flame aria-hidden="true" /> File no longer available</span>,
      <p className="text-muted-foreground">
        This file has already been downloaded or was revoked by the sender.
        Secure links are single-use.
      </p>,
    );
  if (meta.status === "expired")
    return card(
      <span className="flex items-center gap-2"><Clock3 aria-hidden="true" /> Link expired</span>,
      <p className="text-muted-foreground">
        This secure link has expired and the file has been deleted.
      </p>,
    );

  if (done)
    return card(
      <span className="flex items-center gap-2"><CircleCheck aria-hidden="true" /> Download started</span>,
      <p className="text-muted-foreground">
        {meta.filename} is downloading. {meta.one_time
          ? "This link has now been consumed and the file deleted from our servers."
          : "The secure link remains available until it expires or reaches its download limit."}
      </p>,
    );

  return card(
    "A file was shared with you",
    <>
      <div
        className="grid size-14 place-items-center bg-primary text-2xl text-primary-foreground"
      >
        <ShieldCheck aria-hidden="true" />
      </div>
      {meta.sender_name && (
        <p className="text-muted-foreground">from {meta.sender_name}</p>
      )}
      {meta.message && (
        <Alert><AlertDescription className="text-foreground">{meta.message}</AlertDescription></Alert>
      )}
      <div className="flex items-center justify-between gap-2">
        <strong>{meta.filename}</strong>
        <span className="text-muted-foreground">{fmtBytes(meta.size_bytes)}</span>
      </div>

      <form
        className="flex flex-col gap-4"
        aria-busy={isSubmitting || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        {meta.requires_password && (
          <Field>
            <FieldLabel htmlFor="transfer-password" className="flex items-center gap-2"><LockKeyhole aria-hidden="true" /> This file is password protected</FieldLabel>
            <Input id="transfer-password" aria-label="Enter password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <Button aria-label="Download" type="submit" className="w-full" disabled={isSubmitting}>
          {!isSubmitting && <Download data-icon="inline-start" />}
          {isSubmitting ? "Decrypting…" : "Download file"}
        </Button>
        <FieldDescription className="text-center">
          {meta.one_time ? <><Flame aria-hidden="true" /> This is a single-use link — the file is deleted after you download it.</> : <><ShieldCheck aria-hidden="true" /> This download is encrypted and access is tracked.</>}
        </FieldDescription>
      </form>
    </>,
  );
}
