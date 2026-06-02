import { useRef, useState } from "react";
import { api } from "../api/client";
import type { SecureTransfer, SecureTransferCreated } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmModal,
  Empty,
  Loading,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";

function statusBadge(t: SecureTransfer) {
  if (t.is_consumed)
    return <span className="badge">{t.one_time ? "downloaded" : "revoked"}</span>;
  if (t.expires_at && new Date(t.expires_at) < new Date())
    return <span className="badge">expired</span>;
  return <span className="badge green">active</span>;
}

function ShareResult({ url, onClose }: { url: string; onClose: () => void }) {
  const { notify } = useToast();
  return (
    <Modal title="Secure link created" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Share this single-use link with the recipient. For security it's shown
        <strong> only once</strong> — it can't be retrieved later.
      </p>
      <div className="field">
        <input readOnly value={url} onFocus={(e) => e.target.select()} />
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button
          className="btn-primary"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            void navigator.clipboard.writeText(url);
            notify("Link copied.");
          }}
        >
          Copy link
        </button>
      </div>
    </Modal>
  );
}

export default function TransfersPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<SecureTransfer[]>("/api/transfers");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [form, setForm] = useState({
    recipient_email: "",
    message: "",
    password: "",
    one_time: true,
    expires_in_hours: 72,
  });
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<SecureTransfer | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      notify("Choose a file to send.", "error");
      return;
    }
    setBusy(true);
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
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
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
        subtitle="Send a file via an encrypted, single-use link that self-destructs after download."
      />
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Send a file securely</h3>
          <form onSubmit={submit}>
            <div className="field">
              <label>File *</label>
              <button
                type="button"
                className="btn"
                style={{ width: "100%" }}
                onClick={() => fileRef.current?.click()}
              >
                {fileName || "Choose file…"}
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </div>
            <div className="field">
              <label>Recipient email *</label>
              <input
                required
                type="email"
                value={form.recipient_email}
                onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Message (optional)</label>
              <textarea
                rows={2}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Password (optional)</label>
                <input
                  type="text"
                  placeholder="extra protection"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Expires in</label>
                <select
                  value={form.expires_in_hours}
                  onChange={(e) =>
                    setForm({ ...form, expires_in_hours: Number(e.target.value) })
                  }
                >
                  <option value={1}>1 hour</option>
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                  <option value={0}>No expiry</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={form.one_time}
                  onChange={(e) => setForm({ ...form, one_time: e.target.checked })}
                />
                Delete file after first download (burn-after-read)
              </label>
            </div>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Encrypting…" : "Create secure link"}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>How it works</h3>
          <ol className="muted" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            <li>Your file is <strong>encrypted</strong> the moment it's uploaded.</li>
            <li>The decryption key lives only in the share link — never in our database.</li>
            <li>We email the link to the recipient (or you copy &amp; send it).</li>
            <li>On download the file is decrypted and, by default,
              <strong> permanently deleted</strong>.</li>
            <li>Links also self-expire after the window you choose.</li>
          </ol>
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Sent files</h3>
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="You haven't sent any secure files yet." />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Recipient</th>
                <th>Protection</th>
                <th>Downloads</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>
                    {t.filename}
                    <div className="muted" style={{ fontWeight: 400 }}>
                      {bytes(t.size_bytes)}
                    </div>
                  </td>
                  <td>
                    {t.recipient_email}
                    {t.email_sent && <span className="badge blue" style={{ marginLeft: 6 }}>emailed</span>}
                  </td>
                  <td>
                    {t.has_password && <span className="badge">password</span>}{" "}
                    {t.one_time && <span className="badge">one-time</span>}
                  </td>
                  <td>{t.download_count}</td>
                  <td>{statusBadge(t)}</td>
                  <td>
                    {!t.is_consumed && (
                      <button
                        className="btn-sm btn-danger"
                        onClick={() => setRevoking(t)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shareUrl && <ShareResult url={shareUrl} onClose={() => setShareUrl(null)} />}
      {revoking && (
        <ConfirmModal
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
