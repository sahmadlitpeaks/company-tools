import { useState } from "react";
import { Check, Copy, Globe, Lock, Share2 } from "lucide-react";
import { api } from "../api/client";
import type { ShareInfo } from "../api/types";
import { useToast } from "./ui";

/**
 * Compact "make public + short link" control used in the brochure and
 * marketing-asset libraries. `base` is the document's endpoint root, e.g.
 * `/api/products/brochures/:id` or `/api/assets/:id`; this POSTs to
 * `${base}/share` and `${base}/unshare`.
 */
export default function ShareControl({
  base,
  isPublic,
  shareCode,
  onChange,
}: {
  base: string;
  isPublic: boolean;
  shareCode?: string | null;
  onChange: (info: ShareInfo) => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = shareCode ? `${window.location.origin}/s/${shareCode}` : "";

  async function share() {
    setBusy(true);
    try {
      const info = await api<ShareInfo>(`${base}/share`, { method: "POST" });
      onChange(info);
      if (info.share_code) {
        await navigator.clipboard?.writeText(
          `${window.location.origin}/s/${info.share_code}`,
        );
        notify("Public link created and copied to clipboard.");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not share", "error");
    } finally {
      setBusy(false);
    }
  }

  async function unshare() {
    setBusy(true);
    try {
      const info = await api<ShareInfo>(`${base}/unshare`, { method: "POST" });
      onChange(info);
      notify("Link revoked — the document is private again.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    notify("Public link copied.");
    setTimeout(() => setCopied(false), 1500);
  }

  if (!isPublic)
    return (
      <button
        className="btn-sm inline-flex items-center gap-1.5"
        onClick={share}
        disabled={busy}
        title="Make public and create a short link"
      >
        <Share2 size={14} /> Share
      </button>
    );

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="badge green inline-flex items-center gap-1"
        title="This document is publicly accessible"
      >
        <Globe size={12} /> Public
      </span>
      <button
        className="btn-sm inline-flex items-center gap-1.5"
        onClick={copy}
        title={shareUrl}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} Copy link
      </button>
      <button
        className="btn-sm inline-flex items-center gap-1.5"
        onClick={unshare}
        disabled={busy}
        title="Revoke public access"
      >
        <Lock size={14} /> Make private
      </button>
    </span>
  );
}
