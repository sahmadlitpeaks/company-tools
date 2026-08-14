import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useToast } from "./ui";

interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  value?: string | null;
  is_set: boolean;
}
interface IntegrationStatus {
  provider: string;
  label: string;
  configured: boolean;
  fields: IntegrationField[];
}

interface TestResult {
  ok: boolean;
  account_name?: string | null;
  currency?: string | null;
  error?: string | null;
}

// Providers with an ad-sync client behind them. Instagram is excluded by
// design - IG ad spend arrives via the Facebook/Meta credential.
const TESTABLE = new Set(["facebook", "google_ads", "tiktok"]);

/** Admin-configurable keys/tokens for ad channels (Facebook, Google, etc.). */
export default function IntegrationsSettings() {
  const { notify } = useToast();
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { ok: boolean; label: string }>>({});

  async function testConnection(provider: string) {
    setTesting(provider);
    try {
      const result = await api<TestResult>(
        `/api/settings/integrations/${provider}/test`,
        { method: "POST" },
      );
      setTested((current) => ({
        ...current,
        [provider]: {
          ok: result.ok,
          label: result.ok
            ? [result.account_name, result.currency].filter(Boolean).join(" · ") || "Reached"
            : result.error ?? "Failed",
        },
      }));
      notify(
        result.ok ? "Connection verified." : result.error ?? "Connection failed",
        result.ok ? undefined : "error",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Test failed", "error");
    } finally {
      setTesting(null);
    }
  }

  function seed(list: IntegrationStatus[]) {
    setItems(list);
    const d: Record<string, Record<string, string>> = {};
    for (const it of list) {
      d[it.provider] = {};
      for (const f of it.fields) d[it.provider][f.key] = f.secret ? "" : f.value ?? "";
    }
    setDrafts(d);
  }

  useEffect(() => {
    api<IntegrationStatus[]>("/api/settings/integrations").then(seed).catch(() => {});
  }, []);

  async function save(provider: string) {
    setSaving(provider);
    try {
      const list = await api<IntegrationStatus[]>(
        `/api/settings/integrations/${provider}`,
        { method: "PUT", body: { values: drafts[provider] } },
      );
      seed(list);
      notify("Integration saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  const set = (provider: string, key: string, v: string) =>
    setDrafts((d) => ({ ...d, [provider]: { ...d[provider], [key]: v } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone aria-hidden="true" /> Marketing integrations
        </CardTitle>
        <CardDescription>
        Connect your ad accounts so campaign data can be pulled in. Tokens are
        stored encrypted and never shown again. "Not set" only reports whether a
        field is filled - use Test connection to confirm the account is reachable.
        Instagram ad spend arrives through the Facebook / Meta credential, so it
        has no separate connection to test.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {items.map((it) => (
          <Card
            key={it.provider}
            size="sm"
            className="bg-muted/40"
          >
            <CardHeader className="grid grid-cols-[1fr_auto] items-center">
              <CardTitle>{it.label}</CardTitle>
              <Badge variant={it.configured ? "success" : "secondary"}>
                {it.configured ? "Connected" : "Not set"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
            <FieldGroup className="grid gap-2 sm:grid-cols-2">
              {it.fields.map((f) => (
                <Field key={f.key}>
                  <FieldLabel htmlFor={`integration-${it.provider}-${f.key}`}>
                    {f.label}
                    {f.secret && f.is_set && (
                      <span className="ml-1 text-xs font-normal text-success">• set</span>
                    )}
                  </FieldLabel>
                  <Input id={`integration-${it.provider}-${f.key}`}
                    type={f.secret ? "password" : "text"}
                    value={drafts[it.provider]?.[f.key] ?? ""}
                    placeholder={f.secret && f.is_set ? "•••••• (leave blank to keep)" : ""}
                    onChange={(e) => set(it.provider, f.key, e.target.value)}
                  />
                </Field>
              ))}
            </FieldGroup>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button"
                disabled={saving === it.provider}
                onClick={() => save(it.provider)}
              >
                {saving === it.provider ? "Saving…" : `Save ${it.label}`}
              </Button>
              {TESTABLE.has(it.provider) && (
                <Button type="button" variant="outline"
                  disabled={testing === it.provider || !it.configured}
                  onClick={() => testConnection(it.provider)}
                >
                  {testing === it.provider ? "Testing…" : "Test connection"}
                </Button>
              )}
              {tested[it.provider] && (
                <span className={tested[it.provider].ok ? "text-xs text-success" : "text-xs text-destructive"}>
                  {tested[it.provider].label}
                </span>
              )}
            </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
