import { useState, type FormEvent } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { api } from "@/api/client";
import { labelOf, pmError, SHARE_VIEWS, type PmProject, type PmShareLink, type ShareView } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, useToast } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useFetch } from "@/hooks/useApi";

const EXPIRY = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "0", label: "Never" },
];
const STATE_BADGE = { active: "success", expired: "outline", revoked: "destructive" } as const;

/** Create, copy and revoke read-only links to a project view. */
export function ShareLinks({ project }: { project: PmProject }) {
  const { notify } = useToast();
  const links = useFetch<PmShareLink[]>(`/api/pm/projects/${project.id}/shares`);
  const [form, setForm] = useState<{ view: ShareView; label: string; expires: string }>({ view: "board", label: "", expires: "30" });
  const [created, setCreated] = useState<PmShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<PmShareLink | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const url = created?.path ? `${window.location.origin}${created.path}` : "";

  async function create(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const link = await api<PmShareLink>(`/api/pm/projects/${project.id}/shares`, {
        method: "POST", body: { view: form.view, label: form.label.trim() || null, expires_in_days: Number(form.expires) },
      });
      setCreated(link);
      setCopied(false);
      setForm((current) => ({ ...current, label: "" }));
      setState({ busy: false, error: "" });
      void links.refresh();
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      notify("Copy the link from the box instead.", "error");
    }
  }
  async function revoke(link: PmShareLink) {
    setState({ busy: true, error: "" });
    try {
      await api(`/api/pm/shares/${link.id}`, { method: "DELETE" });
      setRevoking(null);
      setState({ busy: false, error: "" });
      if (created?.id === link.id) setCreated(null);
      notify("Link revoked. It stops working immediately.");
      void links.refresh();
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle>Share links</CardTitle>
      <CardDescription>
        Give people without an account a read-only view. Shared views show issue keys, summaries, status, assignees, points and dates only, never descriptions, comments, attachments or labels.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {state.error && !revoking && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <form onSubmit={(event) => void create(event)} className="flex flex-col gap-3">
        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <TaskChoice id="pm-share-view" label="View" value={form.view} items={SHARE_VIEWS} onChange={(value) => setForm((c) => ({ ...c, view: value as ShareView }))} />
          <TaskChoice id="pm-share-expiry" label="Expires after" value={form.expires} items={EXPIRY} onChange={(value) => setForm((c) => ({ ...c, expires: value }))} />
          <Field>
            <FieldLabel htmlFor="pm-share-label">Note (optional)</FieldLabel>
            <Input id="pm-share-label" maxLength={120} placeholder="For Dr T" value={form.label} onChange={(event) => setForm((c) => ({ ...c, label: event.target.value }))} />
          </Field>
        </FieldGroup>
        <FieldDescription>{SHARE_VIEWS.find((v) => v.value === form.view)?.hint}.</FieldDescription>
        <Button type="submit" variant="outline" className="self-start" disabled={state.busy}><Link2 data-icon="inline-start" />Create link</Button>
      </form>

      {created && url && <Alert role="status">
        <AlertTitle>Copy this link now</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>For security only a fingerprint of the link is kept, so it can't be shown again. Anyone with it can see the {labelOf(SHARE_VIEWS, created.view).toLowerCase()} view{created.expires_at ? ` until ${dateLabel(created.expires_at.slice(0, 10))}` : ""}.</span>
          <InputGroup>
            <InputGroupInput aria-label="New share link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={() => void copy()} aria-label="Copy link">{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </AlertDescription>
      </Alert>}

      {links.error ? <ErrorState message={links.error} onRetry={links.reload} /> : !links.data ? <Loading /> :
        links.data.length === 0 ? <p className="text-sm text-muted-foreground">No share links yet.</p> :
        <ul className="flex flex-col divide-y divide-border border border-border">
          {links.data.map((link) => <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="font-medium">{labelOf(SHARE_VIEWS, link.view)}</span>
            <Badge variant={STATE_BADGE[link.state]}>{link.state === "active" ? "Active" : link.state === "expired" ? "Expired" : "Revoked"}</Badge>
            {link.label && <span className="min-w-0 truncate">{link.label}</span>}
            <span className="text-xs text-muted-foreground">
              {link.state === "active" ? (link.expires_at ? `Expires ${dateLabel(link.expires_at.slice(0, 10))}` : "No expiry") : link.state === "expired" ? `Expired ${dateLabel(link.expires_at!.slice(0, 10))}` : `Revoked ${dateLabel(link.revoked_at!.slice(0, 10))}`}
              {` · ${link.view_count} ${link.view_count === 1 ? "view" : "views"}`}
              {link.created_by_name && ` · by ${link.created_by_name}`}
            </span>
            {link.state === "active" && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRevoking(link)}><X data-icon="inline-start" />Revoke</Button>}
          </li>)}
        </ul>}

      <AlertDialog open={Boolean(revoking)} onOpenChange={(open) => !open && !state.busy && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this {revoking ? labelOf(SHARE_VIEWS, revoking.view).toLowerCase() : ""} link?</AlertDialogTitle>
            <AlertDialogDescription>Anyone using it will see "link not available" straight away. This can't be undone; create a new link to share again.</AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)} disabled={state.busy}>Cancel</Button>
            <Button variant="destructive" disabled={state.busy} onClick={() => revoking && void revoke(revoking)}>Revoke link</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent>
  </Card>;
}
