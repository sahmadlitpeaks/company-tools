import { useState } from "react";
import { api } from "../api/client";
import type { Block, FormBlock, LeadField } from "./blocks";
import { useLandingSlug } from "./LandingContext";

const FIELD_LABEL: Record<LeadField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  message: "Message",
};

function FormBlockView({ block }: { block: FormBlock }) {
  const slug = useLandingSlug();
  const [form, setForm] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return; // preview mode (builder) — no endpoint to post to
    setBusy(true);
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
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 13px",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    marginBottom: 12,
    font: "inherit",
    boxSizing: "border-box",
  };

  return (
    <section style={{ background: block.bg, padding: "56px 24px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <h2 style={{ textAlign: "center", color: "#0c1a2b", marginTop: 0 }}>
          {block.heading}
        </h2>
        {block.subheading && (
          <p style={{ textAlign: "center", color: "#64748b", marginBottom: 24 }}>
            {block.subheading}
          </p>
        )}
        {done ? (
          <div
            style={{
              background: "#dcfce7",
              color: "#15803d",
              padding: 18,
              borderRadius: 10,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {block.successMessage}
          </div>
        ) : (
          <form onSubmit={submit}>
            {block.fields.map((f) =>
              f === "message" ? (
                <textarea
                  key={f}
                  placeholder={FIELD_LABEL[f]}
                  rows={4}
                  style={inputStyle}
                  value={form[f] ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                />
              ) : (
                <input
                  key={f}
                  type={f === "email" ? "email" : "text"}
                  placeholder={FIELD_LABEL[f]}
                  style={inputStyle}
                  value={form[f] ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                />
              ),
            )}
            {error && (
              <div style={{ color: "#dc2626", marginBottom: 10 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                background: "#0b5cab",
                color: "#fff",
                border: "none",
                padding: "13px",
                borderRadius: 9,
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              {busy ? "Sending…" : block.buttonText}
            </button>
            {!slug && (
              <div
                style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 8 }}
              >
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
              <a
                href={block.buttonUrl || "#"}
                style={{
                  display: "inline-block",
                  background: "#fff",
                  color: block.bg,
                  padding: "13px 30px",
                  borderRadius: 9,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                {block.buttonText}
              </a>
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
            color: "#0c1a2b",
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
            color: "#334155",
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
              style={{ maxWidth: "100%", borderRadius: 12 }}
            />
          ) : (
            <div
              style={{
                background: "#e2e8f0",
                color: "#64748b",
                padding: "60px 0",
                borderRadius: 12,
              }}
            >
              Image placeholder
            </div>
          )}
          {block.caption && (
            <figcaption style={{ color: "#64748b", marginTop: 8 }}>
              {block.caption}
            </figcaption>
          )}
        </figure>,
      );
    case "features":
      return wrap(
        <section style={{ padding: "48px 24px", background: "#f8fafc" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <h2 style={{ textAlign: "center", fontSize: 28, color: "#0c1a2b" }}>
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
              {block.items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 22,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 32 }}>{it.icon}</div>
                  <h3 style={{ margin: "10px 0 6px", color: "#0c1a2b" }}>{it.title}</h3>
                  <p style={{ color: "#64748b", margin: 0 }}>{it.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>,
      );
    case "cta":
      return wrap(
        <section
          style={{
            background: block.bg,
            color: "#fff",
            padding: "56px 24px",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>{block.heading}</h2>
          <p style={{ opacity: 0.85, margin: "0 0 22px" }}>{block.subheading}</p>
          <a
            href={block.buttonUrl || "#"}
            style={{
              display: "inline-block",
              background: "#fff",
              color: block.bg,
              padding: "13px 30px",
              borderRadius: 9,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            {block.buttonText}
          </a>
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
