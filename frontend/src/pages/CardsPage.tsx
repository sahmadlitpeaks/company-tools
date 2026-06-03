import { useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { DigitalCard, Lead } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  AuthImage,
  ConfirmModal,
  Empty,
  ErrorBox,
  ListSkeleton,
  Loading,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";

const PUBLIC_ORIGIN = window.location.origin;

function CardForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    full_name: "",
    title: "",
    email: "",
    phone: "",
    whatsapp: "",
    website: "",
    linkedin: "",
    bio: "",
    accent_color: "#0b5cab",
  });
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setNameError("Full name is required.");
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      await api<DigitalCard>("/api/cards", { method: "POST", body: form });
      notify("Digital card created.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New digital card" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="card-full-name">Full name *</label>
          <input
            id="card-full-name"
            value={form.full_name}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "card-full-name-err" : undefined}
            onChange={(e) => {
              set("full_name", e.target.value);
              if (nameError) setNameError(null);
            }}
          />
          {nameError && (
            <div id="card-full-name-err" className="mt-1 text-xs text-red-600">
              {nameError}
            </div>
          )}
        </div>
        <div className="row">
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="field">
            <label>Accent colour</label>
            <input
              type="color"
              value={form.accent_color}
              onChange={(e) => set("accent_color", e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>WhatsApp</label>
            <input
              value={form.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Website</label>
            <input
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>LinkedIn</label>
          <input
            value={form.linkedin}
            onChange={(e) => set("linkedin", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Bio</label>
          <textarea
            rows={3}
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Create card"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoButton({ card, onDone }: { card: DigitalCard; onDone: () => void }) {
  const { notify } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(`/api/cards/${card.id}/photo`, { method: "POST", form: fd });
      notify("Photo updated.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (ref.current) ref.current.value = "";
  }
  return (
    <>
      <button
        className="btn-sm"
        style={{ flex: "0 0 auto" }}
        onClick={() => ref.current?.click()}
      >
        Photo
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={upload} />
    </>
  );
}

function DownloadModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { notify } = useToast();
  const safe = card.slug || "card";
  const items: { label: string; hint: string; path: string; file: string }[] = [
    {
      label: "Contact file (vCard)",
      hint: "Import into phone / Outlook contacts",
      path: `/api/cards/${card.id}/vcard`,
      file: `${safe}.vcf`,
    },
    {
      label: "QR code (PNG)",
      hint: "Square QR image for print",
      path: `/api/cards/${card.id}/qr.png`,
      file: `${safe}-qr.png`,
    },
    {
      label: "Card image (PNG)",
      hint: "Full business card as an image",
      path: `/api/cards/${card.id}/card.png`,
      file: `${safe}.png`,
    },
    {
      label: "Card (PDF)",
      hint: "Print-ready PDF",
      path: `/api/cards/${card.id}/card.pdf`,
      file: `${safe}.pdf`,
    },
  ];
  return (
    <Modal title={`Download — ${card.full_name}`} onClose={onClose}>
      <div className="row" style={{ flexDirection: "column", gap: 8 }}>
        {items.map((it) => (
          <button
            key={it.label}
            className="btn"
            style={{ width: "100%", textAlign: "left" }}
            onClick={() =>
              downloadFile(it.path, it.file).catch(() =>
                notify("Download failed", "error"),
              )
            }
          >
            <div style={{ fontWeight: 600 }}>{it.label}</div>
            <div className="muted" style={{ fontSize: 12 }}>{it.hint}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function LeadsModal({ card, onClose }: { card: DigitalCard; onClose: () => void }) {
  const { data, loading } = useFetch<Lead[]>(`/api/cards/${card.id}/leads`);
  return (
    <Modal title={`Leads — ${card.full_name}`} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No leads captured yet." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 600 }}>{l.name}</td>
                <td>
                  <div>{l.email}</div>
                  <div className="muted">{l.phone}</div>
                </td>
                <td className="muted">{l.message ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export default function CardsPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useFetch<DigitalCard[]>("/api/cards");
  const [creating, setCreating] = useState(false);
  const [leadsFor, setLeadsFor] = useState<DigitalCard | null>(null);
  const [downloadFor, setDownloadFor] = useState<DigitalCard | null>(null);
  const [deleting, setDeleting] = useState<DigitalCard | null>(null);

  async function remove(card: DigitalCard) {
    await api(`/api/cards/${card.id}`, { method: "DELETE" });
    notify("Card deleted.");
    reload();
  }

  function copyLink(card: DigitalCard) {
    const url = `${PUBLIC_ORIGIN}/c/${card.slug}`;
    void navigator.clipboard.writeText(url);
    notify("Share link copied to clipboard.");
  }

  return (
    <div>
      <PageHead
        title="Digital Cards"
        subtitle="Shareable business cards with QR codes and lead capture."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New card
          </button>
        }
      />
      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon="💳"
          message="No digital cards yet"
          hint="Create a shareable business card with a QR code and lead capture."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New card
            </button>
          }
        />
      ) : (
        <div className="grid cols-3">
          {data.map((card) => (
            <div className="card" key={card.id}>
              <div className="spread">
                <div
                  style={{
                    width: 8,
                    height: 40,
                    borderRadius: 4,
                    background: card.accent_color,
                  }}
                />
                <AuthImage
                  alt="QR"
                  width={72}
                  height={72}
                  path={`/api/cards/${card.id}/qr.png`}
                  style={{ border: "1px solid var(--border)", borderRadius: 8 }}
                />
              </div>
              <h3 style={{ margin: "12px 0 2px" }}>{card.full_name}</h3>
              <div className="muted">{card.title}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                /c/{card.slug}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <a
                  className="btn btn-sm"
                  href={`/c/${card.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flex: "0 0 auto" }}
                >
                  View
                </a>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => copyLink(card)}
                >
                  Copy link
                </button>
                <PhotoButton card={card} onDone={reload} />
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setDownloadFor(card)}
                >
                  Download
                </button>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setLeadsFor(card)}
                >
                  Leads
                </button>
                <button
                  className="btn-sm btn-danger"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setDeleting(card)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <CardForm onClose={() => setCreating(false)} onSaved={reload} />}
      {leadsFor && (
        <LeadsModal card={leadsFor} onClose={() => setLeadsFor(null)} />
      )}
      {downloadFor && (
        <DownloadModal card={downloadFor} onClose={() => setDownloadFor(null)} />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete digital card"
          message={`Delete the card for ${deleting.full_name}? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
