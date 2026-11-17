import { useState, type FormEvent } from "react";
import { SlidersHorizontal, UserPlus, X } from "lucide-react";
import { api } from "@/api/client";
import { hasProjectPermission, pmError, type PmMember, type PmPerson, type PmProject } from "@/api/pm";
import type { AccessRole, PermissionCatalog } from "@/api/types";
import { PermissionOverrides, type OverrideValue } from "@/components/access/PermissionOverrides";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, Modal, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useFetch } from "@/hooks/useApi";

/** Project people, their role and any per-person permission overrides. */
export function ProjectMembers({ project, members, onChanged }: {
  project: PmProject; members: PmMember[]; onChanged: () => void;
}) {
  const { notify } = useToast();
  const manage = hasProjectPermission(project, "members.manage");
  const people = useFetch<PmPerson[]>(manage ? "/api/pm/people" : null);
  const roles = useFetch<AccessRole[]>("/api/access/roles?scope=project");
  const [form, setForm] = useState({ user: "", role: "member" });
  const [state, setState] = useState({ busy: false, error: "" });
  const [editing, setEditing] = useState<PmMember | null>(null);
  const candidates = (people.data ?? []).filter((person) => !members.some((m) => m.user_id === person.id));
  const roleItems = (roles.data ?? []).map((role) => ({ value: role.key, label: role.name }));

  async function run(action: () => Promise<unknown>, message: string) {
    setState({ busy: true, error: "" });
    try { await action(); setState({ busy: false, error: "" }); notify(message); onChanged(); return true; }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); return false; }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!form.user) return;
    const ok = await run(() => api(`/api/pm/projects/${project.id}/members`, { method: "POST", body: { user_id: form.user, role: form.role } }), "Person added to the project.");
    if (ok) setForm({ user: "", role: "member" });
  }

  return <div className="flex flex-col gap-4">
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    {roles.error && <ErrorState message={roles.error} onRetry={roles.reload} />}
    {manage && <Card>
      <CardHeader>
        <CardTitle>Add people</CardTitle>
        <CardDescription>Only people on the project can see it. Add requesters and stakeholders as viewers.</CardDescription>
      </CardHeader>
      <CardContent>
        {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> : people.loading || roles.loading ? <Loading /> :
          <form onSubmit={(event) => void add(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FieldGroup className="grid flex-1 gap-3 sm:grid-cols-2">
              <TaskChoice id="pm-member-person" label="Person" value={form.user} items={[...(form.user ? [] : [{ value: "", label: "Choose a person" }]), ...candidates.map((p) => ({ value: p.id, label: p.email ? `${p.name} (${p.email})` : p.name }))]} onChange={(value) => setForm((c) => ({ ...c, user: value }))} />
              <TaskChoice id="pm-member-role" label="Project role" value={form.role} items={roleItems} onChange={(value) => setForm((c) => ({ ...c, role: value }))} />
            </FieldGroup>
            <Button type="submit" disabled={state.busy || !form.user}><UserPlus data-icon="inline-start" />Add</Button>
          </form>}
      </CardContent>
    </Card>}
    <Card>
      <CardHeader>
        <CardTitle>People on {project.key}</CardTitle>
        <CardDescription>{(roles.data ?? []).map((role) => `${role.name}: ${(role.description ?? "").replace(/\.$/, "").toLowerCase()}`).join(". ")}.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {members.map((member) => {
            const overrides = member.allow.length + member.deny.length;
            return <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.name}</p>
                {member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
              </div>
              {overrides > 0 && <Badge variant="info">{overrides === 1 ? "1 override" : `${overrides} overrides`}</Badge>}
              {manage && roleItems.length ? <Select items={roleItems} value={member.role} disabled={state.busy}
                onValueChange={(value) => value && value !== member.role && void run(() => api(`/api/pm/projects/${project.id}/members/${member.user_id}`, { method: "PATCH", body: { role: value } }), "Role updated.")}>
                <SelectTrigger className="w-40" aria-label={`Role for ${member.name}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{roleItems.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select> : <Badge variant="outline">{member.role_name || member.role}</Badge>}
              {manage && <Button variant="ghost" size="icon" aria-label={`Permissions for ${member.name}`} disabled={state.busy} onClick={() => setEditing(member)}><SlidersHorizontal /></Button>}
              {manage && <Button variant="ghost" size="icon" aria-label={`Remove ${member.name} from the project`} disabled={state.busy}
                onClick={() => void run(() => api(`/api/pm/projects/${project.id}/members/${member.user_id}`, { method: "DELETE" }), "Person removed from the project.")}><X /></Button>}
            </li>;
          })}
        </ul>
      </CardContent>
    </Card>
    {editing && <MemberPermissions project={project} member={editing} roles={roles.data ?? []}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify("Permissions updated."); onChanged(); }} />}
  </div>;
}

function MemberPermissions({ project, member, roles, onClose, onSaved }: {
  project: PmProject; member: PmMember; roles: AccessRole[]; onClose: () => void; onSaved: () => void;
}) {
  const catalog = useFetch<PermissionCatalog>("/api/access/catalog");
  const [value, setValue] = useState<OverrideValue>({ allow: member.allow, deny: member.deny });
  const [state, setState] = useState({ busy: false, error: "" });
  const granted = new Set(roles.find((role) => role.key === member.role)?.permissions ?? []);

  async function save() {
    setState({ busy: true, error: "" });
    try {
      await api(`/api/pm/projects/${project.id}/members/${member.user_id}`, { method: "PATCH", body: value });
      onSaved();
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }

  return <Modal title={`${member.name}'s permissions`} maxWidth={720} onClose={onClose}
    description={`Role: ${member.role_name || member.role}. Allow or deny single permissions on top of the role; a deny always wins.`}
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button onClick={() => void save()} disabled={state.busy || !catalog.data}>{state.busy && <Spinner data-icon="inline-start" />}Save permissions</Button>
    </>}>
    <div className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {catalog.error ? <ErrorState message={catalog.error} onRetry={catalog.reload} /> : !catalog.data ? <Loading /> :
        <PermissionOverrides permissions={catalog.data.project} granted={granted} value={value} onChange={setValue} disabled={state.busy} />}
    </div>
  </Modal>;
}
