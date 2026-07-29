import { useState } from "react";
import { Handshake, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api/client";
import type { Block, FormBlock, LeadField } from "./blocks";
import { useLandingSlug } from "./LandingContext";

const FIELD_LABEL: Record<LeadField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  message: "Message",
};

const FEATURE_ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  "shield-check": ShieldCheck,
  handshake: Handshake,
  sparkles: Sparkles,
};

function FormBlockView({ block }: { block: FormBlock }) {
  const slug = useLandingSlug();
  const [form, setForm] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return; // preview mode (builder) — no endpoint to post to
    setIsSubmitting(true);
    setError(null);
    try {
      await api(`/api/public/landing-pages/${slug}/leads`, {
        method: "POST",
        auth: false,
        body: {
          name: form.name ?? null,
          email: form.email ?? null,
          phone: form.phone ?? null,
          message: form.message ?? null,
        },
      });
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={{ background: block.bg, padding: "56px 24px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <h2 className="mt-0 text-center text-foreground">
          {block.heading}
        </h2>
        {block.subheading && (
          <p className="mb-6 text-center text-muted-foreground">
            {block.subheading}
          </p>
        )}
        {done ? (
          <Alert
            role="status"
            aria-live="polite"
            className="text-center"
          >
            <AlertDescription className="font-semibold text-foreground">
              {block.successCopy}
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={submit} aria-busy={isSubmitting || undefined} className="flex flex-col gap-4">
            <FieldGroup>
              {block.fields.map((f) => (
                <Field key={f}>
                  <FieldLabel htmlFor={`landing-${block.id}-${f}`} className="sr-only">
                    {FIELD_LABEL[f]}
                  </FieldLabel>
                  {f === "message" ? (
                    <Textarea
                      id={`landing-${block.id}-${f}`}
                      aria-label={FIELD_LABEL[f]}
                      placeholder={FIELD_LABEL[f]}
                      rows={4}
                      value={form[f] ?? ""}
                      onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      id={`landing-${block.id}-${f}`}
                      aria-label={FIELD_LABEL[f]}
                      type={f === "email" ? "email" : f === "phone" ? "tel" : "text"}
                      placeholder={FIELD_LABEL[f]}
                      value={form[f] ?? ""}
                      required
                      onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </FieldGroup>
            {error && (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            )}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Sending…" : block.buttonText}
            </Button>
            {!slug && (
              <div className="mt-2 text-center text-xs text-muted-foreground">
                (Form is live once the page is published.)
              </div>
            )}
          </form>
        )}
      </div>
    </section>
  );
}

const wrap = (children: React.ReactNode, key?: string) => (
  <div key={key} style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
    {children}
  </div>
);

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "hero":
      return wrap(
        <section
          style={{
            background: block.bg,
            color: block.color,
            padding: "80px 24px",
            textAlign: block.align,
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <h1 style={{ fontSize: 40, margin: "0 0 14px", lineHeight: 1.15 }}>
              {block.heading}
            </h1>
            <p style={{ fontSize: 18, opacity: 0.9, margin: "0 0 24px" }}>
              {block.subheading}
            </p>
            {block.buttonText && (
              <Button
                variant="secondary"
                size="lg"
                render={<a href={block.buttonUrl || "#"} />}
              >
                {block.buttonText}
              </Button>
            )}
          </div>
        </section>,
      );
    case "heading":
      return wrap(
        <h2
          style={{
            textAlign: block.align,
            fontSize: 30,
            maxWidth: 820,
            margin: "48px auto 8px",
            padding: "0 24px",
            color: "var(--foreground)",
          }}
        >
          {block.text}
        </h2>,
      );
    case "text":
      return wrap(
        <p
          style={{
            textAlign: block.align,
            fontSize: 16,
            lineHeight: 1.7,
            maxWidth: 720,
            margin: "12px auto",
            padding: "0 24px",
            color: "var(--foreground)",
          }}
        >
          {block.text}
        </p>,
      );
    case "image":
      return wrap(
        <figure style={{ margin: "24px auto", maxWidth: 820, padding: "0 24px", textAlign: "center" }}>
          {block.url ? (
            <img
              src={block.url}
              alt={block.alt}
              style={{ maxWidth: "100%" }}
            />
          ) : (
            <div
              className="bg-primary/15 text-foreground"
              style={{
                padding: "60px 0",
              }}
            >
              Image placeholder
            </div>
          )}
          {block.caption && (
            <figcaption className="mt-2 text-muted-foreground">
              {block.caption}
            </figcaption>
          )}
        </figure>,
      );
    case "features":
      return wrap(
        <section className="bg-muted" style={{ padding: "48px 24px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <h2 style={{ textAlign: "center", fontSize: 28, color: "var(--foreground)" }}>
              {block.heading}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 20,
                marginTop: 28,
              }}
            >
              {block.items.map((it) => {
                const FeatureIcon = FEATURE_ICONS[it.icon];
                return <Card
                  key={it.id}
                  className="text-center"
                >
                  <CardHeader>
                    <div aria-hidden="true">
                      {FeatureIcon ? <FeatureIcon /> : it.icon ? it.icon : <Sparkles />}
                    </div>
                    <CardTitle>{it.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 text-muted-foreground">{it.body}</p>
                  </CardContent>
                </Card>;
              })}
            </div>
          </div>
        </section>,
      );
    case "cta":
      return wrap(
        <section
          style={{
            background: block.bg,
            color: "var(--background)",
            padding: "56px 24px",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>{block.heading}</h2>
          <p style={{ opacity: 0.85, margin: "0 0 22px" }}>{block.subheading}</p>
          <Button
            variant="secondary"
            size="lg"
            render={<a href={block.buttonUrl || "#"} />}
          >
            {block.buttonText}
          </Button>
        </section>,
      );
    case "form":
      return <FormBlockView block={block} />;
    case "spacer":
      return <div style={{ height: block.size }} />;
  }
}

export function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </>
  );
}
