import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { api } from "../api/client";
import type { Department, ModuleCatalogue } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function DepartmentsPage() {
  const { notify } = useToast();
  const depts = useFetch<Department[]>("/api/departments");
  const cat = useFetch<ModuleCatalogue>("/api/users/modules");
  const [editing, setEditing] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

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
        subtitle="Group staff and grant a set of modules to everyone in the group."
        action={
          <Button type="button" onClick={() => setAdding(true)}><Plus data-icon="inline-start" /> New department</Button>
        }
      />

      {depts.loading ? (
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
                <CardAction className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(d)}><Pencil data-icon="inline-start" /> Edit</Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget(d)}><Trash2 data-icon="inline-start" /> Delete</Button>
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
