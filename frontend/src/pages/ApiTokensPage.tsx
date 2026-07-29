import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { ApiToken } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function ApiTokensPage() {
  const { notify } = useToast();
  const tokens = useFetch<ApiToken[]>("/api/api-tokens");
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);

  async function revoke(t: ApiToken) {
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
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> New token
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        Callers authenticate with <code>Authorization: Bearer &lt;token&gt;</code> against
        <code> /api/public-api/*</code> (e.g. <code>/employees</code>, <code>/leads</code>).
        Each endpoint requires the matching scope.
      </p>
      {tokens.loading ? (
        <Loading />
      ) : (tokens.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<KeyRound />} message="No API tokens" hint="Create a scoped token for a partner integration." /></CardContent></Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
           <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Token</TableHead><TableHead>Scopes</TableHead><TableHead>Last used</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {tokens.data!.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-[20rem] whitespace-normal"><span className="block truncate font-medium" title={t.name}>{t.name}</span></TableCell>
                  <TableCell><code>{t.prefix}…</code></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{t.scopes.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div></TableCell>
                  <TableCell className="text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "never"}</TableCell>
                  <TableCell className="text-right"><Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setRevokeTarget(t)}><Trash2 /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
           </Table>
          </CardContent>
        </Card>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); tokens.reload(); }} />}
      {revokeTarget && (
        <ConfirmDialog
          title={`Revoke API token "${revokeTarget.name}"?`}
          message={`Integrations using "${revokeTarget.name}" will stop working.`}
          confirmLabel="Revoke token"
          danger
          onConfirm={() => revoke(revokeTarget)}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void api<{ scopes: string[] }>("/api/api-tokens/scopes").then((r) => setAvailable(r.scopes)).catch(() => {});
  }, []);

  async function save() {
    if (!name.trim()) { notify("Name required", "error"); return; }
    setIsSubmitting(true);
    try {
      const res = await api<{ token: string }>("/api/api-tokens", { method: "POST", body: { name: name.trim(), scopes } });
      setCreated(res.token);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    return (
      <Modal title="Token created" onClose={onDone} maxWidth={520}>
        <p className="text-sm">Copy this token now - it won't be shown again.</p>
        <code className="block break-all bg-muted p-2 text-xs">{created}</code>
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={onDone}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New API token" onClose={onClose} maxWidth={480}>
      <FieldGroup>
        <Field><FieldLabel htmlFor="rd-apitokenspage-104-name">Name</FieldLabel><Input id="rd-apitokenspage-104-name" aria-label="e.g. Partner CRM sync" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Partner CRM sync" /></Field>
        <FieldSet>
          <FieldLegend variant="label">Scopes</FieldLegend>
          <ToggleGroup value={scopes} onValueChange={(value) => setScopes(value)} multiple className="flex-wrap justify-start">
            {available.map((s) => <ToggleGroupItem key={s} value={s}>{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </FieldSet>
      </FieldGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}><KeyRound data-icon="inline-start" /> {isSubmitting ? "Creating…" : "Create"}</Button>
      </div>
    </Modal>
  );
}
