import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import type {
  AssetEvent,
  AssetReports,
  AssetSummary,
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
  useToast,
} from "../components/ui";

const STATUSES = ["available", "assigned", "maintenance", "retired"];

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
  serial_number: "",
  vendor: "",
  purchase_date: "",
  purchase_cost: "",
  warranty_expiry: "",
  useful_life_years: "",
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
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...(asset
      ? {
          asset_tag: asset.asset_tag,
          name: asset.name,
          category: asset.category ?? "",
          location: asset.location ?? "",
          serial_number: asset.serial_number ?? "",
          vendor: asset.vendor ?? "",
          purchase_date: asset.purchase_date ?? "",
          purchase_cost: asset.purchase_cost ?? "",
          warranty_expiry: asset.warranty_expiry ?? "",
          useful_life_years: asset.useful_life_years?.toString() ?? "",
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
      serial_number: form.serial_number || null,
      vendor: form.vendor || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost || null,
      warranty_expiry: form.warranty_expiry || null,
      useful_life_years: form.useful_life_years
        ? Number(form.useful_life_years)
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
              placeholder="Laptop"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Location</label>
            <input
              placeholder="HQ — 3rd floor"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
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
  const [assignee, setAssignee] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [maintNote, setMaintNote] = useState("");
  const [maintCost, setMaintCost] = useState("");
  const [busy, setBusy] = useState(false);

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
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
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
        <DetailRow label="Serial" value={current.serial_number} />
        <DetailRow label="Vendor" value={current.vendor} />
        <DetailRow label="Purchased" value={current.purchase_date} />
        <DetailRow label="Purchase cost" value={money(current.purchase_cost)} />
        <DetailRow label="Warranty until" value={current.warranty_expiry} />
        <DetailRow
          label="Book value (today)"
          value={
            current.current_book_value != null ? (
              <span>{money(current.current_book_value)}</span>
            ) : (
              "—"
            )
          }
        />
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
        <button
          className="btn"
          style={{ flex: "0 0 auto" }}
          disabled={busy || !maintNote}
          onClick={() =>
            act(
              "maintenance",
              { note: maintNote, cost: maintCost || null, set_in_maintenance: false },
              "Maintenance logged.",
            ).then(() => {
              setMaintNote("");
              setMaintCost("");
            })
          }
        >
          Log
        </button>
      </div>

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
  // Seed the search from ?q= so scanning an asset's QR label deep-links here.
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [showReports, setShowReports] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [status, q]);

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
        </div>
      </div>

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
                <th>Tag</th>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>Assigned to</th>
                <th>Book value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.asset_tag}</code>
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{a.category ?? "—"}</td>
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
