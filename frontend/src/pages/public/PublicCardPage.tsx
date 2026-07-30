import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readableForeground } from "@/lib/color";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleCheck, Download, Globe2, Mail, MessageCircle, Phone } from "lucide-react";
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api<PublicCard>(`/api/public/cards/${slug}`, { auth: false })
      .then(setCard)
      .catch(() => setError(true));
  }, [slug]);

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api(`/api/public/cards/${slug}/leads`, {
        method: "POST",
        auth: false,
        body: lead,
      });
      setSent(true);
    } catch {
      /* ignore */
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
      "END:VCARD",
    ]
      .filter(Boolean)
      .join("\n");
    const url = URL.createObjectURL(new Blob([vcard], { type: "text/vcard" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${card.full_name}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error)
    return (
      <div className="grid min-h-dvh place-items-center bg-muted p-5">
        <Card className="w-full max-w-md"><CardHeader><CardTitle>Card not found</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">This digital card is unavailable or inactive.</p></CardContent></Card>
      </div>
    );
  if (!card) return <div className="grid min-h-dvh place-items-center bg-muted p-5 text-foreground">Loading…</div>;

  const accent = card.accent_color || "#f78d2b";
  const accentForeground = readableForeground(accent);

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-5">
      <div className="w-full max-w-[420px]">
        <Card className="py-0">
          <CardContent className="h-24 p-0" aria-hidden="true" style={{ background: accent }} />
          <CardHeader className="-mt-11">
            <Avatar className="size-22 bg-background ring-4 ring-background">
              {card.photo_url && <AvatarImage src={card.photo_url} alt={card.full_name} />}
              <AvatarFallback className="text-3xl font-bold" style={{ background: accent, color: accentForeground }}>
                {card.full_name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="mt-3">
              <CardTitle className="text-xl">{card.full_name}</CardTitle>
              <div className="text-muted-foreground">{card.title}</div>
              {card.company && (
                <div
                  className="mt-1 inline-flex px-1.5 py-0.5 text-sm font-semibold"
                  style={{ background: accent, color: accentForeground }}
                >
                  {card.company}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {card.bio && <p className="text-muted-foreground">{card.bio}</p>}

            <div className="flex flex-col gap-2">
              {card.phone && (
                <a href={`tel:${card.phone}`} className={buttonVariants({ variant: "outline" })}>
                  <Phone data-icon="inline-start" /> {card.phone}
                </a>
              )}
              {card.whatsapp && (
                <a
                  href={`https://wa.me/${card.whatsapp.replace(/\D/g, "")}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <MessageCircle data-icon="inline-start" /> WhatsApp
                </a>
              )}
              {card.email && (
                <a href={`mailto:${card.email}`} className={buttonVariants({ variant: "outline" })}>
                  <Mail data-icon="inline-start" /> {card.email}
                </a>
              )}
              {card.website && (
                <a
                  href={card.website}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Globe2 data-icon="inline-start" /> Website
                </a>
              )}
              {card.linkedin && (
                <a
                  href={card.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                >
                  in LinkedIn
                </a>
              )}
              <Button type="button" onClick={saveContact}>
                <Download data-icon="inline-start" /> Save contact
              </Button>
            </div>
          </CardContent>
        </Card>

        {card.lead_capture_enabled && (sent ? (
          <Card className="mt-4">
                <CardHeader><CardTitle className="flex items-center gap-2"><CircleCheck aria-hidden="true" /> Thank you!</CardTitle></CardHeader>
                <CardContent><p className="text-muted-foreground">Your details were shared. We'll be in touch.</p></CardContent>
          </Card>
          ) : (
              <form onSubmit={submitLead} aria-busy={isSubmitting || undefined} className="mt-4">
              <Card>
                <CardHeader><CardTitle>Share your details</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <FieldGroup>
                    <Field><FieldLabel htmlFor="public-card-name" className="sr-only">Your name</FieldLabel>
                      <Input id="public-card-name" aria-label="Your name *"
                        required
                        placeholder="Your name *"
                        value={lead.name}
                        onChange={(e) => setLead({ ...lead, name: e.target.value })}
                      /></Field>
                    <Field><FieldLabel htmlFor="public-card-email" className="sr-only">Email</FieldLabel>
                      <Input id="public-card-email" aria-label="Email"
                        type="email"
                        placeholder="Email"
                        value={lead.email}
                        onChange={(e) => setLead({ ...lead, email: e.target.value })}
                      /></Field>
                    <Field><FieldLabel htmlFor="public-card-phone" className="sr-only">Phone</FieldLabel>
                      <Input id="public-card-phone" aria-label="Phone"
                        type="tel"
                        placeholder="Phone"
                        value={lead.phone}
                        onChange={(e) => setLead({ ...lead, phone: e.target.value })}
                      /></Field>
                    <Field><FieldLabel htmlFor="public-card-message" className="sr-only">Message</FieldLabel>
                      <Textarea id="public-card-message" aria-label="Message (optional)"
                        rows={2}
                        placeholder="Message (optional)"
                        value={lead.message}
                        onChange={(e) => setLead({ ...lead, message: e.target.value })}
                      /></Field>
                  </FieldGroup>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? "Sending…" : "Send"}
                  </Button>
                </CardContent>
              </Card>
              </form>
            ))}
      </div>
    </main>
  );
}
