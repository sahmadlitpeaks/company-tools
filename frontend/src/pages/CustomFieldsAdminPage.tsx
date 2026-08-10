import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { LockKeyhole, Plus, Sliders, Table2, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { CustomFieldDef, CustomSchema, CustomTableColumn } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Loading, PageHead, useToast } from "../components/ui";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "bool"];

export default function CustomFieldsAdminPage() {
  const { notify } = useToast();
  const schema = useFetch<CustomSchema>("/api/custom-fields/schema?include_inactive=true");

  return (
    <div>
      <PageHead title="Custom Fields" subtitle="Extend the employee record without code — fields and repeatable tables." />
      {schema.loading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FieldsManager schema={schema.data!} onChange={schema.reload} notify={notify} />
          <TablesManager schema={schema.data!} onChange={schema.reload} notify={notify} />
        </div>
      )}
    </div>
  );
}

function FieldsManager({ schema, onChange, notify }: { schema: CustomSchema; onChange: () => void; notify: (m: string, t?: "error") => void }) {
  const [f, setF] = useState({ section: "custom", label: "", key: "", field_type: "text", options: "", sensitive: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldDef | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.label.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/custom-fields/defs", {
        method: "POST",
        body: {
          section: f.section.trim() || "custom",
          label: f.label.trim(),
          key: f.key.trim() || f.label.trim(),
          field_type: f.field_type,
          options: f.field_type === "select" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : null,
          sensitive: f.sensitive,
        },
      });
      setF({ section: "custom", label: "", key: "", field_type: "text", options: "", sensitive: false });
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function toggle(d: CustomFieldDef) {
    await api(`/api/custom-fields/defs/${d.id}`, { method: "PATCH", body: { active: !d.active } });
    onChange();
  }
  async function remove(d: CustomFieldDef) {
    await api(`/api/custom-fields/defs/${d.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <CardHeader><CardTitle className="inline-flex items-center gap-2"><Sliders className="text-primary" /> Fields</CardTitle></CardHeader>
      <CardContent>
      <div className="divide-y divide-border">
        {schema.fields.map((d) => (
          <div key={d.id} className="flex flex-col items-start justify-between gap-2 py-2 text-sm sm:flex-row sm:items-center">
            <span className={d.active ? "min-w-0" : "min-w-0 text-muted-foreground line-through"}>
              <Badge variant="secondary" className="mr-1">{d.section}</Badge>{d.label}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"> · {d.field_type}{d.sensitive && <><span> · </span><LockKeyhole aria-label="Sensitive" /></>}</span>
            </span>
            <span className="flex flex-none gap-1">
              <Button aria-label="Toggle" type="button" variant="outline" size="sm" onClick={() => toggle(d)}>{d.active ? "Disable" : "Enable"}</Button>
              <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(d)}><Trash2 /></Button>
            </span>
          </div>
        ))}
        {schema.fields.length === 0 && <p className="text-sm text-muted-foreground">No custom fields yet.</p>}
      </div>
      <form onSubmit={add} className="mt-4 flex flex-col gap-4 border p-3 sm:p-4">
        <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field><FieldLabel htmlFor="rd-customfieldsadminpage-83-label">Label</FieldLabel><Input id="rd-customfieldsadminpage-83-label" value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} /></Field>
          <Field><FieldLabel htmlFor="rd-customfieldsadminpage-84-section">Section</FieldLabel><Input id="rd-customfieldsadminpage-84-section" value={f.section} onChange={(e) => setF((p) => ({ ...p, section: e.target.value }))} /></Field>
          <Field>
            <FieldLabel htmlFor="rd-customfieldsadminpage-86-type">Type</FieldLabel>
            <Select items={FIELD_TYPES.map((t) => ({ value: t, label: t }))} value={f.field_type} onValueChange={(value) => setF((p) => ({ ...p, field_type: value ?? "" }))}>
              <SelectTrigger className="w-full" id="rd-customfieldsadminpage-86-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        {f.field_type === "select" && (
          <Field><FieldLabel htmlFor="rd-customfieldsadminpage-93-options-comma-separated">Options (comma-separated)</FieldLabel><Input id="rd-customfieldsadminpage-93-options-comma-separated" value={f.options} onChange={(e) => setF((p) => ({ ...p, options: e.target.value }))} /></Field>
        )}
        <FieldLabel className="flex items-center gap-2"><Checkbox checked={f.sensitive} onCheckedChange={(checked) => setF((p) => ({ ...p, sensitive: checked }))} /> Sensitive (HR / self only)</FieldLabel>
        </FieldGroup>
        <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={isSubmitting}><Plus data-icon="inline-start" /> {isSubmitting ? "Adding…" : "Add field"}</Button>
      </form>
      </CardContent>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete custom field "${deleteTarget.label}"?`}
          message={`Delete "${deleteTarget.label}" and all of its values?`}
          confirmLabel="Delete field"
          danger
          onConfirm={() => remove(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Card>
  );
}

function TablesManager({ schema, onChange, notify }: { schema: CustomSchema; onChange: () => void; notify: (m: string, t?: "error") => void }) {
  const [label, setLabel] = useState("");
  const [cols, setCols] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !cols.trim()) return;
    const columns: CustomTableColumn[] = cols.split(",").map((c) => {
      const key = c.trim().toLowerCase().replace(/\s+/g, "_");
      return { key, label: c.trim(), type: "text" };
    });
    setIsSubmitting(true);
    try {
      await api("/api/custom-fields/tables", { method: "POST", body: { key: label.trim(), label: label.trim(), columns, sensitive } });
      setLabel("");
      setCols("");
      setSensitive(false);
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function remove(target: { id: string; label: string }) {
    await api(`/api/custom-fields/tables/${target.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <CardHeader><CardTitle className="inline-flex items-center gap-2"><Table2 className="text-primary" /> Tables</CardTitle></CardHeader>
      <CardContent>
      <div className="divide-y divide-border">
        {schema.tables.map((t) => (
          <div key={t.id} className="flex flex-col items-start justify-between gap-2 py-2 text-sm sm:flex-row sm:items-center">
            <span className={t.active ? "min-w-0" : "min-w-0 text-muted-foreground line-through"}>
              {t.label}<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"> · {t.columns.map((c) => c.label).join(", ")}{t.sensitive && <><span> · </span><LockKeyhole aria-label="Sensitive" /></>}</span>
            </span>
            <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget({ id: t.id, label: t.label })}><Trash2 /></Button>
          </div>
        ))}
        {schema.tables.length === 0 && <p className="text-sm text-muted-foreground">No custom tables yet.</p>}
      </div>
      <form onSubmit={add} className="mt-4 flex flex-col gap-4 border p-3 sm:p-4">
        <FieldGroup>
        <Field><FieldLabel htmlFor="rd-customfieldsadminpage-147-table-name">Table name</FieldLabel><Input id="rd-customfieldsadminpage-147-table-name" aria-label="Dependents" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dependents" /></Field>
        <Field><FieldLabel htmlFor="rd-customfieldsadminpage-148-columns-comma-separated">Columns (comma-separated)</FieldLabel><Input id="rd-customfieldsadminpage-148-columns-comma-separated" aria-label="Name, Relationship, Date of birth" value={cols} onChange={(e) => setCols(e.target.value)} placeholder="Name, Relationship, Date of birth" /></Field>
        <FieldLabel className="flex items-center gap-2"><Checkbox checked={sensitive} onCheckedChange={(checked) => setSensitive(checked)} /> Sensitive</FieldLabel>
        </FieldGroup>
        <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={isSubmitting}><Plus data-icon="inline-start" /> {isSubmitting ? "Adding…" : "Add table"}</Button>
      </form>
      </CardContent>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete custom table "${deleteTarget.label}"?`}
          message={`Delete "${deleteTarget.label}" and all of its rows?`}
          confirmLabel="Delete table"
          danger
          onConfirm={() => remove(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Card>
  );
}
