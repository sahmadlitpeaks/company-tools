import { useEffect, useState } from "react";
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

/** Admin-configurable keys/tokens for ad channels (Facebook, Google, etc.). */
export default function IntegrationsSettings() {
  const { notify } = useToast();
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);

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
    <div className="card">
      <div className="spread mb-1">
        <h3 className="m-0 flex items-center gap-2">
          <span className="text-xl">📣</span> Marketing integrations
        </h3>
      </div>
      <p className="muted mt-0 text-sm">
        Connect your ad accounts so campaign data can be pulled in. Tokens are
        stored encrypted and never shown again.
      </p>

      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <div
            key={it.provider}
            className="rounded-xl p-3"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            <div className="spread mb-2">
              <strong>{it.label}</strong>
              <span className={`badge ${it.configured ? "green" : ""}`}>
                {it.configured ? "Connected" : "Not set"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {it.fields.map((f) => (
                <div className="field" key={f.key} style={{ marginBottom: 0 }}>
                  <label>
                    {f.label}
                    {f.secret && f.is_set && (
                      <span className="ml-1 text-xs font-normal text-emerald-600">• set</span>
                    )}
                  </label>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={drafts[it.provider]?.[f.key] ?? ""}
                    placeholder={f.secret && f.is_set ? "•••••• (leave blank to keep)" : ""}
                    onChange={(e) => set(it.provider, f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn-primary mt-3 flex-none"
              disabled={saving === it.provider}
              onClick={() => save(it.provider)}
            >
              {saving === it.provider ? "Saving…" : `Save ${it.label}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
