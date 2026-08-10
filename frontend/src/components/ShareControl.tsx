import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
          <Badge
            variant="success"
            title="Publicly accessible"
          >
            <Globe data-icon="inline-start" /> Public
          </Badge>
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={copy}
            title={shareUrl}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} Copy
          </Button>
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            title="Sharing options"
          >
            <Settings2 data-icon="inline-start" /> Manage
          </Button>
        </>
      ) : (
        <Button type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          title="Make public and create a short link"
        >
          <Share2 data-icon="inline-start" /> Share
        </Button>
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qrSrc = shareUrl
    ? apiUrl(`/api/public/qr.png?data=${encodeURIComponent(shareUrl)}`)
    : "";

  async function save() {
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  }

  async function makePrivate() {
    setIsSubmitting(true);
    try {
      const info = await api<ShareInfo>(`${base}/unshare`, { method: "POST" });
      onChange(info);
      notify("Link revoked — now private.");
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Share “${name}”`} onClose={onClose} maxWidth={460}>
      {isPublic && shareUrl && (
        <div className="mb-4 flex flex-col items-start gap-4 border border-border bg-muted p-3 sm:flex-row sm:items-center">
          <img
            src={qrSrc}
            alt="QR code"
            width={96}
            height={96}
            className="flex-none bg-card p-1"
          />
          <div className="min-w-0">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Public link
            </div>
            <code className="block truncate text-sm font-medium">{shareUrl}</code>
            <div className="mt-2 flex gap-2">
              <Button type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl);
                  notify("Link copied.");
                }}
              >
                Copy link
              </Button>
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open
              </a>
            </div>
          </div>
        </div>
      )}

      <FieldGroup>
      <Field>
        <FieldLabel htmlFor="share-expiry">
          <Clock /> Expiry
        </FieldLabel>
        <Select items={EXPIRY_OPTIONS.map((o) => ({ value: o.days, label: o.label }))} value={days} onValueChange={(value) => value !== null && setDays(value)}>
          <SelectTrigger id="share-expiry" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.days} value={o.days}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {expiresAt && (
          <FieldDescription>
            Currently expires {new Date(expiresAt).toLocaleDateString()}
          </FieldDescription>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="share-passcode">
          <KeyRound /> Passcode {hasPasscode && "(set)"}
        </FieldLabel>
        <Input id="share-passcode"
          type="text"
          value={passcode}
          disabled={removePasscode}
          placeholder={hasPasscode ? "Leave blank to keep current" : "Optional"}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {hasPasscode && (
          <Field orientation="horizontal">
            <Checkbox
              id="share-remove-passcode"
              checked={removePasscode}
              onCheckedChange={(checked) => setRemovePasscode(Boolean(checked))}
            />
            <FieldLabel htmlFor="share-remove-passcode">Remove passcode</FieldLabel>
          </Field>
        )}
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="share-capture-lead"
          checked={lead}
          onCheckedChange={(checked) => setLead(Boolean(checked))}
        />
        <FieldLabel htmlFor="share-capture-lead"><UserPlus /> Capture a lead before download</FieldLabel>
      </Field>
      </FieldGroup>

      <div className="mt-4 flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
        {isPublic ? (
          <Button type="button"
            variant="destructive"
            onClick={makePrivate}
            disabled={isSubmitting}
          >
            <Lock data-icon="inline-start" /> Make private
          </Button>
        ) : (
          <span />
        )}
        <Button aria-label="Save" type="button"
          onClick={save}
          disabled={isSubmitting}
        >
          <Share2 data-icon="inline-start" /> {isPublic ? "Save changes" : "Create public link"}
        </Button>
      </div>
    </Modal>
  );
}
