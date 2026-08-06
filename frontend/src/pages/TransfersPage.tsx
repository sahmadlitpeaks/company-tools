import { useRef, useState } from "react";
import { api } from "../api/client";
import type { SecureTransfer, SecureTransferCreated } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmDialog,
  Empty,
  ListSkeleton,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Clock3, Flame, KeyRound, LockKeyhole, Mail, Paperclip, ShieldCheck, Upload } from "lucide-react";

function statusBadge(t: SecureTransfer) {
  if (t.is_consumed)
    return <Badge variant="secondary">{t.one_time ? "downloaded" : "revoked"}</Badge>;
  if (t.expires_at && new Date(t.expires_at) < new Date())
    return <Badge variant="secondary">expired</Badge>;
  return <Badge variant="success">active</Badge>;
}

function ShareResult({ url, onClose }: { url: string; onClose: () => void }) {
  const { notify } = useToast();
  return (
    <Modal title="Secure link created" onClose={onClose}>
      <p className="text-muted-foreground">
        Share this secure link with the recipient. For security it's shown
        <strong> only once</strong> — it can't be retrieved later.
      </p>
      <Field><Input aria-label="Url" readOnly value={url} onFocus={(e) => e.target.select()} /></Field>
      <div className="flex justify-end">
        <Button type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            notify("Link copied.");
          }}
        >
          Copy link
        </Button>
      </div>
    </Modal>
  );
}

