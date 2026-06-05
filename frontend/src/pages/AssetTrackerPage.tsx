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
  ConfirmModal,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHead,
  bytes,
  useToast,
} from "../components/ui";

const STATUSES = ["available", "assigned", "maintenance", "retired"];
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

const CONDITION_BADGE: Record<string, string> = {
  new: "green",
  good: "green",
  fair: "amber",
  poor: "amber",
  damaged: "red",
};

function ConditionBadge({ condition }: { condition?: string | null }) {
  if (!condition) return <span className="muted">—</span>;
  return (
    <span className={`badge ${CONDITION_BADGE[condition] ?? ""}`}>{condition}</span>
  );
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
  const cls =
    status === "available"
      ? "green"
      : status === "assigned"
        ? "blue"
        : status === "maintenance"
          ? "amber"
          : "";
  return <span className={`badge ${cls}`}>{status}</span>;
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
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal title={asset ? "Edit asset" : "Add asset"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label>Asset tag *</label>
            <input
              required
              placeholder="LAP-001"
              value={form.asset_tag}
              onChange={(e) => set("asset_tag", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Name *</label>
            <input
              required
              placeholder="ThinkPad X1"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Category</label>
            <input
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
          </div>
          <div className="field">
            <label>Location</label>
            <input
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
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Condition</label>
            <select value={form.condition} onChange={(e) => set("condition", e.target.value)}>
              <option value="">—</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Maintenance every (days)</label>
            <input
              type="number"
              placeholder="e.g. 90"
              value={form.maintenance_interval_days}
              onChange={(e) => set("maintenance_interval_days", e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Serial number</label>
            <input
              value={form.serial_number}
              onChange={(e) => set("serial_number", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Vendor</label>
            <input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Purchase date</label>
            <input
              type="date"
              value={form.purchase_date}
              onChange={(e) => set("purchase_date", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Purchase cost</label>
            <input
              type="number"
              step="0.01"
              placeholder="1500.00"
              value={form.purchase_cost}
              onChange={(e) => set("purchase_cost", e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Warranty expiry</label>
            <input
              type="date"
              value={form.warranty_expiry}
              onChange={(e) => set("warranty_expiry", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Useful life (years)</label>
            <input
              type="number"
              placeholder="3"
              value={form.useful_life_years}
              onChange={(e) => set("useful_life_years", e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : asset ? "Save changes" : "Add asset"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value || "—"}</span>
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
  const [busy, setBusy] = useState(false);
  const attRef = useRef<HTMLInputElement>(null);

  async function act(path: string, body: unknown, msg: string) {
    setBusy(true);
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
      setBusy(false);
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
      <div className="spread" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
          <StatusBadge status={current.status} />
          {current.assigned_to_name && (
            <span className="muted">Assigned to {current.assigned_to_name}</span>
          )}
        </div>
        <button
          className="btn-sm"
          style={{ flex: "0 0 auto" }}
          onClick={() =>
            downloadFile(
              `/api/asset-tracker/${current.id}/label.png`,
              `${current.asset_tag}-label.png`,
            ).catch(() => notify("Label download failed", "error"))
          }
        >
          Download label
        </button>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
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
              <span className={isMaintenanceDue(current) ? "text-amber-600" : ""}>
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
      </div>

      {/* ---- Condition ---- */}
      <h4 style={{ margin: "0 0 8px" }}>Condition</h4>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {CONDITIONS.map((c) => (
          <button
            key={c}
            className={`btn-sm ${current.condition === c ? "btn-primary" : ""}`}
            style={{ flex: "0 0 auto" }}
            disabled={busy}
            onClick={() => act("condition", { condition: c }, `Condition set to ${c}.`)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ---- Assign / check-in ---- */}
      <h4 style={{ margin: "0 0 8px" }}>Assignment</h4>
      {current.status === "assigned" ? (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Return note (optional)</label>
            <input value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          </div>
          <button
            className="btn"
            style={{ flex: "0 0 auto" }}
            disabled={busy}
            onClick={() => act("checkin", { note: actionNote || null }, "Checked in.")}
          >
            Check in
          </button>
        </div>
      ) : (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 2 }}>
            <label>Assign to</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Select employee…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            style={{ flex: "0 0 auto" }}
            disabled={busy || !assignee || current.status === "retired"}
            onClick={() =>
              act("checkout", { user_id: assignee, note: actionNote || null }, "Checked out.")
            }
          >
            Check out
          </button>
        </div>
      )}

      {/* ---- Maintenance ---- */}
      <h4 style={{ margin: "18px 0 8px" }}>Log maintenance</h4>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0, flex: 3 }}>
          <label>What was done</label>
          <input
            placeholder="Battery replacement"
            value={maintNote}
            onChange={(e) => setMaintNote(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Cost</label>
          <input
            type="number"
            step="0.01"
            value={maintCost}
            onChange={(e) => setMaintCost(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Next in (days)</label>
          <input
            type="number"
            placeholder="90"
            value={maintNextDays}
            onChange={(e) => setMaintNextDays(e.target.value)}
          />
        </div>
        <button
          className="btn"
          style={{ flex: "0 0 auto" }}
          disabled={busy || !maintNote}
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
            })
          }
        >
          Log
        </button>
      </div>

      {/* ---- Retire / dispose ---- */}
      {current.status !== "retired" && (
        <>
          <h4 style={{ margin: "18px 0 8px" }}>Retire / dispose</h4>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Salvage value</label>
              <input
                type="number"
                step="0.01"
                value={salvage}
                onChange={(e) => setSalvage(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: 3 }}>
              <label>Disposal notes</label>
              <input
                placeholder="Sold / recycled / written off"
                value={disposalNotes}
                onChange={(e) => setDisposalNotes(e.target.value)}
              />
            </div>
            <button
              className="btn btn-danger"
              style={{ flex: "0 0 auto" }}
              disabled={busy}
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
            </button>
          </div>
        </>
      )}

      {/* ---- Attachments ---- */}
      <div className="spread" style={{ margin: "18px 0 8px" }}>
        <h4 style={{ margin: 0 }}>Attachments</h4>
        <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
          <select
            value={attKind}
            onChange={(e) => setAttKind(e.target.value)}
            className="!w-auto !py-1 text-sm"
          >
            <option value="document">Document</option>
            <option value="photo">Photo</option>
            <option value="receipt">Receipt</option>
            <option value="warranty">Warranty</option>
          </select>
          <button
            className="btn-sm"
            style={{ flex: "0 0 auto" }}
            onClick={() => attRef.current?.click()}
          >
            + Upload
          </button>
          <input ref={attRef} type="file" hidden onChange={uploadAttachment} />
        </div>
      </div>
      {!attachments.data || attachments.data.length === 0 ? (
        <p className="muted text-sm">No files attached.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {attachments.data.map((att) => (
            <div
              key={att.id}
              className="spread"
              style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}
            >
              <span className="row" style={{ gap: 8 }}>
                <span className="badge">{att.kind}</span>
                <span className="font-medium">{att.name}</span>
                <span className="muted text-xs">{bytes(att.size_bytes)}</span>
              </span>
              <span className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  onClick={() =>
                    downloadFile(
                      `/api/asset-tracker/attachments/${att.id}/download`,
                      att.name,
                    )
                  }
                >
                  Download
                </button>
                <button
                  className="btn-sm btn-danger"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => removeAttachment(att.id)}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Assignment timeline ---- */}
      {assignments.data && assignments.data.length > 0 && (
        <>
          <h4 style={{ margin: "18px 0 8px" }}>Assignment history</h4>
          <div style={{ maxHeight: 160, overflow: "auto" }}>
            {assignments.data.map((s, i) => (
              <div
                key={i}
                className="spread"
                style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}
              >
                <span className="font-medium">{s.user_name ?? "Unknown"}</span>
                <span className="muted text-xs">
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
      <h4 style={{ margin: "18px 0 8px" }}>History</h4>
      {events.loading ? (
        <Loading />
      ) : !events.data || events.data.length === 0 ? (
        <Empty message="No events yet." />
      ) : (
        <div style={{ maxHeight: 200, overflow: "auto" }}>
          {events.data.map((ev) => (
            <div
              key={ev.id}
              style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}
            >
              <div className="spread">
                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>
                  {ev.event_type}
                  {ev.user_name ? ` → ${ev.user_name}` : ""}
                  {ev.cost ? ` · ${money(ev.cost)}` : ""}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(ev.created_at).toLocaleString()}
                </span>
              </div>
              {ev.note && <div className="muted" style={{ fontSize: 13 }}>{ev.note}</div>}
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
          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <Stat value={data.totals.count} label="Assets" />
            <Stat value={money(data.totals.purchase_cost)} label="Purchase cost" />
            <Stat value={money(data.totals.book_value)} label="Book value" />
          </div>
          <h4>By category</h4>
          <table style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Count</th>
                <th>Purchase cost</th>
                <th>Book value</th>
              </tr>
            </thead>
            <tbody>
              {data.by_category.map((r) => (
                <tr key={r.category}>
                  <td style={{ fontWeight: 600 }}>{r.category}</td>
                  <td>{r.count}</td>
                  <td>{money(r.purchase_cost)}</td>
                  <td>{money(r.book_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid cols-2">
            <div>
              <h4>By status</h4>
              <table>
                <tbody>
                  {Object.entries(data.by_status).map(([s, n]) => (
                    <tr key={s}>
                      <td>
                        <StatusBadge status={s} />
                      </td>
                      <td>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4>By location</h4>
              <table>
                <tbody>
                  {data.by_location.map((r) => (
                    <tr key={r.location}>
                      <td>{r.location}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {data.by_condition && Object.keys(data.by_condition).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>By condition</h4>
              <table>
                <tbody>
                  {Object.entries(data.by_condition).map(([c, n]) => (
                    <tr key={c}>
                      <td>
                        <ConditionBadge condition={c === "Unknown" ? null : c} />
                      </td>
                      <td>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export default function AssetTrackerPage() {
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [condition, setCondition] = useState("");
  // Seed the search from ?q= so scanning an asset's QR label deep-links here.
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [showReports, setShowReports] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    if (action === "delete" && !confirm(`Delete ${ids.length} asset(s)?`)) return;
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
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={() => setShowReports(true)}>
              Reports
            </button>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              onClick={() => importRef.current?.click()}
            >
              Import CSV
            </button>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              onClick={() =>
                downloadFile("/api/asset-tracker/export.csv", "assets.csv").catch(() =>
                  notify("Export failed", "error"),
                )
              }
            >
              Export CSV
            </button>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              onClick={() =>
                downloadFile("/api/asset-tracker/labels.pdf", "asset-labels.pdf").catch(
                  () => notify("Label sheet failed", "error"),
                )
              }
            >
              Print labels
            </button>
            <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>
              + Add asset
            </button>
            <input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
          </div>
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Stat value={summary.data?.total ?? "—"} label="Total assets" />
        <Stat value={summary.data?.by_status?.assigned ?? 0} label="Checked out" />
        <Stat value={summary.data?.by_status?.maintenance ?? 0} label="In maintenance" />
        <Stat
          value={summary.data ? money(summary.data.total_book_value) : "—"}
          label="Current book value"
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input
              placeholder="Name or asset tag…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">All</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <strong>{selected.size} selected</strong>
          <span className="flex-1" />
          <button className="btn-sm" onClick={() => bulk("checkin")}>
            Check in
          </button>
          <button
            className="btn-sm"
            onClick={() => {
              const v = prompt("Set location to:");
              if (v !== null) bulk("set_location", v);
            }}
          >
            Set location
          </button>
          <button className="btn-sm" onClick={() => bulk("retire")}>
            Retire
          </button>
          <button className="btn-sm btn-danger" onClick={() => bulk("delete")}>
            Delete
          </button>
        </div>
      )}

      {assets.loading ? (
        <Loading />
      ) : assets.error ? (
        <ErrorState message={assets.error} onRetry={assets.reload} />
      ) : !assets.data || assets.data.length === 0 ? (
        <Empty message="No assets yet. Add one to start tracking." />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Tag</th>
                <th>Name</th>
                <th>Category</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Assigned to</th>
                <th>Book value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.data.map((a) => (
                <tr key={a.id} className={selected.has(a.id) ? "bg-brand-50/60" : ""}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                  </td>
                  <td>
                    <code>{a.asset_tag}</code>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {a.name}
                    {a.attachment_count > 0 && (
                      <span className="muted" title="Attachments"> 📎{a.attachment_count}</span>
                    )}
                    {isMaintenanceDue(a) && (
                      <span className="badge amber" style={{ marginLeft: 6 }} title={`Service due ${a.next_maintenance_date}`}>
                        service due
                      </span>
                    )}
                  </td>
                  <td>{a.category ?? "—"}</td>
                  <td>
                    <ConditionBadge condition={a.condition} />
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td>{a.assigned_to_name ?? "—"}</td>
                  <td>{money(a.current_book_value)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn-sm"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => setDetail(a)}
                      >
                        Manage
                      </button>
                      <button
                        className="btn-sm"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => setEditing(a)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-sm btn-danger"
                        style={{ flex: "0 0 auto" }}
                        onClick={() => setDeleting(a)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <ConfirmModal
          title="Delete asset"
          message={`Delete ${deleting.name} (${deleting.asset_tag})? Its history will be removed too.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
