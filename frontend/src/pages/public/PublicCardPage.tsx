import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readableForeground } from "@/lib/color";
import {
  CircleCheck,
  Download,
  ExternalLink,
  Globe2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";

interface PublicCard {
  slug: string;
  full_name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  linkedin?: string | null;
  address?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  accent_color: string;
  lead_capture_enabled: boolean;
}

export default function PublicCardPage() {
  const { slug } = useParams<{ slug: string }>();
  const [card, setCard] = useState<PublicCard | null>(null);
  const [error, setError] = useState(false);
  const [lead, setLead] = useState({ name: "", email: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api<PublicCard>(`/api/public/cards/${slug}`, { auth: false })
      .then(setCard)
      .catch(() => setError(true));
  }, [slug]);

  async function submitLead(event: React.FormEvent) {
    event.preventDefault();
    setLeadError(null);
    setIsSubmitting(true);
    try {
      await api(`/api/public/cards/${slug}/leads`, { method: "POST", auth: false, body: lead });
      setSent(true);
    } catch (submissionError) {
      setLeadError(submissionError instanceof Error ? submissionError.message : "We couldn't send your details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function saveContact() {
    if (!card) return;
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${card.full_name}`,
      card.title ? `TITLE:${card.title}` : "",
      card.company ? `ORG:${card.company}` : "",
      card.email ? `EMAIL:${card.email}` : "",
      card.phone ? `TEL:${card.phone}` : "",
      card.website ? `URL:${card.website}` : "",
      card.address ? `ADR:;;${card.address}` : "",
      "END:VCARD",
    ].filter(Boolean).join("\n");
    const url = URL.createObjectURL(new Blob([vcard], { type: "text/vcard" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${card.full_name}.vcf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (error) return (
    <main className="grid min-h-dvh place-items-center bg-muted p-4">
      <Card className="w-full max-w-md"><CardHeader><CardTitle>Card not found</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">This digital card is unavailable or inactive.</p></CardContent></Card>
    </main>
  );
  if (!card) return <main className="grid min-h-dvh place-items-center bg-muted p-4 text-foreground">Loading card…</main>;

  const accent = card.accent_color || "#facc15";
  const accentForeground = readableForeground(accent);

  return (
    <main className="min-h-dvh bg-muted px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[460px]">
        <Card className="overflow-hidden py-0">
          <div className="h-2" style={{ background: accent }} aria-hidden="true" />
          <CardHeader className="gap-5 border-b bg-background py-6">
            <div className="flex items-start gap-4">
              <Avatar className="size-20 shrink-0 border bg-background">
                {card.photo_url ? <AvatarImage src={card.photo_url} alt={card.full_name} /> : null}
                <AvatarFallback className="text-xl font-bold" style={{ background: accent, color: accentForeground }}>
                  {card.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 pt-1">
                {card.company ? <Badge variant="outline" className="mb-2">{card.company}</Badge> : null}
                <CardTitle className="text-xl leading-tight">{card.full_name}</CardTitle>
                {card.title ? <p className="mt-1 text-sm text-muted-foreground">{card.title}</p> : null}
              </div>
            </div>
            {card.bio ? <p className="text-sm leading-6 text-muted-foreground">{card.bio}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-5">
            <Button type="button" className="w-full" onClick={saveContact}>
              <Download data-icon="inline-start" /> Save to contacts
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {card.phone ? <a href={`tel:${card.phone}`} className={buttonVariants({ variant: "outline" })}><Phone data-icon="inline-start" /> Call</a> : null}
              {card.email ? <a href={`mailto:${card.email}`} className={buttonVariants({ variant: "outline" })}><Mail data-icon="inline-start" /> Email</a> : null}
              {card.whatsapp ? <a href={`https://wa.me/${card.whatsapp.replace(/\D/g, "")}`} className={buttonVariants({ variant: "outline" })} target="_blank" rel="noreferrer"><MessageCircle data-icon="inline-start" /> WhatsApp</a> : null}
              {card.website ? <a href={card.website} className={buttonVariants({ variant: "outline" })} target="_blank" rel="noreferrer"><Globe2 data-icon="inline-start" /> Website</a> : null}
            </div>
            {card.linkedin ? <a href={card.linkedin} className={buttonVariants({ variant: "ghost" })} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" /> View LinkedIn profile</a> : null}
            {card.address ? <div className="flex gap-2 border-t pt-4 text-sm text-muted-foreground"><MapPin className="mt-0.5 shrink-0" aria-hidden="true" /><span>{card.address}</span></div> : null}
          </CardContent>
        </Card>

        {card.lead_capture_enabled ? sent ? (
          <Card className="mt-4"><CardHeader><CardTitle className="flex items-center gap-2"><CircleCheck aria-hidden="true" /> Details shared</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">Thank you. {card.full_name} can now follow up with you.</p></CardContent></Card>
        ) : (
          <form onSubmit={submitLead} aria-busy={isSubmitting || undefined} className="mt-4">
            <Card>
              <CardHeader><CardTitle>Share your details</CardTitle><p className="text-sm text-muted-foreground">Make it easy to continue the conversation.</p></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <FieldGroup>
                  <Field><FieldLabel htmlFor="public-card-name">Name *</FieldLabel><Input id="public-card-name" required value={lead.name} onChange={(event) => setLead({ ...lead, name: event.target.value })} /></Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field><FieldLabel htmlFor="public-card-email">Email</FieldLabel><Input id="public-card-email" type="email" value={lead.email} onChange={(event) => setLead({ ...lead, email: event.target.value })} /></Field>
                    <Field><FieldLabel htmlFor="public-card-phone">Phone</FieldLabel><Input id="public-card-phone" type="tel" value={lead.phone} onChange={(event) => setLead({ ...lead, phone: event.target.value })} /></Field>
                  </div>
                  <Field><FieldLabel htmlFor="public-card-message">Message</FieldLabel><Textarea id="public-card-message" rows={3} value={lead.message} onChange={(event) => setLead({ ...lead, message: event.target.value })} /></Field>
                </FieldGroup>
                {leadError ? <Alert variant="destructive"><AlertDescription>{leadError}</AlertDescription></Alert> : null}
                <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Sending…" : "Share details"}</Button>
              </CardContent>
            </Card>
          </form>
        ) : null}
      </div>
    </main>
  );
}
