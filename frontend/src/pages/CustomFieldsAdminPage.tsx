import { useState } from "react";
import { Plus, Sliders, Table2, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { CustomFieldDef, CustomSchema, CustomTableColumn } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Loading, PageHead, useToast } from "../components/ui";

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
        <div className="grid cols-2">
          <FieldsManager schema={schema.data!} onChange={schema.reload} notify={notify} />
          <TablesManager schema={schema.data!} onChange={schema.reload} notify={notify} />
        </div>
      )}
    </div>
  );
}

function FieldsManager({ schema, onChange, notify }: { schema: CustomSchema; onChange: () => void; notify: (m: string, t?: "error") => void }) {
  const [f, setF] = useState({ section: "custom", label: "", key: "", field_type: "text", options: "", sensitive: false });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.label.trim()) return;
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
    }
  }
  async function toggle(d: CustomFieldDef) {
    await api(`/api/custom-fields/defs/${d.id}`, { method: "PATCH", body: { active: !d.active } });
    onChange();
  }
  async function remove(d: CustomFieldDef) {
    if (!confirm(`Delete field "${d.label}" and all its values?`)) return;
    await api(`/api/custom-fields/defs/${d.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <h3 className="mt-0 inline-flex items-center gap-2"><Sliders size={18} className="text-brand-600" /> Fields</h3>
      <div className="divide-y divide-slate-100">
        {schema.fields.map((d) => (
          <div key={d.id} className="flex items-center justify-between py-1.5 text-sm">
            <span className={d.active ? "" : "muted line-through"}>
              <span className="badge mr-1">{d.section}</span>{d.label}
              <span className="muted text-xs"> · {d.field_type}{d.sensitive ? " · 🔒" : ""}</span>
            </span>
            <span className="flex flex-none gap-1">
              <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => toggle(d)}>{d.active ? "Disable" : "Enable"}</button>
              <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => remove(d)}><Trash2 size={12} /></button>
            </span>
          </div>
        ))}
        {schema.fields.length === 0 && <p className="muted text-sm">No custom fields yet.</p>}
      </div>
      <form onSubmit={add} className="mt-3 rounded-lg border border-slate-200 p-2">
        <div className="row">
          <div className="field"><label>Label</label><input value={f.label} onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} /></div>
          <div className="field"><label>Section</label><input value={f.section} onChange={(e) => setF((p) => ({ ...p, section: e.target.value }))} /></div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Type</label>
            <select value={f.field_type} onChange={(e) => setF((p) => ({ ...p, field_type: e.target.value }))}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {f.field_type === "select" && (
          <div className="field"><label>Options (comma-separated)</label><input value={f.options} onChange={(e) => setF((p) => ({ ...p, options: e.target.value }))} /></div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={f.sensitive} onChange={(e) => setF((p) => ({ ...p, sensitive: e.target.checked }))} /> Sensitive (HR / self only)
        </label>
        <button className="btn-primary mt-2 inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}><Plus size={14} /> Add field</button>
      </form>
    </div>
  );
}

function TablesManager({ schema, onChange, notify }: { schema: CustomSchema; onChange: () => void; notify: (m: string, t?: "error") => void }) {
  const [label, setLabel] = useState("");
  const [cols, setCols] = useState("");
  const [sensitive, setSensitive] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !cols.trim()) return;
    const columns: CustomTableColumn[] = cols.split(",").map((c) => {
      const key = c.trim().toLowerCase().replace(/\s+/g, "_");
      return { key, label: c.trim(), type: "text" };
    });
    try {
      await api("/api/custom-fields/tables", { method: "POST", body: { key: label.trim(), label: label.trim(), columns, sensitive } });
      setLabel("");
      setCols("");
      setSensitive(false);
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Delete table "${name}" and all rows?`)) return;
    await api(`/api/custom-fields/tables/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <h3 className="mt-0 inline-flex items-center gap-2"><Table2 size={18} className="text-brand-600" /> Tables</h3>
      <div className="divide-y divide-slate-100">
        {schema.tables.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-1.5 text-sm">
            <span className={t.active ? "" : "muted line-through"}>
              {t.label}<span className="muted text-xs"> · {t.columns.map((c) => c.label).join(", ")}{t.sensitive ? " · 🔒" : ""}</span>
            </span>
            <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => remove(t.id, t.label)}><Trash2 size={12} /></button>
          </div>
        ))}
        {schema.tables.length === 0 && <p className="muted text-sm">No custom tables yet.</p>}
      </div>
      <form onSubmit={add} className="mt-3 rounded-lg border border-slate-200 p-2">
        <div className="field"><label>Table name</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dependents" /></div>
        <div className="field"><label>Columns (comma-separated)</label><input value={cols} onChange={(e) => setCols(e.target.value)} placeholder="Name, Relationship, Date of birth" /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} /> Sensitive
        </label>
        <button className="btn-primary mt-2 inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}><Plus size={14} /> Add table</button>
      </form>
    </div>
  );
}
