import { useMemo, useState, type FormEvent } from "react";
import { Copy, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { api } from "@/api/client";
import type { AccessRole, Department, PermissionCatalog, PermissionDef, PermissionScope, User, UserAccess } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { groupPermissions, PermissionOverrides, type OverrideValue } from "@/components/access/PermissionOverrides";
import { ConfirmDialog, Empty, ErrorState, Loading, Modal, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong. Try again.";
}

/** Roles, platform grants and department roles (roles.manage). */
export default function RolesPage() {
  const { hasPermission } = useAuth();
  const departmentsAllowed = hasPermission("departments.manage");
  const catalog = useFetch<PermissionCatalog>("/api/access/catalog");
  const roles = useFetch<AccessRole[]>("/api/access/roles");

  return <div className="flex flex-col gap-6">
    <PageHead headingLevel={1} title="Roles & permissions"
      subtitle="Bundle permissions into roles, then grant roles to people, departments and project members. A deny always wins." />
    {catalog.error || roles.error ? <ErrorState message={catalog.error || roles.error || ""} onRetry={() => { catalog.reload(); roles.reload(); }} /> :
      !catalog.data || !roles.data ? <Loading /> :
        <Tabs defaultValue="platform">
          <TabsList>
            <TabsTrigger value="platform">Platform roles</TabsTrigger>
            <TabsTrigger value="project">Project roles</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            {departmentsAllowed && <TabsTrigger value="departments">Departments</TabsTrigger>}
          </TabsList>
          {(["platform", "project"] as const).map((scope) => <TabsContent key={scope} value={scope} className="pt-4">
            <RoleList scope={scope} roles={roles.data!.filter((role) => role.scope === scope)}
              permissions={catalog.data![scope]} onChanged={roles.reload} />
          </TabsContent>)}
          <TabsContent value="people" className="pt-4">
            <PeopleAccess roles={roles.data.filter((role) => role.scope === "platform")} catalog={catalog.data} />
          </TabsContent>
          {departmentsAllowed && <TabsContent value="departments" className="pt-4">
            <DepartmentRoles roles={roles.data.filter((role) => role.scope === "platform")} onChanged={roles.reload} />
          </TabsContent>}
        </Tabs>}
  </div>;
}

function RoleList({ scope, roles, permissions, onChanged }: {
  scope: PermissionScope; roles: AccessRole[]; permissions: PermissionDef[]; onChanged: () => void;
}) {
  const { notify } = useToast();
  const [editing, setEditing] = useState<AccessRole | "new" | null>(null);
  const [deleting, setDeleting] = useState<AccessRole | null>(null);
  const [error, setError] = useState("");
  const labels = useMemo(() => new Map(permissions.map((p) => [p.key, p.label])), [permissions]);

  async function clone(role: AccessRole) {
    setError("");
    try { await api(`/api/access/roles/${role.id}/clone`, { method: "POST" }); notify(`Copied ${role.name}.`); onChanged(); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function remove(role: AccessRole) {
    await api(`/api/access/roles/${role.id}`, { method: "DELETE" });
    notify(`Deleted ${role.name}.`);
    onChanged();
  }
  const summary = (role: AccessRole) => role.is_protected || role.permissions.length === permissions.length ? "Every permission"
    : role.permissions.slice(0, 4).map((key) => labels.get(key) ?? key).join(", ") + (role.permissions.length > 4 ? ` and ${role.permissions.length - 4} more` : "");
  const usage = (role: AccessRole) => scope === "project" ? `${role.usage} member${role.usage === 1 ? "" : "s"}` : `${role.usage} grant${role.usage === 1 ? "" : "s"}`;
  const actions = (role: AccessRole) => role.is_protected ? <Badge variant="outline">Protected</Badge> : <div className="flex justify-end gap-1">
    <Button variant="ghost" size="icon" aria-label={`Edit ${role.name}`} onClick={() => setEditing(role)}><Pencil /></Button>
    <Button variant="ghost" size="icon" aria-label={`Copy ${role.name}`} onClick={() => void clone(role)}><Copy /></Button>
    {!role.is_system && <Button variant="ghost" size="icon" aria-label={`Delete ${role.name}`} onClick={() => setDeleting(role)}><Trash2 /></Button>}
  </div>;

  return <Card>
    <CardHeader>
      <CardTitle>{scope === "platform" ? "Platform roles" : "Project roles"}</CardTitle>
      <CardDescription>{scope === "platform"
        ? "Granted to people or departments across the whole system."
        : "Each project member holds one of these, plus any per-person overrides set on the project's People tab."}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div><Button onClick={() => setEditing("new")}><Plus data-icon="inline-start" />New {scope} role</Button></div>
      {!roles.length ? <Empty message="No roles yet" hint="Create the first role." /> : <>
        <ul className="flex flex-col divide-y divide-border md:hidden">
          {roles.map((role) => <li key={role.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{role.name} {role.is_system && <Badge variant="outline">Starter</Badge>}</p>
                <p className="text-xs text-muted-foreground">{usage(role)}</p>
              </div>
              {actions(role)}
            </div>
            <p className="text-sm text-muted-foreground">{summary(role) || "No permissions"}</p>
          </li>)}
        </ul>
        <TableSurface className="hidden md:block">
          <Table>
            <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Permissions</TableHead><TableHead>In use</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {roles.map((role) => <TableRow key={role.id}>
                <TableCell className="align-top">
                  <p className="font-medium">{role.name} {role.is_system && <Badge variant="outline">Starter</Badge>}</p>
                  {role.description && <p className="max-w-xs whitespace-normal text-xs text-muted-foreground">{role.description}</p>}
                </TableCell>
                <TableCell className="max-w-md whitespace-normal align-top text-sm">{summary(role) || "No permissions"}</TableCell>
                <TableCell className="align-top">{usage(role)}</TableCell>
                <TableCell className="align-top">{actions(role)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </TableSurface>
      </>}
    </CardContent>
    {editing && <RoleDialog scope={scope} role={editing === "new" ? null : editing} permissions={permissions}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify("Role saved."); onChanged(); }} />}
    {deleting && <ConfirmDialog title={`Delete ${deleting.name}?`} danger confirmLabel="Delete role"
      message="The role is removed for good. A role that is still granted to anyone can't be deleted."
      onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
  </Card>;
}

function RoleDialog({ scope, role, permissions, onClose, onSaved }: {
  scope: PermissionScope; role: AccessRole | null; permissions: PermissionDef[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(role?.permissions ?? []));
  const [state, setState] = useState({ busy: false, error: "" });

  function toggle(key: string, on: boolean) {
    setChosen((current) => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    const body = { name, description, permissions: [...chosen] };
    try {
      if (role) await api(`/api/access/roles/${role.id}`, { method: "PATCH", body });
      else await api("/api/access/roles", { method: "POST", body: { ...body, scope } });
      onSaved();
    } catch (cause) { setState({ busy: false, error: errorText(cause) }); }
  }

  return <Modal title={role ? `Edit ${role.name}` : `New ${scope} role`} maxWidth={720} onClose={onClose}
    description={role?.usage ? `Changes apply straight away to everyone holding this role (${role.usage}).` : "Choose what holders of this role can do."}
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button type="submit" form="role-form" disabled={state.busy || !name.trim()}>{state.busy && <Spinner data-icon="inline-start" />}Save role</Button>
    </>}>
    <form id="role-form" onSubmit={(event) => void save(event)} className="flex flex-col gap-5">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="role-name">Name</FieldLabel>
          <Input id="role-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="role-description">Description</FieldLabel>
          <Textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
        </Field>
      </FieldGroup>
      {groupPermissions(permissions).map(([group, items]) => <FieldSet key={group}>
        <FieldLegend variant="label">{group}</FieldLegend>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((permission) => {
            const id = `role-perm-${permission.key.replace(/\W/g, "-")}`;
            return <Field key={permission.key} orientation="horizontal">
              <Checkbox id={id} checked={chosen.has(permission.key)} onCheckedChange={(checked) => toggle(permission.key, checked === true)} />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor={id}>{permission.label}</FieldLabel>
                <FieldDescription>{permission.description}</FieldDescription>
              </div>
            </Field>;
          })}
        </div>
      </FieldSet>)}
    </form>
  </Modal>;
}

function PeopleAccess({ roles, catalog }: { roles: AccessRole[]; catalog: PermissionCatalog }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<User | null>(null);
  const people = useFetch<User[]>(query.trim().length >= 2 ? `/api/users?q=${encodeURIComponent(query.trim())}` : null);

  return <Card>
    <CardHeader>
      <CardTitle>People</CardTitle>
      <CardDescription>Grant platform roles to one person, add or remove single permissions, and see where each permission comes from.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="access-person-search">Find a person</FieldLabel>
        <Input id="access-person-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" />
      </Field>
      {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> : people.loading ? <Loading /> :
        people.data && (people.data.length ? <ul className="flex flex-col divide-y divide-border">
          {people.data.slice(0, 20).map((person) => <li key={person.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{person.display_name || person.email}</p>
              <p className="truncate text-xs text-muted-foreground">{[person.email, person.department_name].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="outline" onClick={() => setSelected(person)}><UserCog data-icon="inline-start" />Access</Button>
          </li>)}
        </ul> : <Empty message="Nobody matches" hint="Try another name or email." />)}
    </CardContent>
    {selected && <PersonAccessDialog person={selected} roles={roles} catalog={catalog} onClose={() => setSelected(null)} />}
  </Card>;
}

function PersonAccessDialog({ person, roles, catalog, onClose }: {
  person: User; roles: AccessRole[]; catalog: PermissionCatalog; onClose: () => void;
}) {
  const { notify } = useToast();
  const access = useFetch<UserAccess>(`/api/access/users/${person.id}`);
  const [draft, setDraft] = useState<{ roleIds: Set<string>; overrides: OverrideValue } | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const current = draft ?? (access.data ? { roleIds: new Set(access.data.role_ids), overrides: { allow: access.data.allow, deny: access.data.deny } } : null);
  const actions = catalog.platform.filter((permission) => permission.group !== "Module access");
  const granted = new Set([
    ...roles.filter((role) => current?.roleIds.has(role.id) || access.data?.department_role_ids.includes(role.id)).flatMap((role) => role.permissions),
  ]);

  function toggleRole(id: string, on: boolean) {
    if (!current) return;
    const roleIds = new Set(current.roleIds);
    if (on) roleIds.add(id); else roleIds.delete(id);
    setDraft({ ...current, roleIds });
  }
  async function save() {
    if (!current) return;
    setState({ busy: true, error: "" });
    try {
      await api(`/api/access/users/${person.id}`, { method: "PUT", body: { role_ids: [...current.roleIds], ...current.overrides } });
      notify("Access updated.");
      onClose();
    } catch (cause) { setState({ busy: false, error: errorText(cause) }); }
  }

  const name = person.display_name || person.email || "This person";
  return <Modal title={`${name}'s access`} maxWidth={760} onClose={onClose}
    description="Platform roles and single-permission overrides. Module access stays in the person's module list."
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button onClick={() => void save()} disabled={state.busy || !current}>{state.busy && <Spinner data-icon="inline-start" />}Save access</Button>
    </>}>
    {access.error ? <ErrorState message={access.error} onRetry={access.reload} /> : !access.data || !current ? <Loading /> :
      <div className="flex flex-col gap-5">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        {access.data.is_admin && <Alert><AlertDescription>{name} is an Owner and holds every permission.</AlertDescription></Alert>}
        <FieldSet>
          <FieldLegend variant="label">Platform roles</FieldLegend>
          {access.data.department_name && <FieldDescription>Roles from the {access.data.department_name} department apply as well.</FieldDescription>}
          <div className="grid gap-3 sm:grid-cols-2">
            {roles.map((role) => {
              const id = `person-role-${role.id}`;
              const fromDept = access.data!.department_role_ids.includes(role.id);
              return <Field key={role.id} orientation="horizontal">
                <Checkbox id={id} checked={current.roleIds.has(role.id)} onCheckedChange={(checked) => toggleRole(role.id, checked === true)} />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor={id}>{role.name}{fromDept && <Badge variant="outline">From department</Badge>}</FieldLabel>
                  {role.description && <FieldDescription>{role.description}</FieldDescription>}
                </div>
              </Field>;
            })}
          </div>
        </FieldSet>
        <PermissionOverrides permissions={actions} granted={granted} value={current.overrides}
          onChange={(overrides) => setDraft({ ...current, overrides })} disabled={state.busy} />
        {Object.keys(access.data.sources).length > 0 && <FieldSet>
          <FieldLegend variant="label">Where current permissions come from</FieldLegend>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(access.data.sources).map(([key, from]) => <li key={key}>
              <span className="font-medium">{catalog.platform.find((p) => p.key === key)?.label ?? key}</span>
              <span className="text-muted-foreground">: {from.join("; ")}</span>
            </li>)}
          </ul>
        </FieldSet>}
      </div>}
  </Modal>;
}

function DepartmentRoles({ roles, onChanged }: { roles: AccessRole[]; onChanged: () => void }) {
  const { notify } = useToast();
  const departments = useFetch<Department[]>("/api/departments");
  const [editing, setEditing] = useState<Department | null>(null);

  return <Card>
    <CardHeader>
      <CardTitle>Departments</CardTitle>
      <CardDescription>Every member of a department holds the department's platform roles, still with per-person overrides.</CardDescription>
    </CardHeader>
    <CardContent>
      {departments.error ? <ErrorState message={departments.error} onRetry={departments.reload} /> : !departments.data ? <Loading /> :
        !departments.data.length ? <Empty message="No departments yet" hint="Create departments under Departments & Access." /> :
          <ul className="flex flex-col divide-y divide-border">
            {departments.data.map((dept) => <li key={dept.id} className="flex items-center gap-3 py-2">
              <p className="min-w-0 flex-1 truncate font-medium">{dept.name}</p>
              <Button variant="outline" onClick={() => setEditing(dept)}><Pencil data-icon="inline-start" />Roles</Button>
            </li>)}
          </ul>}
    </CardContent>
    {editing && <DepartmentRolesDialog dept={editing} roles={roles} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); notify("Department roles saved."); onChanged(); }} />}
  </Card>;
}

function DepartmentRolesDialog({ dept, roles, onClose, onSaved }: {
  dept: Department; roles: AccessRole[]; onClose: () => void; onSaved: () => void;
}) {
  const current = useFetch<AccessRole[]>(`/api/access/departments/${dept.id}/roles`);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const selected = chosen ?? new Set((current.data ?? []).map((role) => role.id));

  async function save() {
    setState({ busy: true, error: "" });
    try { await api(`/api/access/departments/${dept.id}/roles`, { method: "PUT", body: { role_ids: [...selected] } }); onSaved(); }
    catch (cause) { setState({ busy: false, error: errorText(cause) }); }
  }

  return <Modal title={`${dept.name} roles`} description="Members of this department hold these platform roles." onClose={onClose} maxWidth={560}
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button onClick={() => void save()} disabled={state.busy || !current.data}>{state.busy && <Spinner data-icon="inline-start" />}Save roles</Button>
    </>}>
    {current.error ? <ErrorState message={current.error} onRetry={current.reload} /> : !current.data ? <Loading /> :
      <div className="flex flex-col gap-3">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        {!roles.length ? <Empty message="No platform roles yet" hint="Create one on the Platform roles tab." /> : roles.map((role) => {
          const id = `dept-role-${role.id}`;
          return <Field key={role.id} orientation="horizontal">
            <Checkbox id={id} checked={selected.has(role.id)}
              onCheckedChange={(checked) => { const next = new Set(selected); if (checked === true) next.add(role.id); else next.delete(role.id); setChosen(next); }} />
            <FieldLabel htmlFor={id}>{role.name}</FieldLabel>
          </Field>;
        })}
      </div>}
  </Modal>;
}
