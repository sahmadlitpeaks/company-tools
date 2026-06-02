import type { Block } from "./blocks";

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
