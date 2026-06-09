import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { api } from "../api/client";
import type { Department, ModuleCatalogue } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function DepartmentsPage() {
  const { notify } = useToast();
  const depts = useFetch<Department[]>("/api/departments");
  const cat = useFetch<ModuleCatalogue>("/api/users/modules");
  const [editing, setEditing] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(d: Department) {
    if (!confirm(`Delete the “${d.name}” department? Members keep their personal grants.`)) return;
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
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={15} /> New department
          </button>
        }
      />

      {depts.loading ? (
        <Loading />
      ) : (depts.data?.length ?? 0) === 0 ? (
        <Empty message="No departments yet." />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
          {depts.data!.map((d) => (
            <div key={d.id} className="card">
              <div className="spread">
                <h3 className="m-0">{d.name}</h3>
                <span className="badge inline-flex items-center gap-1">
                  <Users size={12} /> {d.member_count}
                </span>
              </div>
              {d.description && <p className="muted mt-1 text-sm">{d.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {d.permissions.length === 0 && <span className="muted text-xs">No modules</span>}
                {d.permissions.slice(0, 8).map((p) => (
                  <span key={p} className="badge">{labelFor(p)}</span>
                ))}
                {d.permissions.length > 8 && (
                  <span className="badge">+{d.permissions.length - 8} more</span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-sm inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setEditing(d)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn-sm btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => remove(d)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
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
  const [perms, setPerms] = useState<Set<string>>(new Set(dept?.permissions ?? ["dashboard"]));
  const [busy, setBusy] = useState(false);

  function toggle(key: string) {
    setPerms((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal title={dept ? `Edit ${dept.name}` : "New department"} onClose={onClose} maxWidth={580}>
      <form onSubmit={save}>
        <div className="field">
          <label>Name *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <div className="spread">
            <label className="!mb-0">Modules ({perms.size})</label>
            <button
              type="button"
              className="!border-0 !bg-transparent !p-0 text-xs font-medium text-brand-600"
              onClick={() => setPerms(new Set(modules.map((m) => m.key)))}
            >
              Select all
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {modules.map((m) => (
              <label key={m.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="!w-auto" checked={perms.has(m.key)} onChange={() => toggle(m.key)} />
                {m.label}
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : dept ? "Save changes" : "Create department"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
