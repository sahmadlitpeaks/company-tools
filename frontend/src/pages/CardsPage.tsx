import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { DigitalCard, Lead } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import {
  AuthImage,
  ConfirmDialog,
  Empty,
  ErrorBox,
  ListSkeleton,
  Loading,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useFetch } from "../hooks/useApi";

const PUBLIC_ORIGIN = window.location.origin;

function CardForm({
  card,
  onClose,
  onSaved,
}: {
  card?: DigitalCard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { brands, active } = useBrand();
  const { notify } = useToast();
  const initialBrand = brands.find((brand) => brand.id === card?.company_id) ?? active;
  const [form, setForm] = useState({
    company_id: card?.company_id ?? initialBrand?.id ?? "",
    company: card?.company ?? initialBrand?.name ?? "",
    full_name: card?.full_name ?? user?.display_name ?? "",
    title: card?.title ?? user?.job_title ?? "",
    email: card?.email ?? user?.email ?? "",
    phone: card?.phone ?? user?.business_phone ?? user?.mobile_phone ?? "",
    whatsapp: card?.whatsapp ?? "",
    website: card?.website ?? initialBrand?.website ?? "",
    linkedin: card?.linkedin ?? "",
    address: card?.address ?? initialBrand?.address ?? "",
    bio: card?.bio ?? "",
    accent_color: card?.accent_color ?? initialBrand?.primary_color ?? "#facc15",
    lead_capture_enabled: card?.lead_capture_enabled ?? true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function selectBrand(companyId: string) {
    const brand = brands.find((item) => item.id === companyId);
    setForm((current) => ({
      ...current,
      company_id: companyId,
      company: brand?.name ?? current.company,
      website: current.website || brand?.website || "",
      address: current.address || brand?.address || "",
      accent_color: brand?.primary_color ?? current.accent_color,
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.full_name.trim()) {
      setNameError("Full name is required.");
      return;
    }
    setNameError(null);
    setIsSubmitting(true);
    try {
      await api(card ? `/api/cards/${card.id}` : "/api/cards", {
        method: card ? "PATCH" : "POST",
        body: { ...form, company_id: form.company_id || null },
      });
      notify(card ? "Digital card updated." : "Digital card created.");
      onSaved();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={card ? `Edit ${card.full_name}` : "New digital card"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="card-company">Company</FieldLabel>
            <Select
              items={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              value={form.company_id || null}
              onValueChange={(value) => value && selectBrand(value)}
            >
              <SelectTrigger id="card-company" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <FieldDescription>The company name and brand color stay connected to this card.</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(nameError) || undefined}>
            <FieldLabel htmlFor="card-full-name">Full name *</FieldLabel>
            <Input id="card-full-name" value={form.full_name} aria-invalid={Boolean(nameError) || undefined}
              onChange={(event) => { set("full_name", event.target.value); if (nameError) setNameError(null); }} />
            {nameError ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="card-title">Title</FieldLabel><Input id="card-title" value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="card-email">Email</FieldLabel><Input id="card-email" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="card-phone">Phone</FieldLabel><Input id="card-phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="card-whatsapp">WhatsApp</FieldLabel><Input id="card-whatsapp" value={form.whatsapp} onChange={(event) => set("whatsapp", event.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="card-website">Website</FieldLabel><Input id="card-website" value={form.website} onChange={(event) => set("website", event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="card-linkedin">LinkedIn</FieldLabel><Input id="card-linkedin" value={form.linkedin} onChange={(event) => set("linkedin", event.target.value)} /></Field>
          </div>
          <Field><FieldLabel htmlFor="card-address">Address</FieldLabel><Input id="card-address" value={form.address} onChange={(event) => set("address", event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="card-bio">Short introduction</FieldLabel><Textarea id="card-bio" rows={3} value={form.bio} onChange={(event) => set("bio", event.target.value)} /></Field>
          <Field orientation="horizontal">
            <Switch id="card-lead-capture" checked={form.lead_capture_enabled} onCheckedChange={(checked) => set("lead_capture_enabled", checked)} />
            <div>
              <FieldLabel htmlFor="card-lead-capture">Capture visitor details</FieldLabel>
              <FieldDescription>Show a contact form below the public card.</FieldDescription>
            </div>
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : card ? "Save changes" : "Create card"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoButton({ card, onDone }: { card: DigitalCard; onDone: () => void }) {
  const { notify } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      await api(`/api/cards/${card.id}/photo`, { method: "POST", form: body });
      notify("Photo updated.");
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed", "error");
    }
    if (ref.current) ref.current.value = "";
  }
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.click()}>
        <ImagePlus data-icon="inline-start" /> Photo
      </Button>
      <Input aria-label={`Upload photo for ${card.full_name}`} ref={ref} type="file" accept="image/*" hidden onChange={upload} />
    </>
  );
}

function DownloadModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { notify } = useToast();
  const safe = card.slug || "card";
  const items = [
    { label: "Contact file (vCard)", hint: "Import into phone or Outlook contacts", path: `/api/cards/${card.id}/vcard`, file: `${safe}.vcf` },
    { label: "QR code (PNG)", hint: "Square QR image for print", path: `/api/cards/${card.id}/qr.png`, file: `${safe}-qr.png` },
    { label: "Card image (PNG)", hint: "Share the complete card as an image", path: `/api/cards/${card.id}/card.png`, file: `${safe}.png` },
    { label: "Print-ready card (PDF)", hint: "Use for printing and approvals", path: `/api/cards/${card.id}/card.pdf`, file: `${safe}.pdf` },
  ];
  return (
    <Modal title={`Download — ${card.full_name}`} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Button key={item.label} type="button" variant="outline" className="h-auto w-full justify-start p-3 text-left"
            onClick={() => downloadFile(item.path, item.file).catch(() => notify("Download failed", "error"))}>
            <Download data-icon="inline-start" />
            <span><span className="block font-semibold">{item.label}</span><span className="block text-xs text-muted-foreground">{item.hint}</span></span>
          </Button>
        ))}
      </div>
    </Modal>
  );
}

function LeadsModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { data, loading } = useFetch<Lead[]>(`/api/cards/${card.id}/leads`);
  return (
    <Modal title={`Leads — ${card.full_name}`} onClose={onClose}>
      {loading ? <Loading /> : !data?.length ? <Empty message="No leads captured yet." /> : (
        <TableSurface><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
          <TableBody>{data.map((lead) => <TableRow key={lead.id}><TableCell className="font-semibold">{lead.name}</TableCell><TableCell><div>{lead.email}</div><div className="text-muted-foreground">{lead.phone}</div></TableCell><TableCell className="max-w-80 whitespace-normal text-muted-foreground"><p className="line-clamp-3">{lead.message ?? "—"}</p></TableCell></TableRow>)}</TableBody>
        </Table></TableSurface>
      )}
    </Modal>
  );
}

export default function CardsPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useFetch<DigitalCard[]>("/api/cards");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DigitalCard | null>(null);
  const [leadsFor, setLeadsFor] = useState<DigitalCard | null>(null);
  const [downloadFor, setDownloadFor] = useState<DigitalCard | null>(null);
  const [deleting, setDeleting] = useState<DigitalCard | null>(null);

  async function remove(card: DigitalCard) {
    await api(`/api/cards/${card.id}`, { method: "DELETE" });
    notify("Card deleted.");
    reload();
  }
  function copyLink(card: DigitalCard) {
    void navigator.clipboard.writeText(`${PUBLIC_ORIGIN}/c/${card.slug}`);
    notify("Share link copied to clipboard.");
  }

  return (
    <div>
      <PageHead title="Digital Cards" subtitle="Create polished, shareable contact cards with downloads, QR codes, and lead capture."
        action={<Button type="button" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New card</Button>} />
      {loading ? <ListSkeleton rows={4} /> : error ? <ErrorBox message={error} /> : !data?.length ? (
        <Empty icon={<CreditCard />} message="No digital cards yet" hint="Create a branded card that works on mobile and can capture leads."
          action={<Button type="button" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New card</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((card) => (
            <Card key={card.id} className="overflow-hidden py-0">
              <div className="h-1.5" style={{ background: card.accent_color }} aria-hidden="true" />
              <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-4 pt-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden border bg-muted text-sm font-semibold">
                    {card.photo_url ? <AuthImage path={card.photo_url} alt="" width={48} height={48} style={{ width: 48, height: 48, objectFit: "cover" }} /> : card.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{card.full_name}</CardTitle>
                    <div className="truncate text-sm text-muted-foreground">{card.title || "No title"}</div>
                    <div className="truncate text-xs font-medium" style={{ color: card.accent_color }}>{card.company}</div>
                  </div>
                </div>
                <AuthImage alt={`${card.full_name} QR code`} width={64} height={64} path={`/api/cards/${card.id}/qr.png`} style={{ border: "1px solid var(--border)" }} />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {card.bio ? <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{card.bio}</p> : <p className="min-h-10 text-sm text-muted-foreground">Add an introduction to make this card more personal.</p>}
                <div className="border bg-muted/25 px-3 py-2 text-xs text-muted-foreground"><code>/c/{card.slug}</code></div>
              </CardContent>
              <CardFooter className="grid grid-cols-2 gap-2 border-t bg-muted/20 py-3">
                <a className={buttonVariants({ size: "sm" })} href={`/c/${card.slug}`} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" /> View card</a>
                <Button type="button" variant="outline" size="sm" onClick={() => setDownloadFor(card)}><Download data-icon="inline-start" /> Download</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => copyLink(card)}><Copy data-icon="inline-start" /> Copy link</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(card)}><Pencil data-icon="inline-start" /> Edit</Button>
                <PhotoButton card={card} onDone={reload} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setLeadsFor(card)}><Users data-icon="inline-start" /> Leads</Button>
                <Button type="button" variant="destructive" size="sm" className="col-span-2" onClick={() => setDeleting(card)}><Trash2 data-icon="inline-start" /> Delete card</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {creating ? <CardForm onClose={() => setCreating(false)} onSaved={reload} /> : null}
      {editing ? <CardForm card={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
      {leadsFor ? <LeadsModal card={leadsFor} onClose={() => setLeadsFor(null)} /> : null}
      {downloadFor ? <DownloadModal card={downloadFor} onClose={() => setDownloadFor(null)} /> : null}
      {deleting ? <ConfirmDialog title="Delete digital card" message={`Delete the card for ${deleting.full_name}? This can't be undone.`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
