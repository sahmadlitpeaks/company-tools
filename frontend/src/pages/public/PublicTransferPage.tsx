import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, API_BASE_URL } from "../../api/client";
import type { TransferMeta } from "../../api/types";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PublicTransferPage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<TransferMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<TransferMeta>(`/api/public/transfers/${token}/meta`, { auth: false })
      .then(setMeta)
      .catch(() => setNotFound(true));
  }, [token]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/transfers/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password || null }),
      });
      if (!res.ok) {
        let detail = "Download failed";
        try {
          detail = (await res.json()).detail ?? detail;
        } catch {
          /* ignore */
        }
        setError(detail);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta?.filename ?? "download";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const card = (children: React.ReactNode) => (
    <div className="center-screen" style={{ background: "#0c1a2b" }}>
      <div className="login-card" style={{ maxWidth: 440 }}>
        {children}
      </div>
    </div>
  );

  if (notFound)
    return card(
      <>
        <h2>Link not found</h2>
        <p className="muted">This secure transfer doesn't exist.</p>
      </>,
    );
  if (!meta) return card(<p className="muted">Loading…</p>);

  if (meta.status === "consumed")
    return card(
      <>
        <h2>🔥 File no longer available</h2>
        <p className="muted">
          This file has already been downloaded or was revoked by the sender.
          Secure links are single-use.
        </p>
      </>,
    );
  if (meta.status === "expired")
    return card(
      <>
        <h2>⏰ Link expired</h2>
        <p className="muted">
          This secure link has expired and the file has been deleted.
        </p>
      </>,
    );

  if (done)
    return card(
      <>
        <h2>✅ Download started</h2>
        <p className="muted">
          {meta.filename} is downloading. This link has now been consumed and the
          file deleted from our servers.
        </p>
      </>,
    );

  return card(
    <>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--brand)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 26,
          marginBottom: 14,
        }}
      >
        🔒
      </div>
      <h2 style={{ margin: "0 0 4px" }}>A file was shared with you</h2>
      {meta.sender_name && (
        <p className="muted" style={{ marginTop: 0 }}>from {meta.sender_name}</p>
      )}
      {meta.message && (
        <div
          className="card"
          style={{ background: "#f8fafc", padding: 12, marginBottom: 14 }}
        >
          {meta.message}
        </div>
      )}
      <div className="spread" style={{ marginBottom: 16 }}>
        <strong>{meta.filename}</strong>
        <span className="muted">{fmtBytes(meta.size_bytes)}</span>
      </div>

      {meta.requires_password && (
        <div className="field">
          <label>This file is password protected</label>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div
          className="card"
          style={{ borderColor: "#fecaca", color: "#b91c1c", marginBottom: 12 }}
        >
          {error}
        </div>
      )}

      <button
        className="btn-primary"
        style={{ width: "100%", padding: 12 }}
        disabled={busy}
        onClick={download}
      >
        {busy ? "Decrypting…" : "Download file"}
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: "center" }}>
        🔥 This is a single-use link — the file is deleted after you download it.
      </p>
    </>,
  );
}
