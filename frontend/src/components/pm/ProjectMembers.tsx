import { useState, type FormEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { api } from "@/api/client";
import { labelOf, pmError, PROJECT_ROLES, type PmMember, type PmPerson, type PmProject, type ProjectRole } from "@/api/pm";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFetch } from "@/hooks/useApi";

/** Project people and their roles; administrators add, change and remove. */
export function ProjectMembers({ project, members, onChanged }: {
  project: PmProject; members: PmMember[]; onChanged: () => void;
}) {
  const { notify } = useToast();
  const manage = project.my_role === "admin";
  const people = useFetch<PmPerson[]>(manage ? "/api/pm/people" : null);
  const [form, setForm] = useState<{ user: string; role: ProjectRole }>({ user: "", role: "member" });
  const [state, setState] = useState({ busy: false, error: "" });
  const candidates = (people.data ?? []).filter((person) => !members.some((m) => m.user_id === person.id));

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
    {manage && <Card>
      <CardHeader>
        <CardTitle>Add people</CardTitle>
        <CardDescription>Only people on the project can see it. Add requesters and stakeholders as viewers.</CardDescription>
      </CardHeader>
      <CardContent>
        {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> : people.loading ? <Loading /> :
          <form onSubmit={(event) => void add(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FieldGroup className="grid flex-1 gap-3 sm:grid-cols-2">
              <TaskChoice id="pm-member-person" label="Person" value={form.user} items={[...(form.user ? [] : [{ value: "", label: "Choose a person" }]), ...candidates.map((p) => ({ value: p.id, label: p.email ? `${p.name} (${p.email})` : p.name }))]} onChange={(value) => setForm((c) => ({ ...c, user: value }))} />
              <TaskChoice id="pm-member-role" label="Project role" value={form.role} items={PROJECT_ROLES} onChange={(value) => setForm((c) => ({ ...c, role: value as ProjectRole }))} />
            </FieldGroup>
            <Button type="submit" disabled={state.busy || !form.user}><UserPlus data-icon="inline-start" />Add</Button>
          </form>}
      </CardContent>
    </Card>}
    <Card>
      <CardHeader>
        <CardTitle>People on {project.key}</CardTitle>
        <CardDescription>{PROJECT_ROLES.map((role) => `${role.label}: ${role.hint.toLowerCase()}`).join(". ")}.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {members.map((member) => <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{member.name}</p>
              {member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
            </div>
            {manage ? <Select items={PROJECT_ROLES} value={member.role} disabled={state.busy}
              onValueChange={(value) => value && value !== member.role && void run(() => api(`/api/pm/projects/${project.id}/members/${member.user_id}`, { method: "PATCH", body: { role: value } }), "Role updated.")}>
              <SelectTrigger className="w-40" aria-label={`Role for ${member.name}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{PROJECT_ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select> : <Badge variant="outline">{labelOf(PROJECT_ROLES, member.role)}</Badge>}
            {manage && <Button variant="ghost" size="icon" aria-label={`Remove ${member.name} from the project`} disabled={state.busy}
              onClick={() => void run(() => api(`/api/pm/projects/${project.id}/members/${member.user_id}`, { method: "DELETE" }), "Person removed from the project.")}><X /></Button>}
          </li>)}
        </ul>
      </CardContent>
    </Card>
  </div>;
}
