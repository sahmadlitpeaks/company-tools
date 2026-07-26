import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ClipboardList,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type {
  ChecklistTemplate,
  ChecklistTemplateItem,
  Department,
  ResponseType,
  TrackedAsset,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmModal, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const TEAMS = ["it", "facilities", "hr", "finance", "other"];
const SCHEDULES = ["daily", "weekdays", "weekly", "monthly"];
const RESPONSE_TYPES: { key: ResponseType; label: string }[] = [
  { key: "ok_issue", label: "OK / Issue" },
  { key: "done", label: "Tick when done" },
  { key: "text", label: "Text reading" },
  { key: "number", label: "Number reading" },
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

type DraftItem = Omit<ChecklistTemplateItem, "id" | "template_id">;

function scheduleLabel(t: ChecklistTemplate): string {
  if (t.schedule === "weekly") {
    const days = (t.days_of_week ?? [])
      .map((n) => WEEKDAYS.find((w) => w.n === n)?.label)
      .filter(Boolean)
      .join(", ");
    return `Weekly · ${days || "no day set"}`;
  }
  if (t.schedule === "monthly") return `Monthly · day ${t.day_of_month ?? 1}`;
  return t.schedule === "weekdays" ? "Weekdays" : "Daily";
}

export default function ChecklistTemplatesPage() {
  const { notify } = useToast();
  const templates = useFetch<ChecklistTemplate[]>("/api/checklist-templates");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ChecklistTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    setSeeding(true);
    try {
      const made = await api<ChecklistTemplate[]>("/api/checklist-templates/samples", {
        method: "POST",
      });
      notify(
        made.length
          ? `Added ${made.length} starter checklist(s).`
          : "The starter checklists already exist.",
      );
      templates.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
    setSeeding(false);
  }

  async function remove(t: ChecklistTemplate) {
    await api(`/api/checklist-templates/${t.id}`, { method: "DELETE" });
    notify("Checklist deleted.");
    setDeleting(null);
    templates.reload();
  }

  const list = templates.data ?? [];

  return (
    <div>
      <PageHead
        title="Checklists"
        subtitle="Define the rounds each team performs, how often, and who signs them off."
        action={
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            style={{ flex: "0 0 auto" }}
            onClick={() => setCreating(true)}
          >
            <Plus size={15} /> New checklist
          </button>
        }
      />

      <div className="card">
        {templates.loading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty
            icon={<ClipboardList />}
            message="No checklists yet"
            hint="Start from the sample rounds for IT, Facilities and the lab, then edit them to match your buildings."
            action={
              <button
                className="btn-primary inline-flex items-center gap-1.5"
                onClick={seed}
                disabled={seeding}
              >
                <Sparkles size={15} /> {seeding ? "Adding…" : "Add starter checklists"}
              </button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Team</th>
                <th>Schedule</th>
                <th>Checks</th>
                <th>Assigned to</th>
                <th>Verified by</th>
                <th>Next run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => setEditingId(t.id)}>
                  <td>
                    <div className="font-medium">{t.name}</div>
                    {!t.active && <span className="badge">inactive</span>}
                  </td>
                  <td>{t.team}</td>
                  <td>
                    {scheduleLabel(t)}
                    {t.due_time && <span className="muted text-xs"> · due {t.due_time}</span>}
                  </td>
                  <td>{t.item_count}</td>
                  <td>
                    {t.assignee_name ??
                      (t.assignee_department_name ? (
                        <span title="Rota — anyone in this department can claim the round">
                          {t.assignee_department_name} (rota)
                        </span>
                      ) : (
                        <span className="muted">Unassigned</span>
                      ))}
                  </td>
                  <td>
                    {t.requires_verification ? (
                      t.reviewer_name ?? <span className="muted">Any manager</span>
                    ) : (
                      <span className="muted">Not required</span>
                    )}
                  </td>
                  <td>{t.next_run_date ?? "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-sm btn-danger"
                      style={{ flex: "0 0 auto" }}
                      onClick={() => setDeleting(t)}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editingId) && (
        <TemplateEditor
          id={editingId}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onSaved={() => {
            templates.reload();
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete checklist"
          message={`Delete "${deleting.name}"? Rounds already generated from it are removed too.`}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const existing = useFetch<ChecklistTemplate>(id ? `/api/checklist-templates/${id}` : null);
  const users = useFetch<User[]>("/api/users");
  const departments = useFetch<Department[]>("/api/departments");
  const assets = useFetch<TrackedAsset[]>("/api/asset-tracker");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    team: "it",
    schedule: "daily",
    days_of_week: [] as number[],
    day_of_month: 1,
    due_time: "09:00",
    grace_minutes: 60,
    active: true,
    requires_verification: true,
    assignee_id: "",
    assignee_department_id: "",
    reviewer_id: "",
  });
  const [items, setItems] = useState<DraftItem[]>([]);

  useEffect(() => {
    const t = existing.data;
    if (!t) return;
    setForm({
      name: t.name,
      description: t.description ?? "",
      team: t.team,
      schedule: t.schedule,
      days_of_week: t.days_of_week ?? [],
      day_of_month: t.day_of_month ?? 1,
      due_time: t.due_time ?? "",
      grace_minutes: t.grace_minutes,
      active: t.active,
      requires_verification: t.requires_verification,
      assignee_id: t.assignee_id ?? "",
      assignee_department_id: t.assignee_department_id ?? "",
      reviewer_id: t.reviewer_id ?? "",
    });
    setItems(
      t.items.map(({ id: _id, template_id: _t, ...rest }) => rest as DraftItem),
    );
  }, [existing.data]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  // Existing headings, offered as suggestions so a section isn't retyped 7 times.
  const sections = useMemo(
    () => Array.from(new Set(items.map((i) => i.section).filter(Boolean))) as string[],
    [items],
  );

  function addItem() {
    setItems((list) => [
      ...list,
      {
        section: list[list.length - 1]?.section ?? "",
        title: "",
        sort: list.length,
        response_type: "ok_issue",
        photo_required: false,
        asset_id: null,
        auto_ticket_on_issue: true,
        ticket_priority: "normal",
      },
    ]);
  }
  function patchItem(idx: number, patch: Partial<DraftItem>) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((list) => list.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sort: i })));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!items.length || items.some((i) => !i.title.trim())) {
      notify("Every check needs a title.", "error");
      return;
    }
    setBusy(true);
    const body = {
      ...form,
      description: form.description || null,
      due_time: form.due_time || null,
      assignee_id: form.assignee_id || null,
      assignee_department_id: form.assignee_department_id || null,
      reviewer_id: form.reviewer_id || null,
      days_of_week: form.schedule === "weekly" ? form.days_of_week : null,
      day_of_month: form.schedule === "monthly" ? form.day_of_month : null,
      items: items.map((it, i) => ({ ...it, sort: i, section: it.section || null })),
    };
    try {
      if (id) await api(`/api/checklist-templates/${id}`, { method: "PATCH", body });
      else await api("/api/checklist-templates", { method: "POST", body });
      notify(id ? "Checklist updated." : "Checklist created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  if (id && existing.loading) {
    return (
      <Modal title="Checklist" onClose={onClose} maxWidth={980}>
        <Loading />
      </Modal>
    );
  }

  return (
    <Modal title={id ? "Edit checklist" : "New checklist"} onClose={onClose} maxWidth={980}>
      <form onSubmit={save}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Morning IT Checks"
            />
          </div>
          <div className="field">
            <label>Team</label>
            <select value={form.team} onChange={(e) => set("team", e.target.value)}>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p className="muted text-xs">Sets the category of tickets raised from issues.</p>
          </div>
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div className="row">
          <div className="field">
            <label>Schedule</label>
            <select value={form.schedule} onChange={(e) => set("schedule", e.target.value)}>
              {SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {form.schedule === "weekly" && (
            <div className="field" style={{ flex: 2 }}>
              <label>Days</label>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w.n}
                    type="button"
                    className={`btn-sm ${form.days_of_week.includes(w.n) ? "btn-primary" : ""}`}
                    style={{ flex: "0 0 auto" }}
                    onClick={() =>
                      set(
                        "days_of_week",
                        form.days_of_week.includes(w.n)
                          ? form.days_of_week.filter((d) => d !== w.n)
                          : [...form.days_of_week, w.n].sort(),
                      )
                    }
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.schedule === "monthly" && (
            <div className="field">
              <label>Day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.day_of_month}
                onChange={(e) => set("day_of_month", Number(e.target.value))}
              />
            </div>
          )}
          <div className="field">
            <label>Due by</label>
            <input
              type="time"
              value={form.due_time}
              onChange={(e) => set("due_time", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Grace (minutes)</label>
            <input
              type="number"
              min={0}
              value={form.grace_minutes}
              onChange={(e) => set("grace_minutes", Number(e.target.value))}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Assign to a person</label>
            <select value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
              <option value="">— nobody (use a rota) —</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>…or a department (rota)</label>
            <select
              value={form.assignee_department_id}
              onChange={(e) => set("assignee_department_id", e.target.value)}
            >
              <option value="">— none —</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="muted text-xs">Anyone in the department can claim the round.</p>
          </div>
          <div className="field">
            <label>Verified by</label>
            <select value={form.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
              <option value="">— the assignee's manager —</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: 16 }}>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={form.requires_verification}
              onChange={(e) => set("requires_verification", e.target.checked)}
            />
            Requires manager verification
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            Active (generates rounds)
          </label>
        </div>

        <hr className="my-3" style={{ borderColor: "var(--border)" }} />

        <div className="spread mb-2">
          <h4 className="m-0">Checks ({items.length})</h4>
          <button className="btn-sm" type="button" style={{ flex: "0 0 auto" }} onClick={addItem}>
            <Plus size={13} className="inline" /> Add check
          </button>
        </div>
        {sections.length > 0 && (
          <datalist id="section-suggestions">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}

        {items.length === 0 && (
          <p className="muted text-sm">
            Add one row per checkpoint. Use the section to group them, e.g.
            “HQ Building / Dr T's Office”.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {items.map((it, idx) => (
            <div
              key={idx}
              className="rounded-lg p-2"
              style={{ background: "var(--surface-2)" }}
            >
              <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                <span className="muted flex-none pb-2">
                  <GripVertical size={14} />
                </span>
                <div className="field" style={{ marginBottom: 0, flex: 1.2 }}>
                  <label>Section</label>
                  <input
                    list="section-suggestions"
                    value={it.section ?? ""}
                    placeholder="HQ Building / Dr T's Office"
                    onChange={(e) => patchItem(idx, { section: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: 1.4 }}>
                  <label>Check *</label>
                  <input
                    required
                    value={it.title}
                    placeholder="TV"
                    onChange={(e) => patchItem(idx, { title: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Answer</label>
                  <select
                    value={it.response_type}
                    onChange={(e) =>
                      patchItem(idx, { response_type: e.target.value as ResponseType })
                    }
                  >
                    {RESPONSE_TYPES.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Asset</label>
                  <select
                    value={it.asset_id ?? ""}
                    onChange={(e) => patchItem(idx, { asset_id: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    {(assets.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.asset_tag})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-sm btn-danger flex-none"
                  style={{ flex: "0 0 auto", marginBottom: 2 }}
                  onClick={() => removeItem(idx)}
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="row mt-1.5" style={{ gap: 16, alignItems: "center" }}>
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={it.photo_required}
                    onChange={(e) => patchItem(idx, { photo_required: e.target.checked })}
                  />
                  <Camera size={12} /> Photo required
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={it.auto_ticket_on_issue}
                    onChange={(e) => patchItem(idx, { auto_ticket_on_issue: e.target.checked })}
                  />
                  Raise a ticket on Issue
                </label>
                {it.auto_ticket_on_issue && (
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    Priority
                    <select
                      value={it.ticket_priority}
                      style={{ width: 110 }}
                      onChange={(e) => patchItem(idx, { ticket_priority: e.target.value })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : id ? "Save checklist" : "Create checklist"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
