import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { ApiToken } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function ApiTokensPage() {
  const { notify } = useToast();
  const tokens = useFetch<ApiToken[]>("/api/api-tokens");
  const [creating, setCreating] = useState(false);

  async function revoke(t: ApiToken) {
    if (!confirm(`Revoke "${t.name}"? Integrations using it will stop working.`)) return;
    await api(`/api/api-tokens/${t.id}`, { method: "DELETE" });
    tokens.reload();
    notify("Token revoked.");
  }

  return (
    <div>
      <PageHead
        title="API Tokens"
        subtitle="Scoped read-only tokens for external integrations."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}>
            <Plus size={15} /> New token
          </button>
        }
      />
      <p className="muted text-sm">
        Callers authenticate with <code>Authorization: Bearer &lt;token&gt;</code> against
        <code> /api/public-api/*</code> (e.g. <code>/employees</code>, <code>/leads</code>).
        Each endpoint requires the matching scope.
      </p>
      {tokens.loading ? (
        <Loading />
      ) : (tokens.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="🔑" message="No API tokens" hint="Create a scoped token for a partner integration." /></div>
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Token</th><th>Scopes</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {tokens.data!.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td><code>{t.prefix}…</code></td>
                  <td>{t.scopes.map((s) => <span key={s} className="badge violet mr-1">{s}</span>)}</td>
                  <td className="muted text-xs">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "never"}</td>
                  <td className="text-right"><button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => revoke(t)}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); tokens.reload(); }} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ scopes: string[] }>("/api/api-tokens/scopes").then((r) => setAvailable(r.scopes)).catch(() => {});
  }, []);

  function toggle(s: string) {
    setScopes((a) => (a.includes(s) ? a.filter((x) => x !== s) : [...a, s]));
  }
  async function save() {
    if (!name.trim()) { notify("Name required", "error"); return; }
    setBusy(true);
    try {
      const res = await api<{ token: string }>("/api/api-tokens", { method: "POST", body: { name: name.trim(), scopes } });
      setCreated(res.token);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal title="Token created" onClose={onDone} maxWidth={520}>
        <p className="text-sm">Copy this token now — it won't be shown again.</p>
        <code className="block rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)", wordBreak: "break-all" }}>{created}</code>
        <div className="row mt-3" style={{ justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={onDone}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New API token" onClose={onClose} maxWidth={480}>
      <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Partner CRM sync" /></div>
      <label className="muted text-xs">Scopes</label>
      <div className="mt-1 flex flex-wrap gap-1">
        {available.map((s) => (
          <button type="button" key={s} className={scopes.includes(s) ? "btn-sm btn-primary" : "btn-sm"} style={{ flex: "0 0 auto" }} onClick={() => toggle(s)}>{s}</button>
        ))}
      </div>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}><KeyRound size={14} /> {busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}
