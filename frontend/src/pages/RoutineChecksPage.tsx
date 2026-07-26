import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
  Ticket as TicketIcon,
  XCircle,
} from "lucide-react";
import { api } from "../api/client";
import type {
  ChecklistRun,
  ChecklistRunDetail,
  ChecklistTemplate,
  ComplianceSummary,
  RunItem,
  RunItemStatus,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, MetricStrip, Modal, PageHead, useToast } from "../components/ui";
import Attachments from "../components/Attachments";

const STATUS_BADGE: Record<string, string> = {
  todo: "",
  in_progress: "amber",
  submitted: "blue",
  done: "green",
};
const STATUS_LABEL: Record<string, string> = {
  todo: "Not started",
  in_progress: "In progress",
  submitted: "Awaiting verification",
  done: "Verified",
};
const ITEM_BADGE: Record<RunItemStatus, string> = {
  pending: "",
  ok: "green",
  issue: "red",
  na: "",
  done: "green",
};

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString() : "—";
}
function fmtTime(d?: string | null) {
  return d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}
/** How long the round took — replaces the "in / out" times written on paper. */
function duration(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  const mins = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function RoutineChecksPage() {
  const { user } = useAuth();
  const isManager = user?.is_admin || user?.role === "manager";
  const { notify } = useToast();
  const [tab, setTab] = useState<"runs" | "compliance">("runs");
  const [scope, setScope] = useState<"mine" | "all">(isManager ? "all" : "mine");
  const [templateId, setTemplateId] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (scope === "mine") p.set("mine", "true");
    if (templateId) p.set("template_id", templateId);
    if (status) p.set("status", status);
    return p.toString();
  }, [scope, templateId, status]);

  const runs = useFetch<ChecklistRun[]>(`/api/checklist-runs${qs ? `?${qs}` : ""}`);
  const templates = useFetch<ChecklistTemplate[]>("/api/checklist-templates?active=true");

  useEffect(() => {
    const run = params.get("run");
    if (run) {
      setOpenId(run);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const list = runs.data ?? [];
  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        value: list.filter((r) => ["todo", "in_progress"].includes(r.status)).length,
        label: "Open rounds",
      },
      {
        value: list.filter((r) => r.status === "submitted").length,
        label: "Awaiting verification",
      },
      {
        value: list.filter((r) => r.run_date === today).reduce((n, r) => n + r.issues, 0),
        label: "Issues today",
      },
      { value: list.filter((r) => r.is_late).length, label: "Late" },
    ];
  }, [list]);

  async function generateNow() {
    try {
      const res = await api<{ created: number }>("/api/checklist-templates/generate-due", {
        method: "POST",
        body: {},
      });
      notify(
        res.created
          ? `${res.created} round(s) generated.`
          : "Nothing due — today's rounds already exist.",
      );
      runs.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Routine Checks"
        subtitle="Daily rounds your team performs, with photo evidence and manager sign-off."
        action={
          isManager ? (
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={generateNow}
              title="Generate any rounds due today (the scheduler does this hourly)"
            >
              <RefreshCw size={15} /> Generate due
            </button>
          ) : undefined
        }
      />

      <div className="row mb-4" style={{ gap: 8 }}>
        <button
          className={`btn ${tab === "runs" ? "btn-primary" : ""}`}
          style={{ flex: "0 0 auto" }}
          onClick={() => setTab("runs")}
        >
          Rounds
        </button>
        {isManager && (
          <button
            className={`btn ${tab === "compliance" ? "btn-primary" : ""}`}
            style={{ flex: "0 0 auto" }}
            onClick={() => setTab("compliance")}
          >
            Compliance
          </button>
        )}
      </div>

      {tab === "compliance" && isManager ? (
        <Compliance />
      ) : (
        <>
          <div className="mb-4">
            <MetricStrip items={metrics} />
          </div>

          <div className="card mb-4">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Show</label>
                <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  <option value="mine">Mine &amp; my team</option>
                  {isManager && <option value="all">All rounds</option>}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Checklist</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">All</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            {runs.loading ? (
              <Loading />
            ) : list.length === 0 ? (
              <Empty
                icon={<ClipboardCheck />}
                message="No rounds yet"
                hint={
                  isManager
                    ? "Create a checklist under Checklists, then generate today's rounds."
                    : "Nothing is assigned to you right now."
                }
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Checklist</th>
                    <th>Date</th>
                    <th>Assignee</th>
                    <th>Progress</th>
                    <th>Issues</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <td>
                        <div className="font-medium">{r.template_name ?? r.title}</div>
                        {r.team && <div className="muted text-xs">{r.team}</div>}
                      </td>
                      <td>
                        {fmtDate(r.run_date)}
                        {r.is_late && (
                          <span className="badge red ml-1.5" title="Not submitted by the deadline">
                            late
                          </span>
                        )}
                      </td>
                      <td>{r.assignee_name ?? <span className="muted">Unclaimed</span>}</td>
                      <td className="whitespace-nowrap">
                        {r.items_answered}/{r.items_total}
                      </td>
                      <td>
                        {r.issues > 0 ? (
                          <span className="badge red">{r.issues}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {openId && (
        <RunModal id={openId} onClose={() => setOpenId(null)} onChanged={runs.reload} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Run detail — the screen someone actually walks the building with
// --------------------------------------------------------------------------
function RunModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<ChecklistRunDetail>(`/api/checklist-runs/${id}`);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);

  const run = detail.data;
  const locked = !!run && ["submitted", "done"].includes(run.status);
  const isReviewer = !!run && (user?.is_admin || run.reviewer_id === user?.id);
  const canVerify = !!run && run.status === "submitted" && isReviewer;

  const sections = useMemo(() => {
    const groups: { name: string; items: RunItem[] }[] = [];
    for (const item of run?.items ?? []) {
      const name = item.section || "Checks";
      const last = groups[groups.length - 1];
      if (last && last.name === name) last.items.push(item);
      else groups.push({ name, items: [item] });
    }
    return groups;
  }, [run]);

  async function respond(item: RunItem, body: Record<string, unknown>) {
    try {
      await api(`/api/checklist-runs/items/${item.id}`, { method: "PATCH", body });
      await detail.reload();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/checklist-runs/${id}/submit`, { method: "POST" });
      notify("Round submitted for verification.");
      await detail.reload();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
    setBusy(false);
  }

  async function claim() {
    try {
      await api(`/api/checklist-runs/${id}/claim`, { method: "POST" });
      await detail.reload();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function verify(decision: "verify" | "reject") {
    if (decision === "reject" && !reviewNote.trim()) {
      notify("Say what needs redoing before sending it back.", "error");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/checklist-runs/${id}/verify`, {
        method: "POST",
        body: { decision, note: reviewNote || null },
      });
      notify(decision === "verify" ? "Round verified." : "Sent back to the checker.");
      await detail.reload();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
    setBusy(false);
  }

  if (!run) {
    return (
      <Modal title="Round" onClose={onClose} maxWidth={860}>
        <Loading />
      </Modal>
    );
  }

  const answered = run.items.filter((i) => i.status !== "pending").length;
  const pct = run.items.length ? Math.round((answered / run.items.length) * 100) : 0;
  const missingPhotos = run.items.filter(
    (i) => i.photo_required && i.status !== "na" && i.photo_count === 0,
  ).length;
  const took = duration(run.started_at, run.submitted_at);

  return (
    <Modal title={run.template_name ?? run.title} onClose={onClose} maxWidth={860}>
      {/* Summary */}
      <div className="row mb-3" style={{ gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="muted text-xs">Date</div>
          <div className="font-medium">{fmtDate(run.run_date)}</div>
        </div>
        <div>
          <div className="muted text-xs">Checked by</div>
          <div className="font-medium">{run.assignee_name ?? "Unclaimed"}</div>
        </div>
        <div>
          <div className="muted text-xs">Verified by</div>
          <div className="font-medium">
            {run.verified_by_name ?? run.reviewer_name ?? "—"}
            {run.verified_at && <span className="muted text-xs"> · {fmtTime(run.verified_at)}</span>}
          </div>
        </div>
        <div>
          <div className="muted text-xs">Status</div>
          <span className={`badge ${STATUS_BADGE[run.status] ?? ""}`}>
            {STATUS_LABEL[run.status] ?? run.status}
          </span>
        </div>
        {took && (
          <div>
            <div className="muted text-xs">Took</div>
            <div className="font-medium inline-flex items-center gap-1">
              <Clock size={13} /> {took}
            </div>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="spread mb-1 text-sm">
          <span className="font-medium">
            {answered}/{run.items.length} checked
          </span>
          <span className="muted">
            {run.issues > 0 && <span className="badge red mr-1.5">{run.issues} issue(s)</span>}
            {missingPhotos > 0 && (
              <span className="badge amber">{missingPhotos} photo(s) needed</span>
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: "var(--primary, #6366f1)" }}
          />
        </div>
      </div>

      {run.review_note && (
        <div className="card mb-3" style={{ background: "var(--surface-2)" }}>
          <div className="muted text-xs">Reviewer note</div>
          <div className="text-sm">{run.review_note}</div>
        </div>
      )}

      {!run.assignee_id && (
        <button className="btn-primary mb-3" style={{ flex: "0 0 auto" }} onClick={claim}>
          Claim this round
        </button>
      )}

      {/* Sections */}
      <div className="flex flex-col gap-3">
        {sections.map((section) => {
          const done = section.items.filter((i) => i.status !== "pending").length;
          const isCollapsed = collapsed[section.name];
          return (
            <div key={section.name} className="card !p-0 overflow-hidden">
              <button
                className="spread w-full px-3 py-2 text-left"
                style={{ background: "var(--surface-2)" }}
                onClick={() => setCollapsed((c) => ({ ...c, [section.name]: !c[section.name] }))}
              >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  {section.name}
                </span>
                <span className="muted text-xs">
                  {done}/{section.items.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-col">
                  {section.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      locked={locked}
                      expanded={expandedItem === item.id}
                      onToggleExpand={() =>
                        setExpandedItem((cur) => (cur === item.id ? null : item.id))
                      }
                      onRespond={(body) => respond(item, body)}
                      onPhotoChanged={() => {
                        void detail.reload();
                        onChanged();
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 8 }}>
        {!locked && (
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            style={{ flex: "0 0 auto" }}
            disabled={busy}
            onClick={submit}
          >
            <CheckCircle2 size={15} /> {busy ? "Submitting…" : "Submit for verification"}
          </button>
        )}
      </div>

      {canVerify && (
        <div className="card mt-3">
          <h4 className="m-0 mb-2 inline-flex items-center gap-1.5">
            <ShieldCheck size={15} /> Verification
          </h4>
          <div className="field">
            <label>Note (required to send back)</label>
            <textarea
              rows={2}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="e.g. the server-room photo is missing"
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              disabled={busy}
              onClick={() => verify("reject")}
            >
              Send back
            </button>
            <button
              className="btn-primary"
              style={{ flex: "0 0 auto" }}
              disabled={busy}
              onClick={() => verify("verify")}
            >
              Verify &amp; sign off
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ItemRow({
  item,
  locked,
  expanded,
  onToggleExpand,
  onRespond,
  onPhotoChanged,
}: {
  item: RunItem;
  locked: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onRespond: (body: Record<string, unknown>) => void;
  onPhotoChanged: () => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const [value, setValue] = useState(item.value ?? "");
  useEffect(() => setNote(item.note ?? ""), [item.note]);
  useEffect(() => setValue(item.value ?? ""), [item.value]);

  const needsPhoto = item.photo_required && item.status !== "na" && item.photo_count === 0;
  // An issue always wants its detail visible; so does anything still owing a photo.
  const showDetail = expanded || item.status === "issue" || needsPhoto;

  const choices: { key: RunItemStatus; label: string; icon: JSX.Element }[] = [
    { key: "ok", label: "OK", icon: <CheckCircle2 size={14} /> },
    { key: "issue", label: "Issue", icon: <XCircle size={14} /> },
    { key: "na", label: "N/A", icon: <MinusCircle size={14} /> },
  ];

  return (
    <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <div className="spread gap-2" style={{ alignItems: "flex-start" }}>
        <button className="text-left" onClick={onToggleExpand} style={{ flex: "1 1 auto" }}>
          <div className="font-medium">{item.title}</div>
          <div className="muted flex flex-wrap items-center gap-1.5 text-xs">
            {item.asset_name && <span>{item.asset_name}</span>}
            {item.photo_required && (
              <span className={`badge ${needsPhoto ? "amber" : ""}`}>
                <Camera size={11} className="inline" /> photo{needsPhoto ? " required" : ` ×${item.photo_count}`}
              </span>
            )}
            {item.ticket_number && (
              <span className="badge blue inline-flex items-center gap-1">
                <TicketIcon size={11} /> #{item.ticket_number}
              </span>
            )}
            {item.responded_by_name && item.status !== "pending" && (
              <span>
                {item.responded_by_name} · {fmtTime(item.responded_at)}
              </span>
            )}
          </div>
        </button>

        <div className="flex flex-none flex-wrap gap-1">
          {item.response_type === "ok_issue" &&
            choices.map((c) => (
              <button
                key={c.key}
                disabled={locked}
                className={`btn-sm inline-flex items-center gap-1 ${
                  item.status === c.key ? `btn-primary ${ITEM_BADGE[c.key]}` : ""
                }`}
                style={{ flex: "0 0 auto" }}
                onClick={() => onRespond({ status: c.key })}
              >
                {c.icon} {c.label}
              </button>
            ))}
          {item.response_type === "done" && (
            <button
              disabled={locked}
              className={`btn-sm inline-flex items-center gap-1 ${
                item.status === "done" ? "btn-primary" : ""
              }`}
              style={{ flex: "0 0 auto" }}
              onClick={() => onRespond({ status: item.status === "done" ? "pending" : "done" })}
            >
              <CheckCircle2 size={14} /> Done
            </button>
          )}
          {(item.response_type === "text" || item.response_type === "number") && (
            <input
              disabled={locked}
              type={item.response_type === "number" ? "number" : "text"}
              value={value}
              placeholder="Reading"
              style={{ maxWidth: 160 }}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => value !== (item.value ?? "") && onRespond({ value })}
            />
          )}
        </div>
      </div>

      {showDetail && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            rows={2}
            disabled={locked}
            value={note}
            placeholder={item.status === "issue" ? "What's wrong?" : "Note (optional)"}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (item.note ?? "") && onRespond({ note })}
          />
          <Attachments
            entityType="task_item"
            entityId={item.id}
            compact
            accept="image/*"
            capture="environment"
            heading="Photos"
            label="+ Take / add photo"
            onChanged={onPhotoChanged}
          />
          {item.status === "issue" && !item.ticket_number && (
            <p className="muted inline-flex items-center gap-1 text-xs">
              <AlertTriangle size={12} /> No ticket was raised for this item.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Compliance (managers)
// --------------------------------------------------------------------------
function Compliance() {
  const [days, setDays] = useState(30);
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86400000);
  const qs = `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
  const summary = useFetch<ComplianceSummary>(`/api/checklist-runs/summary?${qs}`);
  const s = summary.data;

  if (summary.loading) return <Loading />;
  if (!s) return <Empty icon={<ClipboardCheck />} message="No data yet" />;

  return (
    <div>
      <div className="card mb-4">
        <div className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
          <label>Period</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="mb-4">
        <MetricStrip
          items={[
            { value: s.runs, label: "Rounds" },
            { value: `${s.completion_rate}%`, label: "Verified on record" },
            { value: s.late, label: "Late or missed" },
            { value: s.issues, label: "Issues found" },
          ]}
        />
      </div>

      <div className="card mb-4">
        <h4 className="m-0 mb-2">By checklist</h4>
        {s.by_template.length === 0 ? (
          <p className="muted text-sm">No rounds in this period.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Team</th>
                <th>Rounds</th>
                <th>Verified</th>
                <th>Awaiting</th>
                <th>Open</th>
                <th>Late</th>
                <th>Issues</th>
                <th>Completion</th>
              </tr>
            </thead>
            <tbody>
              {s.by_template.map((t) => (
                <tr key={t.template_id}>
                  <td className="font-medium">{t.template_name}</td>
                  <td>{t.team}</td>
                  <td>{t.runs}</td>
                  <td>{t.verified}</td>
                  <td>{t.submitted}</td>
                  <td>{t.open}</td>
                  <td>{t.late > 0 ? <span className="badge red">{t.late}</span> : "—"}</td>
                  <td>{t.issues}</td>
                  <td>{t.completion_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h4 className="m-0 mb-1">Repeat offenders</h4>
        <p className="muted mb-2 text-xs">
          Checkpoints failing most often — three days of “needs black ink” is a supply problem, not
          three printer problems.
        </p>
        {s.hotspots.length === 0 ? (
          <p className="muted text-sm">No issues recorded in this period.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Where</th>
                <th>Asset</th>
                <th>Times</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {s.hotspots.map((h, i) => (
                <tr key={i}>
                  <td className="font-medium">{h.title}</td>
                  <td>{h.section ?? "—"}</td>
                  <td>{h.asset_name ?? "—"}</td>
                  <td>
                    <span className="badge red">{h.issue_count}</span>
                  </td>
                  <td>{fmtDate(h.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
