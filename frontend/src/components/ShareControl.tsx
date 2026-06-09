import { useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Globe,
  KeyRound,
  Lock,
  Settings2,
  Share2,
  UserPlus,
} from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { ShareInfo, ShareSettings } from "../api/types";
import { Modal, useToast } from "./ui";

/**
 * Make-public control with access settings (expiry, passcode, lead-capture),
 * a scannable QR and copy-link. `base` is the document endpoint root, e.g.
 * `/api/products/brochures/:id` or `/api/assets/:id`.
 */
export default function ShareControl({
  base,
  name,
  isPublic,
  shareCode,
  expiresAt,
  requireLead,
  hasPasscode,
  onChange,
}: {
  base: string;
  name: string;
  isPublic: boolean;
  shareCode?: string | null;
  expiresAt?: string | null;
  requireLead?: boolean;
  hasPasscode?: boolean;
  onChange: (info: ShareInfo) => void;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = shareCode ? `${window.location.origin}/s/${shareCode}` : "";

  async function copy() {
    await navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    notify("Public link copied.");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {isPublic ? (
        <>
          <span
            className="badge green inline-flex items-center gap-1"
            title="Publicly accessible"
          >
            <Globe size={12} /> Public
          </span>
          <button
            className="btn-sm inline-flex items-center gap-1.5"
            onClick={copy}
            title={shareUrl}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy
          </button>
          <button
            className="btn-sm inline-flex items-center gap-1.5"
            onClick={() => setOpen(true)}
            title="Sharing options"
          >
            <Settings2 size={14} /> Manage
          </button>
        </>
      ) : (
        <button
          className="btn-sm inline-flex items-center gap-1.5"
          onClick={() => setOpen(true)}
          title="Make public and create a short link"
        >
          <Share2 size={14} /> Share
        </button>
      )}

      {open && (
        <ShareModal
          base={base}
          name={name}
          isPublic={isPublic}
          shareUrl={shareUrl}
          expiresAt={expiresAt}
          requireLead={!!requireLead}
          hasPasscode={!!hasPasscode}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

const EXPIRY_OPTIONS = [
  { label: "Never expires", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function ShareModal({
  base,
  name,
  isPublic,
  shareUrl,
  expiresAt,
  requireLead,
  hasPasscode,
  onChange,
  onClose,
}: {
  base: string;
  name: string;
  isPublic: boolean;
  shareUrl: string;
  expiresAt?: string | null;
  requireLead: boolean;
  hasPasscode: boolean;
  onChange: (info: ShareInfo) => void;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [days, setDays] = useState<number>(expiresAt ? 30 : 0);
  const [passcode, setPasscode] = useState("");
  const [removePasscode, setRemovePasscode] = useState(false);
  const [lead, setLead] = useState(requireLead);
  const [busy, setBusy] = useState(false);

  const qrSrc = shareUrl
    ? apiUrl(`/api/public/qr.png?data=${encodeURIComponent(shareUrl)}`)
    : "";

  async function save() {
    setBusy(true);
    const settings: ShareSettings = {
      expires_in_days: days,
      require_lead: lead,
      passcode: removePasscode ? "" : passcode ? passcode : null,
    };
    try {
      const info = await api<ShareInfo>(`${base}/share`, {
        method: "POST",
        body: settings,
      });
      onChange(info);
      if (info.share_code) {
        await navigator.clipboard?.writeText(
          `${window.location.origin}/s/${info.share_code}`,
        );
        notify(isPublic ? "Sharing updated." : "Public link created and copied.");
      }
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not share", "error");
    } finally {
      setBusy(false);
    }
  }

  async function makePrivate() {
    setBusy(true);
    try {
      const info = await api<ShareInfo>(`${base}/unshare`, { method: "POST" });
      onChange(info);
      notify("Link revoked — now private.");
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Share “${name}”`} onClose={onClose} maxWidth={460}>
      {isPublic && shareUrl && (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-border bg-slate-50 p-3">
          <img
            src={qrSrc}
            alt="QR code"
            width={96}
            height={96}
            className="flex-none rounded-lg bg-white p-1"
          />
          <div className="min-w-0">
            <div className="muted mb-1 text-xs uppercase tracking-wide">
              Public link
            </div>
            <code className="block truncate text-sm font-medium">{shareUrl}</code>
            <div className="mt-2 flex gap-2">
              <button
                className="btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl);
                  notify("Link copied.");
                }}
              >
                Copy link
              </button>
              <a className="btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <Clock size={14} /> Expiry
        </label>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
        {expiresAt && (
          <p className="muted mt-1 text-xs">
            Currently expires {new Date(expiresAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="field">
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <KeyRound size={14} /> Passcode {hasPasscode && "(set)"}
        </label>
        <input
          type="text"
          value={passcode}
          disabled={removePasscode}
          placeholder={hasPasscode ? "Leave blank to keep current" : "Optional"}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {hasPasscode && (
          <label className="muted mt-1 flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={removePasscode}
              onChange={(e) => setRemovePasscode(e.target.checked)}
            />
            Remove passcode
          </label>
        )}
      </div>

      <label className="field flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={lead}
          onChange={(e) => setLead(e.target.checked)}
        />
        <UserPlus size={14} /> Capture a lead before download
      </label>

      <div className="mt-4 flex items-center justify-between">
        {isPublic ? (
          <button
            className="btn-danger inline-flex items-center gap-1.5"
            onClick={makePrivate}
            disabled={busy}
          >
            <Lock size={14} /> Make private
          </button>
        ) : (
          <span />
        )}
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          onClick={save}
          disabled={busy}
        >
          <Share2 size={14} /> {isPublic ? "Save changes" : "Create public link"}
        </button>
      </div>
    </Modal>
  );
}
