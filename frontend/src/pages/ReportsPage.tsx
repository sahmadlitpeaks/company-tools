import { useMemo, useState } from "react";
import { BarChart3, Download, FileText, Lock, Table2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { ReportCatalogItem, ReportColumn, ReportResult } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "../components/ui";

function toCsv(columns: ReportColumn[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  return `${head}\n${body}`;
}
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { notify } = useToast();
  const catalog = useFetch<ReportCatalogItem[]>("/api/reports/catalog");
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [builder, setBuilder] = useState(false);

  const groups = useMemo(() => {
    const g: Record<string, ReportCatalogItem[]> = {};
    for (const c of catalog.data ?? []) (g[c.group] ??= []).push(c);
    return g;
  }, [catalog.data]);

  async function run(key: string) {
    setBuilder(false);
    setActive(key);
    setLoading(true);
    try {
      setResult(await api<ReportResult>(`/api/reports/run/${key}`));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setLoading(false);
  }

  return (
    <div>
      <PageHead title="Reports & Analytics" subtitle="Standard HR reports and a quick employee report builder." />
      <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
        {/* Report list */}
        <div className="card">
          <button
            className={`mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium ${builder ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
            onClick={() => { setBuilder(true); setActive(null); setResult(null); }}
          >
            <Table2 size={16} /> Employee report builder
          </button>
          {catalog.loading ? (
            <Loading />
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="muted px-2 pb-1 text-xs uppercase tracking-wide">{group}</div>
                {items.map((c) => (
                  <button
                    key={c.key}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${active === c.key ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
                    onClick={() => run(c.key)}
                    title={c.description}
                  >
                    <BarChart3 size={15} className="flex-none text-brand-600" />
                    <span className="flex-1">{c.title}</span>
                    {c.sensitive && <Lock size={12} className="text-ink-muted" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Result */}
        <div>
          {builder ? (
            <EmployeeBuilder />
          ) : loading ? (
            <Loading />
          ) : !result ? (
            <div className="card"><Empty icon="📊" message="Pick a report" hint="Choose a report on the left, or build an employee report." /></div>
          ) : (
            <div className="card">
              <div className="spread mb-3">
                <h3 className="m-0">{result.title}</h3>
                <button
                  className="btn-sm inline-flex items-center gap-1"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => downloadFile(`/api/reports/run/${result.key}/export.csv`, `${result.key}.csv`).catch(() => notify("Export failed", "error"))}
                >
                  <Download size={13} /> CSV
                </button>
              </div>
              <ResultTable columns={result.columns} rows={result.rows} />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function EmployeeBuilder() {
    const fields = useFetch<ReportColumn[]>("/api/reports/employees/fields");
    const [cols, setCols] = useState<string[]>(["display_name", "email", "department", "job_title"]);
    const [status, setStatus] = useState("");
    const [empType, setEmpType] = useState("");
    const [res, setRes] = useState<ReportResult | null>(null);
    const [busy, setBusy] = useState(false);

    function toggle(k: string) {
      setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
    }
    async function generate() {
      setBusy(true);
      try {
        setRes(await api<ReportResult>("/api/reports/employees", {
          method: "POST",
          body: { columns: cols, status: status || null, employment_type: empType || null },
        }));
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed", "error");
      }
      setBusy(false);
    }

    return (
      <div className="card">
        <h3 className="mt-0 inline-flex items-center gap-2"><Table2 size={18} className="text-brand-600" /> Employee report builder</h3>
        <div className="muted mb-1 text-xs">Columns</div>
        <div className="mb-3 flex flex-wrap gap-1">
          {(fields.data ?? []).map((f) => (
            <button
              key={f.key}
              className={`rounded-full border px-2 py-0.5 text-xs ${cols.includes(f.key) ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200"}`}
              onClick={() => toggle(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Employment type</label>
            <select value={empType} onChange={(e) => setEmpType(e.target.value)}>
              <option value="">Any</option>
              {["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button className="btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} disabled={busy || cols.length === 0} onClick={generate}>
            <FileText size={14} /> Generate
          </button>
          {res && (
            <button className="btn inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => downloadText(toCsv(res.columns, res.rows), "employees.csv")}>
              <Download size={14} /> CSV
            </button>
          )}
        </div>
        {res && <div className="mt-3"><ResultTable columns={res.columns} rows={res.rows} /></div>}
      </div>
    );
  }
}

function ResultTable({ columns, rows }: { columns: ReportColumn[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <Empty message="No data for this report." />;
  return (
    <div className="overflow-auto">
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key}>{r[c.key] == null ? "—" : String(r[c.key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
