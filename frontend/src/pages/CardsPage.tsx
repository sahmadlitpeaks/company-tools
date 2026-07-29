import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { DigitalCard, Lead } from "../api/types";
import { AuthImage, ConfirmDialog, Empty, ErrorBox, ListSkeleton, Loading, Modal, PageHead, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";

const PUBLIC_ORIGIN = window.location.origin;

function CardForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ full_name: "", title: "", email: "", phone: "", whatsapp: "", website: "", linkedin: "", bio: "", accent_color: "#f78d2b" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!form.full_name.trim()) { setNameError("Full name is required."); return; } setNameError(null); setIsSubmitting(true); try { await api<DigitalCard>("/api/cards", { method: "POST", body: form }); notify("Digital card created."); onSaved(); onClose(); } catch (error) { notify(error instanceof Error ? error.message : "Failed", "error"); } finally { setIsSubmitting(false); } }
  return (
    <Modal title="New digital card" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5"><FieldGroup>
        <Field data-invalid={!!nameError}><FieldLabel htmlFor="card-full-name">Full name *</FieldLabel><Input id="card-full-name" value={form.full_name} aria-invalid={!!nameError} onChange={(event) => { set("full_name", event.target.value); if (nameError) setNameError(null); }} />{nameError && <FieldError>{nameError}</FieldError>}</Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="card-title">Title</FieldLabel><Input id="card-title" value={form.title} onChange={(event) => set("title", event.target.value)} /></Field><Field><FieldLabel htmlFor="card-accent">Accent colour</FieldLabel><Input id="card-accent" type="color" value={form.accent_color} onChange={(event) => set("accent_color", event.target.value)} /></Field></div>
        {[["email", "Email"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["website", "Website"]].reduce<React.ReactNode[]>((rows, _, index, all) => { if (index % 2 === 0) rows.push(<div className="grid gap-4 sm:grid-cols-2" key={all[index][0]}>{all.slice(index, index + 2).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`card-${key}`}>{label}</FieldLabel><Input id={`card-${key}`} value={form[key as keyof typeof form]} onChange={(event) => set(key, event.target.value)} /></Field>)}</div>); return rows; }, [])}
        <Field><FieldLabel htmlFor="card-linkedin">LinkedIn</FieldLabel><Input id="card-linkedin" value={form.linkedin} onChange={(event) => set("linkedin", event.target.value)} /></Field><Field><FieldLabel htmlFor="card-bio">Bio</FieldLabel><Textarea id="card-bio" rows={3} value={form.bio} onChange={(event) => set("bio", event.target.value)} /></Field>
      </FieldGroup><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Create card"}</Button></div></form>
    </Modal>
  );
}

function PhotoButton({ card, onDone }: { card: DigitalCard; onDone: () => void }) {
  const { notify } = useToast(); const ref = useRef<HTMLInputElement>(null);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const body = new FormData(); body.append("file", file); try { await api(`/api/cards/${card.id}/photo`, { method: "POST", form: body }); notify("Photo updated."); onDone(); } catch (error) { notify(error instanceof Error ? error.message : "Upload failed", "error"); } if (ref.current) ref.current.value = ""; }
  return <><Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}>Photo</Button><Input ref={ref} type="file" accept="image/*" hidden onChange={upload} /></>;
}

function DownloadModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { notify } = useToast(); const safe = card.slug || "card";
  const items = [{ label: "Contact file (vCard)", hint: "Import into phone / Outlook contacts", path: `/api/cards/${card.id}/vcard`, file: `${safe}.vcf` }, { label: "QR code (PNG)", hint: "Square QR image for print", path: `/api/cards/${card.id}/qr.png`, file: `${safe}-qr.png` }, { label: "Card image (PNG)", hint: "Full business card as an image", path: `/api/cards/${card.id}/card.png`, file: `${safe}.png` }, { label: "Card (PDF)", hint: "Print-ready PDF", path: `/api/cards/${card.id}/card.pdf`, file: `${safe}.pdf` }];
  return <Modal title={`Download - ${card.full_name}`} onClose={onClose}><div className="flex flex-col gap-2">{items.map((item) => <Button key={item.label} type="button" variant="outline" className="h-auto w-full flex-col items-start" onClick={() => downloadFile(item.path, item.file).catch(() => notify("Download failed", "error"))}><span className="font-semibold">{item.label}</span><span className="text-xs text-muted-foreground">{item.hint}</span></Button>)}</div></Modal>;
}

function LeadsModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { data, loading } = useFetch<Lead[]>(`/api/cards/${card.id}/leads`);
  return <Modal title={`Leads - ${card.full_name}`} onClose={onClose}>{loading ? <Loading /> : !data?.length ? <Empty message="No leads captured yet." /> : <TableSurface><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Message</TableHead></TableRow></TableHeader><TableBody>{data.map((lead) => <TableRow key={lead.id}><TableCell className="font-semibold">{lead.name}</TableCell><TableCell><div>{lead.email}</div><div className="text-muted-foreground">{lead.phone}</div></TableCell><TableCell className="max-w-80 whitespace-normal text-muted-foreground"><p className="line-clamp-3">{lead.message ?? "—"}</p></TableCell></TableRow>)}</TableBody></Table></TableSurface>}</Modal>;
}

export default function CardsPage() {
  const { notify } = useToast(); const { data, loading, error, reload } = useFetch<DigitalCard[]>("/api/cards");
  const [creating, setCreating] = useState(false); const [leadsFor, setLeadsFor] = useState<DigitalCard | null>(null); const [downloadFor, setDownloadFor] = useState<DigitalCard | null>(null); const [deleting, setDeleting] = useState<DigitalCard | null>(null);
  async function remove(card: DigitalCard) { await api(`/api/cards/${card.id}`, { method: "DELETE" }); notify("Card deleted."); reload(); }
  function copyLink(card: DigitalCard) { void navigator.clipboard.writeText(`${PUBLIC_ORIGIN}/c/${card.slug}`); notify("Share link copied to clipboard."); }
  return (
    <div><PageHead title="Digital Cards" subtitle="Shareable business cards with QR codes and lead capture." action={<Button type="button" onClick={() => setCreating(true)}>+ New card</Button>} />
      {loading ? <ListSkeleton rows={4} /> : error ? <ErrorBox message={error} /> : !data?.length ? <Empty icon={<CreditCard />} message="No digital cards yet" hint="Create a shareable business card with a QR code and lead capture." action={<Button type="button" onClick={() => setCreating(true)}>+ New card</Button>} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.map((card) => <Card key={card.id}><CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>{card.full_name}</CardTitle><div className="text-muted-foreground">{card.title}</div><div className="mt-1 text-xs text-muted-foreground">/c/{card.slug}</div></div><AuthImage alt="QR" width={72} height={72} path={`/api/cards/${card.id}/qr.png`} style={{ border: "1px solid var(--border)" }} /></CardHeader><CardContent><div className="h-1 w-full" style={{ background: card.accent_color }} /></CardContent><CardFooter className="flex flex-wrap gap-2"><a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/c/${card.slug}`} target="_blank" rel="noreferrer">View</a><Button type="button" variant="outline" size="sm" onClick={() => copyLink(card)}>Copy link</Button><PhotoButton card={card} onDone={reload} /><Button type="button" variant="outline" size="sm" onClick={() => setDownloadFor(card)}>Download</Button><Button type="button" variant="outline" size="sm" onClick={() => setLeadsFor(card)}>Leads</Button><Button type="button" variant="destructive" size="sm" onClick={() => setDeleting(card)}>Delete</Button></CardFooter></Card>)}</div>}
      {creating && <CardForm onClose={() => setCreating(false)} onSaved={reload} />}{leadsFor && <LeadsModal card={leadsFor} onClose={() => setLeadsFor(null)} />}{downloadFor && <DownloadModal card={downloadFor} onClose={() => setDownloadFor(null)} />}{deleting && <ConfirmDialog title="Delete digital card" message={`Delete the card for ${deleting.full_name}? This can't be undone.`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
