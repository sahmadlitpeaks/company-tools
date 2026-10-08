import { useState, type FormEvent } from "react";
import { Bot, Check, Copy, KeyRound, X } from "lucide-react";
import { api } from "@/api/client";
import { pmError } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { useAuth } from "@/auth/AuthContext";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";

type AiToken = {
  id: string; name: string; can_write: boolean; state: "active" | "expired" | "revoked";
  expires_at: string | null; revoked_at: string | null; last_used_at: string | null; created_at: string;
  owner_name: string | null; token?: string;
};

const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];
const STATE_BADGE = { active: "success", expired: "outline", revoked: "destructive" } as const;
const TOOLS = [
  ["tracker_list_projects", "Projects you can see, with health and progress"],
  ["tracker_get_project_summary", "Status counts, active sprint, overdue work, epic progress"],
  ["tracker_search_issues", "Find issues by text, status, type, assignee or sprint"],
  ["tracker_get_issue", "One issue with description, links and comments"],
  ["tracker_create_issue", "Create an issue (write token)"],
  ["tracker_update_issue", "Change fields such as priority, assignee or dates (write token)"],
  ["tracker_move_issue", "Move an issue to another status (write token)"],
  ["tracker_add_comment", "Comment on an issue (write token)"],
] as const;

function date(value: string | null) {
  return value ? dateLabel(value.slice(0, 10)) : "never";
}

