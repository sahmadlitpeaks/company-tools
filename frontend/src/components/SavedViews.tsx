import { useState } from "react";
import { Bookmark, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import type { SavedView } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, useToast } from "./ui";

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
  const [deleting, setDeleting] = useState<SavedView | null>(null);

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
  async function remove(v: SavedView) {
    await api(`/api/views/${v.id}`, { method: "DELETE" });
    views.reload();
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Bookmark /> Views
      </span>
      {(views.data ?? []).map((v) => (
        <span key={v.id} className="inline-flex">
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="cursor-pointer pr-1"
            onClick={() => onApply(v.params)}
            title={v.params || "no filters"}
          >
            {v.name}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleting(v)}
            title={`Delete ${v.name}`}
            aria-label={`Delete saved view ${v.name}`}
          >
            <X />
          </Button>
        </span>
      ))}
      {(views.data?.length ?? 0) === 0 && <span className="text-xs text-muted-foreground">none yet</span>}
      {saving ? (
        <span className="inline-flex items-center gap-1">
          <Input aria-label="View name"
            autoFocus
            className="w-36"
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
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSaving(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button type="button"
          size="sm"
          variant="outline"
          onClick={() => setSaving(true)}
        >
          <Plus data-icon="inline-start" /> Save current
        </Button>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete saved view"
          message={`Delete saved view “${deleting.name}”?`}
          confirmLabel="Delete view"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
