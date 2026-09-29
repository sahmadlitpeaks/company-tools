import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Department, DepartmentMember, ModuleCatalogue, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ConfirmDialog, Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function DepartmentsPage() {
  const { notify } = useToast();
  const depts = useFetch<Department[]>("/api/departments");
  const cat = useFetch<ModuleCatalogue>("/api/users/modules");
  const [editing, setEditing] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [managing, setManaging] = useState<Department | null>(null);

  async function remove(d: Department) {
    await api(`/api/departments/${d.id}`, { method: "DELETE" });
    notify("Department deleted.");
    depts.reload();
  }

  const labelFor = (key: string) =>
    cat.data?.modules.find((m) => m.key === key)?.label ?? key;

  return (
    <div>
      <PageHead
        title="Departments"
        subtitle="Assign existing people to access groups and manage the modules each group grants."
        action={
          <Button type="button" onClick={() => setAdding(true)}><Plus data-icon="inline-start" /> New department</Button>
        }
      />

      {depts.error ? (
        <ErrorState message={depts.error} onRetry={depts.reload} />
      ) : depts.loading ? (
        <Loading />
      ) : (depts.data?.length ?? 0) === 0 ? (
        <Empty message="No departments yet." />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {depts.data!.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <CardTitle>{d.name}</CardTitle>
                <Badge><Users data-icon="inline-start" /> {d.member_count}</Badge>
                <CardAction className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setManaging(d)}><UserRoundPlus data-icon="inline-start" /> Manage people</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(d)}><Pencil data-icon="inline-start" /> Edit</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(d)}><Trash2 data-icon="inline-start" /> Delete</Button>
                </CardAction>
              </CardHeader>
              <CardContent>
              {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {d.permissions.length === 0 && <span className="text-xs text-muted-foreground">No modules</span>}
                {d.permissions.slice(0, 8).map((p) => (
                  <Badge key={p} variant="secondary">{labelFor(p)}</Badge>
                ))}
                {d.permissions.length > 8 && (
                  <Badge variant="secondary">+{d.permissions.length - 8} more</Badge>
                )}
              </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <DepartmentModal
          dept={editing}
          modules={cat.data?.modules ?? []}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            depts.reload();
          }}
        />
      )}
      {managing && <MembersModal dept={managing} onClose={() => setManaging(null)} onChanged={depts.reload} />}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete department "${deleteTarget.name}"?`}
          message={`Delete the "${deleteTarget.name}" department? Members will keep their personal grants.`}
          confirmLabel="Delete department"
          danger
          onConfirm={() => remove(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function MembersModal({ dept, onClose, onChanged }: {
  dept: Department;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const members = useFetch<DepartmentMember[]>(`/api/departments/${dept.id}/members`);
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const people = useFetch<User[]>(`/api/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const [selectedId, setSelectedId] = useState("");
  const [confirmation, setConfirmation] = useState<
    { action: "add"; person: User } | { action: "remove"; person: DepartmentMember } | null
  >(null);
  const candidates = (people.data ?? []).filter((person) => person.department_id !== dept.id);
  const selected = candidates.find((person) => person.id === selectedId);

  async function applyChange() {
    if (!confirmation) return;
    if (confirmation.action === "add") {
      await api(`/api/departments/${dept.id}/members`, {
        method: "POST", body: { user_id: confirmation.person.id },
      });
      notify(`${confirmation.person.display_name || confirmation.person.email || "Person"} added to ${dept.name}.`);
      setSelectedId("");
      setSearch("");
    } else {
      await api(`/api/departments/${dept.id}/members/${confirmation.person.id}`, { method: "DELETE" });
      notify(`${confirmation.person.display_name || confirmation.person.email || "Person"} removed from ${dept.name}.`);
    }
    await Promise.all([members.reload(), people.reload()]);
    onChanged();
  }

  return <>
    <Modal title={`${dept.name} people`} description="Manage this access group. A person can belong to one access department at a time." onClose={onClose} maxWidth={640}
      footer={<><Button variant="outline" nativeButton={false} render={<Link to="/directory" />}>Create person in Directory</Button><Button onClick={onClose}>Done</Button></>}>
      <Alert><AlertTriangle aria-hidden="true" /><AlertDescription>Changing an access department can change a person's module access. Platform admins keep full access. Their job department from Entra is separate, and existing compliance tasks keep their owner.</AlertDescription></Alert>
      {!dept.permissions.includes("sharepoint_intelligence") && <Alert variant="destructive"><AlertDescription>This group does not grant SharePoint Intelligence. Enable it under Edit if members should open Compliance. They also need their own SharePoint access.</AlertDescription></Alert>}
      <section className="space-y-3" aria-label="Current members">
        <div><h3 className="text-sm font-semibold">Current members · {members.data?.length ?? dept.member_count}</h3><p className="text-sm text-muted-foreground">Compliance ownership needs active members with work emails. Set a responsible person's role to Manager in Directory to receive and assign new department tasks.</p></div>
        {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : members.loading ? <Loading /> : !members.data?.length ? <Empty message="No people in this access group yet." /> :
          <div className="divide-y divide-border border border-border">{members.data.map((person) => <div key={person.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-medium">{person.display_name || person.email || "Unnamed person"}{person.role === "manager" && <Badge variant="secondary" className="ms-2">Manager</Badge>}</p><p className="break-all text-xs text-muted-foreground">{person.email || "No work email"} · {person.is_active && person.status === "active" ? "Active" : "Inactive"}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setConfirmation({ action: "remove", person })}><UserRoundMinus data-icon="inline-start" /> Remove</Button></div>)}</div>}
      </section>
      <section className="space-y-3 border-t border-border pt-4" aria-label="Add existing person">
        <div><h3 className="text-sm font-semibold">Add an existing person</h3><p className="text-sm text-muted-foreground">To create a new account, use Employee Directory.</p></div>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="department-person-search">Find person</FieldLabel><Input id="department-person-search" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(""); }} placeholder="Search name or email" /></Field>
          <Field><FieldLabel htmlFor="department-person-select">Person</FieldLabel><Select items={[{ value: null, label: "Choose person" }, ...candidates.map((person) => ({ value: person.id, label: person.display_name || person.email || "Unnamed person" }))]} value={selectedId || null} onValueChange={(value) => setSelectedId(value ?? "")} disabled={people.loading || !candidates.length}><SelectTrigger id="department-person-select" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Choose person</SelectItem>{candidates.map((person) => <SelectItem key={person.id} value={person.id}>{person.display_name || person.email || "Unnamed person"}{person.department_name ? ` · ${person.department_name}` : ""}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{people.loading ? "Loading people…" : people.error ? people.error : candidates.length ? "The current access group is shown after each name." : "No eligible people found. Search another name or create a person in Directory."}</FieldDescription></Field>
        </FieldGroup>
        {selected && <p className="text-sm text-muted-foreground">{selected.department_name ? `Moving from ${selected.department_name}.` : "Currently has no access department."} {selected.status !== "active" || !selected.is_active || !selected.email ? "This person cannot receive compliance reminders until active with a work email." : selected.is_admin ? "Admins keep full platform access; membership affects ownership and reminders." : "Personal permission overrides remain in place."}</p>}
        <Button type="button" disabled={!selected} onClick={() => { if (selected) setConfirmation({ action: "add", person: selected }); }}><UserRoundPlus data-icon="inline-start" /> Add to {dept.name}</Button>
      </section>
    </Modal>
    {confirmation && <ConfirmDialog title={confirmation.action === "add" ? `Add to ${dept.name}?` : `Remove from ${dept.name}?`} message={confirmation.action === "add" ? `${confirmation.person.display_name || confirmation.person.email || "This person"} will ${confirmation.person.department_name ? `move from ${confirmation.person.department_name}` : "join this access department"}. Module access may change; existing individual grants remain. SharePoint file access is managed separately.` : `${confirmation.person.display_name || confirmation.person.email || "This person"} will lose this department's base module access. Their personal grants remain, and existing tasks keep their owner.`} confirmLabel={confirmation.action === "add" ? "Add person" : "Remove person"} onConfirm={applyChange} onClose={() => setConfirmation(null)} />}
  </>;
}

function DepartmentModal({
  dept,
  modules,
  onClose,
  onSaved,
}: {
  dept: Department | null;
  modules: { key: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState(dept?.name ?? "");
  const [description, setDescription] = useState(dept?.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(
    () => new Set(dept?.permissions ?? ["dashboard"]),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(key: string) {
    setPerms((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body = { name: name.trim(), description: description || null, permissions: [...perms] };
      if (dept) {
        await api(`/api/departments/${dept.id}`, { method: "PATCH", body });
      } else {
        await api("/api/departments", { method: "POST", body });
      }
      notify(dept ? "Department updated." : "Department created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={dept ? `Edit ${dept.name}` : "New department"} onClose={onClose} maxWidth={580}>
      <form onSubmit={save} className="flex flex-col gap-5">
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rd-departmentspage-140-name">Name *</FieldLabel>
          <Input id="rd-departmentspage-140-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-departmentspage-144-description">Description</FieldLabel>
          <Input id="rd-departmentspage-144-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <FieldSet>
          <div className="flex items-center justify-between gap-3">
            <FieldLegend variant="label">Modules ({perms.size})</FieldLegend>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setPerms(new Set(modules.map((m) => m.key)))}
            >
              Select all
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {modules.map((m) => (
              <FieldLabel key={m.key} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={perms.has(m.key)} onCheckedChange={() => toggle(m.key)} />
                {m.label}
              </FieldLabel>
            ))}
          </div>
        </FieldSet>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : dept ? "Save changes" : "Create department"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
