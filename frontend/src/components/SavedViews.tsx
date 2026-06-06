import { useState } from "react";
import { Bookmark, Plus, X } from "lucide-react";
import { api } from "../api/client";
import type { SavedView } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useToast } from "./ui";

/** A row of saved filter chips for a list surface, with a "save current" affordance. */
export default function SavedViews({
  surface,
  currentParams,
  onApply,
}: {
  surface: "tickets" | "tasks";
  currentParams: string;
  onApply: (params: string) => void;
}) {
  const { notify } = useToast();
  const views = useFetch<SavedView[]>(`/api/views?surface=${surface}`);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  async function save() {
    if (!name.trim()) return;
    await api("/api/views", {
      method: "POST",
      body: { surface, name: name.trim(), params: currentParams },
    });
    setName("");
    setSaving(false);
    notify("View saved.");
    views.reload();
  }
  async function remove(e: React.MouseEvent, v: SavedView) {
    e.stopPropagation();
    await api(`/api/views/${v.id}`, { method: "DELETE" });
    views.reload();
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="muted inline-flex items-center gap-1 text-xs">
        <Bookmark size={13} /> Views
      </span>
      {(views.data ?? []).map((v) => (
        <span
          key={v.id}
          className="badge group inline-flex cursor-pointer items-center gap-1 hover:bg-brand-50"
          onClick={() => onApply(v.params)}
          title={v.params || "no filters"}
        >
          {v.name}
          <X
            size={11}
            className="opacity-40 transition-opacity hover:text-red-600 hover:opacity-100"
            onClick={(e) => remove(e, v)}
          />
        </span>
      ))}
      {(views.data?.length ?? 0) === 0 && <span className="muted text-xs">none yet</span>}
      {saving ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            className="!w-36 !py-1 text-xs"
            placeholder="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setSaving(false);
            }}
          />
          <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={save}>
            Save
          </button>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setSaving(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          className="btn-sm inline-flex items-center gap-1"
          style={{ flex: "0 0 auto" }}
          onClick={() => setSaving(true)}
        >
          <Plus size={12} /> Save current
        </button>
      )}
    </div>
  );
}