export default function TransfersPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<SecureTransfer[]>("/api/transfers");
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    recipient_email: "",
    message: "",
    password: "",
    one_time: true,
    expires_in_hours: 72,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<SecureTransfer | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = selectedFile;
    if (!file) {
      notify("Choose a file to send.", "error");
      return;
    }
    setIsSubmitting(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("recipient_email", form.recipient_email);
    fd.append("message", form.message);
    if (form.password) fd.append("password", form.password);
    fd.append("one_time", String(form.one_time));
    fd.append("expires_in_hours", String(form.expires_in_hours));
    try {
      const res = await api<SecureTransferCreated>("/api/transfers", {
        method: "POST",
        form: fd,
      });
      setShareUrl(res.share_url);
      notify(res.email_sent ? "Sent — recipient emailed." : "Secure link created.");
      setForm({ ...form, recipient_email: "", message: "", password: "" });
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function revoke(t: SecureTransfer) {
    await api(`/api/transfers/${t.id}`, { method: "DELETE" });
    notify("File revoked and deleted.");
    reload();
  }

  return (
    <div>
      <PageHead
        title="Secure Transfers"
        subtitle="A private alternative to public file-transfer tools, with encryption, expiry, passwords, and optional burn-after-read."
      />
      {data?.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card size="sm"><CardContent><div className="text-2xl font-semibold tabular-nums">{data.filter((transfer) => !transfer.is_consumed && (!transfer.expires_at || new Date(transfer.expires_at) > new Date())).length}</div><div className="text-xs text-muted-foreground">Active secure links</div></CardContent></Card>
          <Card size="sm"><CardContent><div className="text-2xl font-semibold tabular-nums">{data.reduce((sum, transfer) => sum + transfer.download_count, 0)}</div><div className="text-xs text-muted-foreground">Completed downloads</div></CardContent></Card>
          <Card size="sm"><CardContent><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck /> Encrypted at rest</div><div className="mt-1 text-xs text-muted-foreground">Keys remain in recipient links</div></CardContent></Card>
        </div>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Send a file securely</CardTitle></CardHeader>
          <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
            <Field>
              <FieldLabel htmlFor="transfer-file">File *</FieldLabel>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setSelectedFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className="h-auto w-full flex-col gap-1 border-dashed p-6 text-center"
              >
                {selectedFile ? <Paperclip data-icon="inline-start" aria-hidden="true" /> : <Upload data-icon="inline-start" aria-hidden="true" />}
                <span className="font-semibold">
                  {selectedFile?.name || "Drop a file here or click to browse"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {selectedFile ? `${bytes(selectedFile.size)} · ready to encrypt` : "Encrypted on upload · up to 100 MB"}
                </span>
              </Button>
              <Input id="transfer-file"
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-email">Recipient email *</FieldLabel>
              <Input id="transfer-email"
                required
                type="email"
                value={form.recipient_email}
                onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-message">Message (optional)</FieldLabel>
              <Textarea id="transfer-message"
                rows={2}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="transfer-password">Password (optional)</FieldLabel>
                <Input id="transfer-password"
                  type="password"
                  placeholder="extra protection"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transfer-expiry">Expires in</FieldLabel>
                <Select
                  items={[
                    { value: "1", label: "1 hour" },
                    { value: "24", label: "24 hours" },
                    { value: "72", label: "3 days" },
                    { value: "168", label: "7 days" },
                    { value: "0", label: "No expiry" },
                  ]}
                  value={String(form.expires_in_hours)}
                  onValueChange={(value) =>
                    setForm({ ...form, expires_in_hours: Number(value ?? "0") })
                  }
                >
                  <SelectTrigger id="transfer-expiry" aria-label="Expires in" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="72">3 days</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                    <SelectItem value="0">No expiry</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <Field orientation="horizontal">
                <Checkbox
                  id="transfer-one-time"
                  checked={form.one_time}
                  onCheckedChange={(checked) => setForm({ ...form, one_time: checked === true })}
                />
                <FieldLabel htmlFor="transfer-one-time">Delete file after first download (burn-after-read)</FieldLabel>
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              <LockKeyhole data-icon="inline-start" /> {isSubmitting ? "Encrypting…" : "Encrypt and create link"}
            </Button>
            </FieldGroup>
          </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
          <CardContent><ul className="flex flex-col gap-3">
            {[
              { icon: LockKeyhole, text: <>Your file is <strong>encrypted</strong> the moment it's uploaded.</> },
              { icon: KeyRound, text: <>The decryption key lives only in the share link — never in our database.</> },
              { icon: Mail, text: <>We email the link to the recipient (or you copy &amp; send it).</> },
              { icon: Flame, text: <>On download it's decrypted and, by default, <strong>permanently deleted</strong>.</> },
              { icon: Clock3, text: <>Links also self-expire after the window you choose.</> },
            ].map(({ icon: StepIcon, text }) => (
              <li key={StepIcon.displayName} className="flex gap-3">
                <span className="grid size-8 flex-none place-items-center bg-muted">
                  <StepIcon aria-hidden="true" />
                </span>
                <span className="pt-1 text-sm text-muted-foreground">{text}</span>
              </li>
            ))}
          </ul></CardContent>
        </Card>
      </div>

      <h3 className="mt-6">Sent files</h3>
      {loading ? (
        <ListSkeleton rows={4} />
      ) : !data || data.length === 0 ? (
        <Empty icon={<LockKeyhole />} message="No secure transfers yet" hint="Send an encrypted, single-use file using the form above." />
      ) : (
        <Card className="py-0"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
                <TableHead>File</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Protection</TableHead>
                <TableHead className="text-right">Downloads</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-[28rem] whitespace-normal">
                    <span className="block truncate font-semibold" title={t.filename}>{t.filename}</span>
                    <div className="font-normal text-muted-foreground">
                      {bytes(t.size_bytes)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.recipient_email}
                    {t.email_sent && <Badge variant="info" className="ml-2">emailed</Badge>}
                  </TableCell>
                  <TableCell>
                    {t.has_password && <Badge variant="secondary">password</Badge>}{" "}
                    {t.one_time && <Badge variant="secondary">one-time</Badge>}
                  </TableCell>
                   <TableCell className="text-right tabular-nums">{t.download_count}</TableCell>
                  <TableCell>{statusBadge(t)}</TableCell>
                  <TableCell>
                    {!t.is_consumed && (
                      <Button type="button" variant="destructive" size="sm"
                        onClick={() => setRevoking(t)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {shareUrl && <ShareResult url={shareUrl} onClose={() => setShareUrl(null)} />}
      {revoking && (
        <ConfirmDialog
          title="Revoke transfer"
          message={`Revoke and permanently delete the file sent to ${revoking.recipient_email}? The share link will stop working immediately.`}
          confirmLabel="Revoke & delete"
          danger
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
