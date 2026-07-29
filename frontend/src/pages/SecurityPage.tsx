import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api, apiBlob } from "../api/client";
import { PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

type MfaStatus = { enabled: boolean; pending?: boolean };

export default function SecurityPage() {
  const { notify } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  function clearQr() {
    if (qrUrl) URL.revokeObjectURL(qrUrl);
    setQrUrl(null);
  }

  async function load() {
    try {
      const status = await api<MfaStatus>("/api/auth/mfa/status");
      setEnabled(status.enabled);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { void load(); }, []);

  async function startSetup() {
    setIsSubmitting(true);
    try {
      const next = await api<{ secret: string; otpauth_uri: string }>("/api/auth/mfa/setup", { method: "POST" });
      setSetup(next);
      const blob = await apiBlob("/api/auth/mfa/qr.png");
      setQrUrl(await blobToDataUrl(blob));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function enable() {
    setIsSubmitting(true);
    try {
      await api("/api/auth/mfa/enable", { method: "POST", body: { code } });
      notify("Two-factor authentication enabled.");
      clearQr();
      setSetup(null);
      setCode("");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Invalid code", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove2fa(opts?: { code?: string; password?: string }) {
    setIsSubmitting(true);
    try {
      const body: { code?: string; password?: string } = {};
      if (opts?.code) body.code = opts.code;
      if (opts?.password) body.password = opts.password;
      await api("/api/auth/mfa/disable", { method: "POST", body });
      notify("Two-factor authentication removed. You can set it up again.");
      clearQr();
      setSetup(null);
      setCode("");
      setPassword("");
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove 2FA", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelSetup() {
    // Clears pending secret on the server so setup can be restarted cleanly.
    await remove2fa();
  }

  return (
    <div>
      <PageHead title="Security" subtitle="Manage two-factor authentication for your account." />
      <Card className="max-w-xl">
        <CardHeader className="grid grid-cols-[1fr_auto] items-center">
          <CardTitle className="inline-flex items-center gap-2">
            {enabled ? <ShieldCheck className="text-success" /> : <ShieldOff className="text-muted-foreground" />}
            Two-factor authentication
          </CardTitle>
          <Badge variant={enabled ? "success" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        </CardHeader>
        <CardContent>

        {enabled ? (
          <FieldGroup>
            <p className="text-sm text-muted-foreground">
              2FA is active. To remove it and set up again, enter a current authenticator code
              {" "}
              <strong>or</strong>
              {" "}
              your account password.
            </p>
            <Field>
              <FieldLabel htmlFor="rd-security-mfa-code">Authenticator code</FieldLabel>
              <Input
                id="rd-security-mfa-code"
                aria-label="Authenticator code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-security-mfa-password">Account password (if you don't have a code)</FieldLabel>
              <Input
                id="rd-security-mfa-password"
                type="password"
                autoComplete="current-password"
                aria-label="Account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting || (!code && !password)}
              onClick={() => void remove2fa({ code: code || undefined, password: password || undefined })}
            >
              <Trash2 data-icon="inline-start" /> Remove 2FA
            </Button>
          </FieldGroup>
        ) : setup ? (
          <FieldGroup>
            <p className="text-sm">
              Add this account to your authenticator app (Google Authenticator, Microsoft Authenticator,
              1Password…). Scan the QR code, or enter the secret manually, then confirm with a code.
            </p>
            {qrUrl && (
              <div className="mb-4 flex justify-center">
                <Card><CardContent><img src={qrUrl} alt="Authenticator setup QR code" className="size-52" /></CardContent></Card>
              </div>
            )}
            <Field>
              <span>Secret (manual entry)</span>
              <code className="block break-all bg-muted p-2 text-sm">{setup.secret}</code>
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-security-enable-code">Enter the 6-digit code</FieldLabel>
              <Input
                id="rd-security-enable-code"
                aria-label="6-digit code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => void cancelSetup()}
              >
                Cancel &amp; clear
              </Button>
              <Button
                type="button"
                disabled={isSubmitting || !code}
                onClick={() => void enable()}
              >
                Confirm &amp; enable
              </Button>
            </div>
          </FieldGroup>
        ) : (
          <FieldGroup>
            <p className="text-sm text-muted-foreground">Add a second layer of security — you'll enter a one-time code from your phone when signing in.</p>
            <Button type="button" disabled={isSubmitting} onClick={() => void startSetup()}>
              Set up 2FA
            </Button>
          </FieldGroup>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
