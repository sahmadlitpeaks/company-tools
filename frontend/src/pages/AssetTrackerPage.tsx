import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import type {
  AssetAttachment,
  AssetEvent,
  AssetReports,
  AssetSummary,
  AssignmentSpan,
  NamedItem,
  TrackedAsset,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmDialog,
  Empty,
  ErrorState,
  Loading,
  MetricCard,
  Modal,
  PageHead,
  PromptModal,
  bytes,
  useToast,
} from "../components/ui";

const STATUSES = ["available", "assigned", "maintenance", "retired"];
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const CONDITION_BADGE: Record<string, BadgeVariant> = {
  new: "success",
  good: "success",
  fair: "warning",
  poor: "warning",
  damaged: "destructive",
};

function ConditionBadge({ condition }: { condition?: string | null }) {
  if (!condition) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={CONDITION_BADGE[condition] ?? "secondary"}>{condition}</Badge>;
}

function isMaintenanceDue(a: TrackedAsset): boolean {
  if (!a.next_maintenance_date || a.status === "retired") return false;
  const due = new Date(a.next_maintenance_date);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  return due <= soon;
}

function money(v?: string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

function StatusBadge({ status }: { status: string }) {
  const variant: BadgeVariant =
    status === "available"
      ? "success"
      : status === "assigned"
        ? "info"
        : status === "maintenance"
          ? "warning"
          : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

const EMPTY_FORM = {
  asset_tag: "",
  name: "",
  category: "",
  location: "",
  condition: "",
  serial_number: "",
  vendor: "",
  purchase_date: "",
  purchase_cost: "",
  warranty_expiry: "",
  useful_life_years: "",
  maintenance_interval_days: "",
  notes: "",
};

function AssetFormModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: TrackedAsset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const categories = useFetch<NamedItem[]>("/api/asset-tracker/categories");
  const locations = useFetch<NamedItem[]>("/api/asset-tracker/locations");
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...(asset
      ? {
          asset_tag: asset.asset_tag,
          name: asset.name,
          category: asset.category ?? "",
          location: asset.location ?? "",
          condition: asset.condition ?? "",
          serial_number: asset.serial_number ?? "",
          vendor: asset.vendor ?? "",
          purchase_date: asset.purchase_date ?? "",
          purchase_cost: asset.purchase_cost ?? "",
          warranty_expiry: asset.warranty_expiry ?? "",
          useful_life_years: asset.useful_life_years?.toString() ?? "",
          maintenance_interval_days:
            asset.maintenance_interval_days?.toString() ?? "",
          notes: asset.notes ?? "",
        }
      : {}),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    const body = {
      asset_tag: form.asset_tag,
      name: form.name,
      category: form.category || null,
      location: form.location || null,
      condition: form.condition || null,
      serial_number: form.serial_number || null,
      vendor: form.vendor || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost || null,
      warranty_expiry: form.warranty_expiry || null,
      useful_life_years: form.useful_life_years
        ? Number(form.useful_life_years)
        : null,
      maintenance_interval_days: form.maintenance_interval_days
        ? Number(form.maintenance_interval_days)
        : null,
      notes: form.notes || null,
    };
    try {
      if (asset) {
        await api(`/api/asset-tracker/${asset.id}`, { method: "PATCH", body });
        notify("Asset updated.");
      } else {
        await api("/api/asset-tracker", { method: "POST", body });
        notify("Asset added.");
      }
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={asset ? "Edit asset" : "Add asset"} onClose={onClose}>
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-167-asset-tag">Asset tag *</FieldLabel>
            <Input id="rd-assettrackerpage-167-asset-tag" aria-label="LAP-001"
              required
              placeholder="LAP-001"
              value={form.asset_tag}
              onChange={(e) => set("asset_tag", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-176-name">Name *</FieldLabel>
            <Input id="rd-assettrackerpage-176-name" aria-label="ThinkPad X1"
              required
              placeholder="ThinkPad X1"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-187-category">Category</FieldLabel>
            <Input id="rd-assettrackerpage-187-category" aria-label="Laptop"
              list="asset-categories"
              placeholder="Laptop"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            />
            <datalist id="asset-categories">
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-201-location">Location</FieldLabel>
            <Input id="rd-assettrackerpage-201-location" aria-label="HQ — 3rd floor"
              list="asset-locations"
              placeholder="HQ — 3rd floor"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
            />
            <datalist id="asset-locations">
              {(locations.data ?? []).map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-217-condition">Condition</FieldLabel>
            <Select
              items={[{ value: null, label: "—" }, ...CONDITIONS.map((c) => ({ value: c, label: c }))]}
              value={form.condition || null}
              onValueChange={(value) => set("condition", value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-assettrackerpage-217-condition"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>—</SelectItem>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-228-maintenance-every-days">Maintenance every (days)</FieldLabel>
            <Input id="rd-assettrackerpage-228-maintenance-every-days" aria-label="e.g. 90"
              type="number"
              placeholder="e.g. 90"
              value={form.maintenance_interval_days}
              onChange={(e) => set("maintenance_interval_days", e.target.value)}
            />
          </Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-239-serial-number">Serial number</FieldLabel>
            <Input id="rd-assettrackerpage-239-serial-number"
              value={form.serial_number}
              onChange={(e) => set("serial_number", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-246-vendor">Vendor</FieldLabel>
            <Input id="rd-assettrackerpage-246-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
          </Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-252-purchase-date">Purchase date</FieldLabel>
            <Input id="rd-assettrackerpage-252-purchase-date"
              type="date"
              value={form.purchase_date}
              onChange={(e) => set("purchase_date", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-260-purchase-cost">Purchase cost</FieldLabel>
            <Input id="rd-assettrackerpage-260-purchase-cost" aria-label="1500.00"
              type="number"
              step="0.01"
              placeholder="1500.00"
              value={form.purchase_cost}
              onChange={(e) => set("purchase_cost", e.target.value)}
            />
          </Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-272-warranty-expiry">Warranty expiry</FieldLabel>
            <Input id="rd-assettrackerpage-272-warranty-expiry"
              type="date"
              value={form.warranty_expiry}
              onChange={(e) => set("warranty_expiry", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-280-useful-life-years">Useful life (years)</FieldLabel>
            <Input id="rd-assettrackerpage-280-useful-life-years" aria-label="3"
              type="number"
              placeholder="3"
              value={form.useful_life_years}
              onChange={(e) => set("useful_life_years", e.target.value)}
            />
          </Field>
        </FieldGroup>
        <Field>
          <FieldLabel htmlFor="rd-assettrackerpage-290-notes">Notes</FieldLabel>
          <Textarea id="rd-assettrackerpage-290-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
        </FieldGroup>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : asset ? "Save changes" : "Add asset"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value || "—"}</span>
    </div>
  );
}

function AssetDetailModal({
  asset,
  users,
  onClose,
  onChanged,
}: {
  asset: TrackedAsset;
  users: User[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [current, setCurrent] = useState<TrackedAsset>(asset);
  const events = useFetch<AssetEvent[]>(`/api/asset-tracker/${asset.id}/events`);
  const assignments = useFetch<AssignmentSpan[]>(
    `/api/asset-tracker/${asset.id}/assignments`,
  );
  const attachments = useFetch<AssetAttachment[]>(
    `/api/asset-tracker/${asset.id}/attachments`,
  );
  const [assignee, setAssignee] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [maintNote, setMaintNote] = useState("");
  const [maintCost, setMaintCost] = useState("");
  const [maintNextDays, setMaintNextDays] = useState("");
  const [salvage, setSalvage] = useState("");
  const [disposalNotes, setDisposalNotes] = useState("");
  const [attKind, setAttKind] = useState("document");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attRef = useRef<HTMLInputElement>(null);

  async function act(path: string, body: unknown, msg: string) {
    setIsSubmitting(true);
    try {
      const updated = await api<TrackedAsset>(`/api/asset-tracker/${asset.id}/${path}`, {
        method: "POST",
        body,
      });
      setCurrent(updated);
      notify(msg);
      events.reload();
      assignments.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", attKind);
    try {
      await api(`/api/asset-tracker/${asset.id}/attachments`, {
        method: "POST",
        form: fd,
      });
      notify("Attachment added.");
      attachments.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (attRef.current) attRef.current.value = "";
  }

  async function removeAttachment(id: string) {
    await api(`/api/asset-tracker/attachments/${id}`, { method: "DELETE" });
    attachments.reload();
    onChanged();
  }

  return (
    <Modal title={`${current.name} · ${current.asset_tag}`} onClose={onClose}>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={current.status} />
          {current.assigned_to_name && (
            <span className="text-muted-foreground">
              Assigned to {current.assigned_to_name}
              {current.assigned_to_title && ` · ${current.assigned_to_title}`}
            </span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm"
          onClick={() =>
            downloadFile(
              `/api/asset-tracker/${current.id}/label.png`,
              `${current.asset_tag}-label.png`,
            ).catch(() => notify("Label download failed", "error"))
          }
        >
          Download label
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent>
        <DetailRow label="Category" value={current.category} />
        <DetailRow label="Location" value={current.location} />
        <DetailRow
          label="Condition"
          value={<ConditionBadge condition={current.condition} />}
        />
        <DetailRow label="Serial" value={current.serial_number} />
        <DetailRow label="Vendor" value={current.vendor} />
        <DetailRow label="Purchased" value={current.purchase_date} />
        <DetailRow label="Purchase cost" value={money(current.purchase_cost)} />
        <DetailRow label="Warranty until" value={current.warranty_expiry} />
        <DetailRow
          label="Next maintenance"
          value={
            current.next_maintenance_date ? (
              <span className={isMaintenanceDue(current) ? "text-warning" : undefined}>
                {current.next_maintenance_date}
              </span>
            ) : (
              "—"
            )
          }
        />
        <DetailRow
          label="Book value (today)"
          value={
            current.current_book_value != null
              ? money(current.current_book_value)
              : "—"
          }
        />
        {current.status === "retired" && (
          <>
            <DetailRow label="Disposed" value={current.disposal_date} />
            <DetailRow label="Salvage value" value={money(current.salvage_value)} />
            <DetailRow label="Disposal notes" value={current.disposal_notes} />
          </>
        )}
        </CardContent>
      </Card>

      {/* ---- Condition ---- */}
      <h4 className="mb-2 font-semibold">Condition</h4>
      <div className="flex flex-wrap gap-1.5">
        {CONDITIONS.map((c) => (
          <Button type="button"
            key={c}
            variant={current.condition === c ? "default" : "outline"}
            size="sm"
            disabled={isSubmitting}
            onClick={() => act("condition", { condition: c }, `Condition set to ${c}.`)}
          >
            {c}
          </Button>
        ))}
      </div>

      {/* ---- Assign / check-in ---- */}
      <h4 className="mt-5 mb-2 font-semibold">Assignment</h4>
      {current.status === "assigned" ? (
        <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-483-return-note-optional">Return note (optional)</FieldLabel>
            <Input id="rd-assettrackerpage-483-return-note-optional" value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          </Field>
          <Button type="button" variant="outline"
            disabled={isSubmitting}
            onClick={() => act("checkin", { note: actionNote || null }, "Checked in.")}
          >
            Check in
          </Button>
        </FieldGroup>
      ) : (
        <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-498-assign-to">Assign to</FieldLabel>
            <Select
              items={[
                { value: null, label: "Select employee…" },
                ...users.map((u) => ({ value: u.id, label: u.display_name ?? u.email })),
              ]}
              value={assignee || null}
              onValueChange={(value) => setAssignee(value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-assettrackerpage-498-assign-to"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>Select employee…</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button type="button"
            disabled={isSubmitting || !assignee || current.status === "retired"}
            onClick={() =>
              act("checkout", { user_id: assignee, note: actionNote || null }, "Checked out.")
            }
          >
            Check out
          </Button>
        </FieldGroup>
      )}

      {/* ---- Maintenance ---- */}
      <h4 className="mt-5 mb-2 font-semibold">Log maintenance</h4>
      <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(6rem,1fr)_minmax(7rem,1fr)_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="rd-assettrackerpage-525-what-was-done">What was done</FieldLabel>
          <Input id="rd-assettrackerpage-525-what-was-done" aria-label="Battery replacement"
            placeholder="Battery replacement"
            value={maintNote}
            onChange={(e) => setMaintNote(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-assettrackerpage-533-cost">Cost</FieldLabel>
          <Input id="rd-assettrackerpage-533-cost"
            type="number"
            step="0.01"
            value={maintCost}
            onChange={(e) => setMaintCost(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-assettrackerpage-542-next-in-days">Next in (days)</FieldLabel>
          <Input id="rd-assettrackerpage-542-next-in-days" aria-label="90"
            type="number"
            placeholder="90"
            value={maintNextDays}
            onChange={(e) => setMaintNextDays(e.target.value)}
          />
        </Field>
        <Button type="button" variant="outline"
          disabled={isSubmitting || !maintNote}
          onClick={() =>
            act(
              "maintenance",
              {
                note: maintNote,
                cost: maintCost || null,
                set_in_maintenance: false,
                schedule_next_days: maintNextDays ? Number(maintNextDays) : null,
              },
              "Maintenance logged.",
            ).then(() => {
              setMaintNote("");
              setMaintCost("");
              setMaintNextDays("");
            }).catch(() => {})
          }
        >
          Log
        </Button>
      </FieldGroup>

      {/* ---- Retire / dispose ---- */}
      {current.status !== "retired" && (
        <>
          <h4 className="mt-5 mb-2 font-semibold">Retire / dispose</h4>
          <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor="rd-assettrackerpage-581-salvage-value">Salvage value</FieldLabel>
              <Input id="rd-assettrackerpage-581-salvage-value"
                type="number"
                step="0.01"
                value={salvage}
                onChange={(e) => setSalvage(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-assettrackerpage-590-disposal-notes">Disposal notes</FieldLabel>
              <Input id="rd-assettrackerpage-590-disposal-notes" aria-label="Sold / recycled / written off"
                placeholder="Sold / recycled / written off"
                value={disposalNotes}
                onChange={(e) => setDisposalNotes(e.target.value)}
              />
            </Field>
            <Button type="button" variant="destructive"
              disabled={isSubmitting}
              onClick={() =>
                act(
                  "retire",
                  {
                    salvage_value: salvage || null,
                    disposal_notes: disposalNotes || null,
                  },
                  "Asset retired.",
                )
              }
            >
              Retire
            </Button>
          </FieldGroup>
        </>
      )}

      {/* ---- Attachments ---- */}
      <div className="mt-5 mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="font-semibold">Attachments</h4>
        <div className="flex flex-wrap gap-1.5">
          <Select
            items={[
              { value: "document", label: "Document" },
              { value: "photo", label: "Photo" },
              { value: "receipt", label: "Receipt" },
              { value: "warranty", label: "Warranty" },
            ]}
            value={attKind}
            onValueChange={(value) => setAttKind(value ?? "")}
          >
            <SelectTrigger aria-label="Attachment kind" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="photo">Photo</SelectItem>
                <SelectItem value="receipt">Receipt</SelectItem>
                <SelectItem value="warranty">Warranty</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm"
            onClick={() => attRef.current?.click()}
          >
            + Upload
          </Button>
          <Input aria-label="Upload attachment" ref={attRef} type="file" hidden onChange={uploadAttachment} />
        </div>
      </div>
      {!attachments.data || attachments.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {attachments.data.map((att) => (
            <div
              key={att.id}
              className="flex flex-col gap-2 border-b py-1.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="secondary">{att.kind}</Badge>
                <span className="font-medium">{att.name}</span>
                <span className="text-xs text-muted-foreground">{bytes(att.size_bytes)}</span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <Button type="button" variant="outline" size="sm"
                  onClick={() =>
                    downloadFile(
                      `/api/asset-tracker/attachments/${att.id}/download`,
                      att.name,
                    )
                  }
                >
                  Download
                </Button>
                <Button type="button" variant="destructive" size="icon-sm" aria-label={`Remove ${att.name}`}
                  onClick={() => removeAttachment(att.id)}
                >
                  <X />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Assignment timeline ---- */}
      {assignments.data && assignments.data.length > 0 && (
        <>
          <h4 className="mt-5 mb-2 font-semibold">Assignment history</h4>
          <div className="max-h-40 overflow-auto">
            {assignments.data.map((s) => (
              <div
                key={`${s.user_name}-${s.checked_out_at}`}
                className="flex flex-col gap-1 border-b py-1.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium">{s.user_name ?? "Unknown"}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(s.checked_out_at).toLocaleDateString()} →{" "}
                  {s.checked_in_at
                    ? new Date(s.checked_in_at).toLocaleDateString()
                    : "current"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- History ---- */}
      <h4 className="mt-5 mb-2 font-semibold">History</h4>
      {events.loading ? (
        <Loading />
      ) : !events.data || events.data.length === 0 ? (
        <Empty message="No events yet." />
      ) : (
        <div className="max-h-52 overflow-auto">
          {events.data.map((ev) => (
            <div
              key={ev.id}
              className="border-b py-2"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <span className="font-semibold capitalize">
                  {ev.event_type}
                  {ev.user_name ? ` → ${ev.user_name}` : ""}
                  {ev.cost ? ` · ${money(ev.cost)}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.created_at).toLocaleString()}
                </span>
              </div>
              {ev.note && <div className="text-xs text-muted-foreground">{ev.note}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ReportsModal({ onClose }: { onClose: () => void }) {
  const { data, loading } = useFetch<AssetReports>("/api/asset-tracker/reports");
  return (
    <Modal title="Asset reports" maxWidth={760} onClose={onClose}>
      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat value={data.totals.count} label="Assets" />
            <Stat value={money(data.totals.purchase_cost)} label="Purchase cost" />
            <Stat value={money(data.totals.book_value)} label="Book value" />
          </div>
          <h4>By category</h4>
          <Table className="mb-5">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Purchase cost</TableHead>
                <TableHead className="text-right">Book value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.by_category.map((r) => (
                <TableRow key={r.category}>
                  <TableCell className="font-semibold">{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.purchase_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.book_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4>By status</h4>
              <Table>
                <TableBody>
                  {Object.entries(data.by_status).map(([s, n]) => (
                    <TableRow key={s}>
                      <TableCell>
                        <StatusBadge status={s} />
                      </TableCell>
                        <TableCell className="text-right tabular-nums">{n}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <h4>By location</h4>
              <Table>
                <TableBody>
                  {data.by_location.map((r) => (
                    <TableRow key={r.location}>
                      <TableCell>{r.location}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          {data.by_condition && Object.keys(data.by_condition).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>By condition</h4>
              <Table>
                <TableBody>
                  {Object.entries(data.by_condition).map(([c, n]) => (
                    <TableRow key={c}>
                      <TableCell>
                        <ConditionBadge condition={c === "Unknown" ? null : c} />
                      </TableCell>
                        <TableCell className="text-right tabular-nums">{n}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return <MetricCard value={value} label={label} />;
}

export default function AssetTrackerPage() {
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const [status, setRecordStatus] = useState("");
  const [condition, setCondition] = useState("");
  // Seed the search from ?q= so scanning an asset's QR label deep-links here.
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [showReports, setShowReports] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [settingLocation, setSettingLocation] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (condition) p.set("condition", condition);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [status, condition, q]);

  const assets = useFetch<TrackedAsset[]>(`/api/asset-tracker${query}`);
  const summary = useFetch<AssetSummary>("/api/asset-tracker/summary");
  const directory = useFetch<User[]>("/api/users");

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TrackedAsset | null>(null);
  const [detail, setDetail] = useState<TrackedAsset | null>(null);
  const [deleting, setDeleting] = useState<TrackedAsset | null>(null);

  function reloadAll() {
    assets.reload();
    summary.reload();
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function bulk(action: string, value?: string) {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await api("/api/asset-tracker/bulk", {
        method: "POST",
        body: { ids, action, value: value ?? null },
      });
      notify(`Applied ${action} to ${ids.length} asset(s).`);
      reloadAll();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bulk action failed", "error");
    }
  }

  async function remove(a: TrackedAsset) {
    await api(`/api/asset-tracker/${a.id}`, { method: "DELETE" });
    notify("Asset deleted.");
    reloadAll();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>(
        "/api/asset-tracker/import",
        { method: "POST", form: fd },
      );
      const errs = res.errors.length ? ` (${res.errors.length} skipped)` : "";
      notify(`Imported: ${res.created} new, ${res.updated} updated${errs}.`);
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  return (
    <div>
      <PageHead
        title="Asset Tracker"
        subtitle="Track equipment, assignments, purchases, depreciation and maintenance."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setShowReports(true)}>
              Reports
            </Button>
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/asset-tracker/template.csv", "assets-template.csv").catch(
                  () => notify("Download failed", "error"),
                )
              }
            >
              Template
            </Button>
            <Button type="button" variant="outline"
              onClick={() => importRef.current?.click()}
            >
              Import CSV
            </Button>
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/asset-tracker/export.csv", "assets.csv").catch(() =>
                  notify("Export failed", "error"),
                )
              }
            >
              Export CSV
            </Button>
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/asset-tracker/labels.pdf", "asset-labels.pdf").catch(
                  () => notify("Label sheet failed", "error"),
                )
              }
            >
              Print labels
            </Button>
            <Button type="button" onClick={() => setAdding(true)}>
              + Add asset
            </Button>
            <Input aria-label="Import CSV" ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat value={summary.data?.total ?? "—"} label="Total assets" />
        <Stat value={summary.data?.by_status?.assigned ?? 0} label="Checked out" />
        <Stat value={summary.data?.by_status?.maintenance ?? 0} label="In maintenance" />
        <Stat
          value={summary.data ? money(summary.data.total_book_value) : "—"}
          label="Current book value"
        />
      </div>

      <Card className="mb-4">
        <CardContent>
        <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]">
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-990-search">Search</FieldLabel>
            <Input id="rd-assettrackerpage-990-search" aria-label="Name or asset tag…"
              placeholder="Name or asset tag…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-998-status">Status</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
              value={status || null}
              onValueChange={(value) => setRecordStatus(value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-assettrackerpage-998-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>All</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-assettrackerpage-1009-condition">Condition</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...CONDITIONS.map((c) => ({ value: c, label: c }))]}
              value={condition || null}
              onValueChange={(value) => setCondition(value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-assettrackerpage-1009-condition"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>All</SelectItem>
                  {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm">
          <strong>{selected.size} selected</strong>
          <span className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={() => bulk("checkin")}>
            Check in
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSettingLocation(true)}>
            Set location
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => bulk("retire")}>
            Retire
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmBulkDelete(true)}>
            Delete
          </Button>
        </div>
      )}

      {assets.loading ? (
        <Loading />
      ) : assets.error ? (
        <ErrorState message={assets.error} onRetry={assets.reload} />
      ) : !assets.data || assets.data.length === 0 ? (
        <Empty message="No assets yet. Add one to start tracking." />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead className="text-right">Book value</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.data.map((a) => (
                <TableRow key={a.id} data-state={selected.has(a.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${a.name}`}
                      checked={selected.has(a.id)}
                      onCheckedChange={() => toggle(a.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <code>{a.asset_tag}</code>
                  </TableCell>
                  <TableCell className="max-w-[24rem] whitespace-normal font-semibold">
                    <span className="inline-block max-w-64 truncate align-middle" title={a.name}>{a.name}</span>
                    {a.attachment_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground" title="Attachments"><Paperclip aria-hidden="true" />{a.attachment_count}</span>
                    )}
                    {isMaintenanceDue(a) && (
                      <Badge className="ml-1.5" variant="warning" title={`Service due ${a.next_maintenance_date}`}>
                        service due
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{a.category ?? "—"}</TableCell>
                  <TableCell>
                    <ConditionBadge condition={a.condition} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell>
                    {a.assigned_to_name ? (
                      <div className="leading-tight">
                        <div>{a.assigned_to_name}</div>
                        {a.assigned_to_title && (
                          <div className="text-xs text-muted-foreground">{a.assigned_to_title}</div>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(a.current_book_value)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setDetail(a)}
                      >
                        Manage
                      </Button>
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setEditing(a)}
                      >
                        Edit
                      </Button>
                      <Button type="button" variant="destructive" size="sm"
                        onClick={() => setDeleting(a)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </CardContent>
        </Card>
      )}

      {(adding || editing) && (
        <AssetFormModal
          asset={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={reloadAll}
        />
      )}
      {detail && (
        <AssetDetailModal
          asset={detail}
          users={directory.data ?? []}
          onClose={() => setDetail(null)}
          onChanged={reloadAll}
        />
      )}
      {showReports && <ReportsModal onClose={() => setShowReports(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete asset"
          message={`Delete ${deleting.name} (${deleting.asset_tag})? Its history will be removed too.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete assets"
          message={`Delete ${selected.size} asset(s)? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => bulk("delete")}
          onClose={() => setConfirmBulkDelete(false)}
        />
      )}
      {settingLocation && (
        <PromptModal
          title="Set location"
          label="New location"
          placeholder="e.g. HQ — 3rd floor"
          submitLabel="Apply"
          onConfirm={async (v) => {
            await bulk("set_location", v);
          }}
          onClose={() => setSettingLocation(false)}
        />
      )}
    </div>
  );
}
