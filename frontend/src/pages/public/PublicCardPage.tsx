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

  useEffect(() => {
    api<PublicCard>(`/api/public/cards/${slug}`, { auth: false })
      .then(setCard)
      .catch(() => setError(true));
  }, [slug]);

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/public/cards/${slug}/leads`, {
        method: "POST",
        auth: false,
        body: lead,
      });
      setSent(true);
    } catch {
      /* ignore */
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
      <div className="center-screen">
        <div className="login-card">
          <h2>Card not found</h2>
          <p className="muted">This digital card is unavailable or inactive.</p>
        </div>
      </div>
    );
  if (!card) return <div className="center-screen" style={{ color: "#fff" }}>Loading…</div>;

  const accent = card.accent_color || "#0b5cab";

  return (
    <div className="center-screen" style={{ background: "#0c1a2b" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="login-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ background: accent, height: 96 }} />
          <div style={{ padding: "0 26px 26px", marginTop: -44 }}>
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                background: "#fff",
                border: `4px solid #fff`,
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
                fontSize: 30,
                fontWeight: 700,
                color: accent,
                boxShadow: "var(--shadow)",
              }}
            >
              {card.photo_url ? (
                <img
                  src={card.photo_url}
                  alt=""
                  width={88}
                  height={88}
                  style={{ objectFit: "cover" }}
                />
              ) : (
                card.full_name.charAt(0)
              )}
            </div>
            <h2 style={{ margin: "14px 0 2px" }}>{card.full_name}</h2>
            <div className="muted">{card.title}</div>
            <div style={{ fontWeight: 600, color: accent }}>{card.company}</div>
            {card.bio && <p className="muted">{card.bio}</p>}

            <div className="row" style={{ flexDirection: "column", gap: 8, marginTop: 14 }}>
              {card.phone && <a className="btn" href={`tel:${card.phone}`}>📞 {card.phone}</a>}
              {card.whatsapp && (
                <a className="btn" href={`https://wa.me/${card.whatsapp.replace(/\D/g, "")}`}>
                  💬 WhatsApp
                </a>
              )}
              {card.email && <a className="btn" href={`mailto:${card.email}`}>✉ {card.email}</a>}
              {card.website && (
                <a className="btn" href={card.website} target="_blank" rel="noreferrer">
                  🌐 Website
                </a>
              )}
              {card.linkedin && (
                <a className="btn" href={card.linkedin} target="_blank" rel="noreferrer">
                  in LinkedIn
                </a>
              )}
              <button className="btn-primary" onClick={saveContact}>
                ⬇ Save contact
              </button>
            </div>
          </div>
        </div>

        {card.lead_capture_enabled && (
          <div className="login-card" style={{ marginTop: 16 }}>
            {sent ? (
              <div style={{ textAlign: "center" }}>
                <h3>Thank you! 🎉</h3>
                <p className="muted">Your details were shared. We'll be in touch.</p>
              </div>
            ) : (
              <form onSubmit={submitLead}>
                <h3 style={{ marginTop: 0 }}>Share your details</h3>
                <div className="field">
                  <input
                    required
                    placeholder="Your name *"
                    value={lead.name}
                    onChange={(e) => setLead({ ...lead, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <input
                    placeholder="Email"
                    value={lead.email}
                    onChange={(e) => setLead({ ...lead, email: e.target.value })}
                  />
                </div>
                <div className="field">
                  <input
                    placeholder="Phone"
                    value={lead.phone}
                    onChange={(e) => setLead({ ...lead, phone: e.target.value })}
                  />
                </div>
                <div className="field">
                  <textarea
                    rows={2}
                    placeholder="Message (optional)"
                    value={lead.message}
                    onChange={(e) => setLead({ ...lead, message: e.target.value })}
                  />
                </div>
                <button className="btn-primary" style={{ width: "100%" }}>
                  Send
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