export default function AiAccessPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const status = useFetch<{ mcp_path: string; can_write_allowed: boolean }>("/api/pm/ai/status");
  const mine = useFetch<AiToken[]>("/api/pm/ai/tokens");
  const everyone = useFetch<AiToken[]>(user?.is_admin ? "/api/pm/ai/tokens/all" : null);
  const [form, setForm] = useState({ name: "", expires: "90", write: false });
  const [created, setCreated] = useState<AiToken | null>(null);
  const [copied, setCopied] = useState("");
  const [revoking, setRevoking] = useState<AiToken | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const endpoint = `${window.location.origin}${status.data?.mcp_path ?? "/api/mcp/"}`;

  async function create(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const token = await api<AiToken>("/api/pm/ai/tokens", { method: "POST", body: { name: form.name.trim(), can_write: form.write, expires_in_days: Number(form.expires) } });
      setCreated(token);
      setCopied("");
      setForm({ name: "", expires: form.expires, write: false });
      setState({ busy: false, error: "" });
      void mine.refresh();
      void everyone.refresh();
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); }
    catch { notify("Select the text and copy it instead.", "error"); }
  }
  async function revoke(token: AiToken) {
    setState({ busy: true, error: "" });
    try {
      await api(`/api/pm/ai/tokens/${token.id}`, { method: "DELETE" });
      if (created?.id === token.id) setCreated(null);
      setRevoking(null);
      setState({ busy: false, error: "" });
      notify("Token revoked. Assistants using it lose access immediately.");
      void mine.refresh();
      void everyone.refresh();
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }

  const secret = created?.token ?? "";
  const claudeCode = `claude mcp add --transport http company-projects ${endpoint} --header "Authorization: Bearer ${secret}"`;
  const generic = JSON.stringify({ mcpServers: { "company-projects": { type: "http", url: endpoint, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);

  return <div className="flex flex-col gap-5">
    <PageHead headingLevel={1} title="AI access" subtitle="Let AI assistants such as Claude or ChatGPT read and update your project issues through MCP, acting as you." />
    {state.error && !revoking && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="size-4" aria-hidden="true" />How it works</CardTitle>
        <CardDescription>
          An assistant connects to the endpoint below with a personal token. It sees only the projects you're on and can only do what your project role allows. Tokens are read-only unless an administrator has given you AI write access. Only share project details with assistants your organisation has approved.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>Endpoint: <code className="break-all bg-muted px-1">{endpoint}</code></p>
        <p className="text-muted-foreground">Works with MCP clients that let you set an Authorization header, such as Claude Code, Claude Desktop, Cursor, VS Code and ChatGPT's developer mode.</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {TOOLS.map(([name, hint]) => <li key={name}><code className="text-xs">{name}</code> <span className="text-muted-foreground">{hint}</span></li>)}
        </ul>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Create a token</CardTitle><CardDescription>Each token is shown once. Create one per assistant so you can revoke them separately.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.error ? <ErrorState message={status.error} onRetry={status.reload} /> :
          <form onSubmit={(event) => void create(event)} className="flex flex-col gap-3">
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ai-token-name">Name</FieldLabel>
                <Input id="ai-token-name" required maxLength={120} placeholder="Claude on my laptop" value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} />
              </Field>
              <TaskChoice id="ai-token-expiry" label="Expires after" value={form.expires} items={EXPIRY} onChange={(value) => setForm((c) => ({ ...c, expires: value }))} />
            </FieldGroup>
            <Field orientation="horizontal" data-disabled={!status.data?.can_write_allowed || undefined}>
              <Checkbox id="ai-token-write" checked={form.write} disabled={!status.data?.can_write_allowed} onCheckedChange={(checked) => setForm((c) => ({ ...c, write: checked === true }))} />
              <FieldContent>
                <FieldLabel htmlFor="ai-token-write">Allow changes</FieldLabel>
                <FieldDescription>
                  {status.data?.can_write_allowed
                    ? "The assistant can create, update, move and comment on issues as you."
                    : "Read-only. Ask an administrator for \"Projects: AI write access\" to allow changes."}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Button type="submit" className="self-start" disabled={state.busy || !form.name.trim()}><KeyRound data-icon="inline-start" />Create token</Button>
          </form>}

        {created && secret && <Alert role="status">
          <AlertTitle>Copy your token now</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>Only a fingerprint is stored, so it can't be shown again. Treat it like a password: anyone with it can {created.can_write ? "read and change" : "read"} your project issues until it expires on {date(created.expires_at)}.</span>
            <Snippet id="ai-snippet-token" label="Token" text={secret} copied={copied === "token"} onCopy={() => void copy("token", secret)} rows={1} />
            <Snippet id="ai-snippet-claude" label="Claude Code" text={claudeCode} copied={copied === "claude"} onCopy={() => void copy("claude", claudeCode)} rows={2} />
            <Snippet id="ai-snippet-config" label="Other MCP clients (JSON config)" text={generic} copied={copied === "json"} onCopy={() => void copy("json", generic)} rows={11} />
          </AlertDescription>
        </Alert>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Your tokens</CardTitle></CardHeader>
      <CardContent>
        {mine.error ? <ErrorState message={mine.error} onRetry={mine.reload} /> : !mine.data ? <Loading /> :
          <TokenTable tokens={mine.data} onRevoke={setRevoking} caption="Your AI access tokens" />}
      </CardContent>
    </Card>

    {user?.is_admin && <Card>
      <CardHeader><CardTitle>All tokens</CardTitle><CardDescription>Every AI access token in the organisation. Revoke any you don't recognise.</CardDescription></CardHeader>
      <CardContent>
        {everyone.error ? <ErrorState message={everyone.error} onRetry={everyone.reload} /> : !everyone.data ? <Loading /> :
          <TokenTable tokens={everyone.data} onRevoke={setRevoking} showOwner caption="All AI access tokens" />}
      </CardContent>
    </Card>}

    <AlertDialog open={Boolean(revoking)} onOpenChange={(open) => !open && !state.busy && setRevoking(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke "{revoking?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>Assistants using this token lose access straight away. This can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setRevoking(null)} disabled={state.busy}>Cancel</Button>
          <Button variant="destructive" disabled={state.busy} onClick={() => revoking && void revoke(revoking)}>Revoke token</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function Snippet({ id, label, text, copied, onCopy, rows }: { id: string; label: string; text: string; copied: boolean; onCopy: () => void; rows: number }) {
  return <Field>
    <div className="flex items-center justify-between gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Button type="button" size="sm" variant="outline" onClick={onCopy}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? "Copied" : "Copy"}</Button>
    </div>
    <Textarea id={id} readOnly rows={rows} value={text} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
  </Field>;
}

function TokenTable({ tokens, onRevoke, showOwner = false, caption }: { tokens: AiToken[]; onRevoke: (token: AiToken) => void; showOwner?: boolean; caption: string }) {
  if (tokens.length === 0) return <p className="text-sm text-muted-foreground">No tokens yet.</p>;
  return <TableSurface>
    <Table aria-label={caption}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          {showOwner && <TableHead>Owner</TableHead>}
          <TableHead>Access</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Last used</TableHead>
          <TableHead className="hidden md:table-cell">Expires</TableHead>
          <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tokens.map((token) => <TableRow key={token.id}>
          <TableCell className="max-w-48 truncate font-medium">{token.name}</TableCell>
          {showOwner && <TableCell>{token.owner_name ?? "Former employee"}</TableCell>}
          <TableCell>{token.can_write ? "Read and change" : "Read only"}</TableCell>
          <TableCell><Badge variant={STATE_BADGE[token.state]}>{token.state === "active" ? "Active" : token.state === "expired" ? "Expired" : "Revoked"}</Badge></TableCell>
          <TableCell className="hidden md:table-cell">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "Never"}</TableCell>
          <TableCell className="hidden md:table-cell">{date(token.expires_at)}</TableCell>
          <TableCell>{token.state === "active" && <Button size="sm" variant="ghost" onClick={() => onRevoke(token)} aria-label={`Revoke ${token.name}`}><X data-icon="inline-start" />Revoke</Button>}</TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </TableSurface>;
}
