import { useMemo, useState } from "react";
import { BarChart3, Download, FileText, Lock, Table2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { ReportCatalogItem, ReportColumn, ReportResult } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "../components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
    } finally {
      setLoading(false);
    }

  }

  return (
    <div>
      <PageHead title="Reports & Analytics" subtitle="Standard HR reports and a quick employee report builder." />
      <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
        {/* Report list */}
        <Card>
          <CardContent className="flex flex-col gap-2">
          <Button type="button"
            variant={builder ? "default" : "ghost"}
            className="w-full justify-start"
            onClick={() => { setBuilder(true); setActive(null); setResult(null); }}
          >
            <Table2 data-icon="inline-start" /> Employee report builder
          </Button>
          {catalog.loading ? (
            <Loading />
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-2 pb-1 text-xs uppercase tracking-wide text-muted-foreground">{group}</div>
                {items.map((c) => (
                  <Button type="button"
                    key={c.key}
                    variant={active === c.key ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => run(c.key)}
                    title={c.description}
                  >
                    <BarChart3 data-icon="inline-start" />
                    <span className="flex-1">{c.title}</span>
                    {c.sensitive && <Lock data-icon="inline-end" />}
                  </Button>
                ))}
              </div>
            ))
          )}
          </CardContent>
        </Card>

        {/* Result */}
        <div>
          {builder ? (
            <EmployeeBuilder />
          ) : loading ? (
            <Loading />
          ) : !result ? (
            <Card><CardContent><Empty icon={<BarChart3 />} message="Pick a report" hint="Choose a report on the left, or build an employee report." /></CardContent></Card>
          ) : (
            <Card className="py-0">
              <CardHeader className="grid grid-cols-[1fr_auto] items-center py-(--card-spacing)">
                <CardTitle>{result.title}</CardTitle>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => downloadFile(`/api/reports/run/${result.key}/export.csv`, `${result.key}.csv`).catch(() => notify("Export failed", "error"))}
                >
                  <Download data-icon="inline-start" /> CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0"><ResultTable columns={result.columns} rows={result.rows} /></CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );

  function EmployeeBuilder() {
    const fields = useFetch<ReportColumn[]>("/api/reports/employees/fields");
    const [cols, setCols] = useState<string[]>(["display_name", "email", "department", "job_title"]);
    const [status, setRecordStatus] = useState("");
    const [empType, setEmpType] = useState("");
    const [res, setRes] = useState<ReportResult | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function generate() {
      setIsSubmitting(true);
      try {
        setRes(await api<ReportResult>("/api/reports/employees", {
          method: "POST",
          body: { columns: cols, status: status || null, employment_type: empType || null },
        }));
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed", "error");
      } finally {
      setIsSubmitting(false);
    }

    }

    return (
      <Card className="py-0">
        <CardHeader className="py-(--card-spacing)"><CardTitle className="inline-flex items-center gap-2"><Table2 /> Employee report builder</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
        <Field>
        <FieldLabel>Columns</FieldLabel>
        <ToggleGroup multiple value={cols} onValueChange={setCols} variant="outline" size="sm" className="flex-wrap justify-start">
          {(fields.data ?? []).map((f) => (
            <ToggleGroupItem
              key={f.key}
              value={f.key}
            >
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        </Field>
        <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="reports-status">Status</FieldLabel>
            <Select
              items={[{ value: null, label: "Any" }, ...["active", "pending", "disabled"].map((value) => ({ value, label: value }))]}
              value={status || null}
              onValueChange={(value) => setRecordStatus(value ?? "")}
            >
              <SelectTrigger id="reports-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>Any</SelectItem>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="pending">pending</SelectItem>
                <SelectItem value="disabled">disabled</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="reports-employment-type">Employment type</FieldLabel>
            <Select
              items={[{ value: null, label: "Any" }, ...["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => ({ value: t, label: t }))]}
              value={empType || null}
              onValueChange={(value) => setEmpType(value ?? "")}
            >
              <SelectTrigger id="reports-employment-type" aria-label="Employment type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>Any</SelectItem>
                {["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Button type="button" disabled={isSubmitting || cols.length === 0} onClick={generate}>
            <FileText data-icon="inline-start" /> Generate
          </Button>
          {res && (
            <Button type="button" variant="outline" onClick={() => downloadText(toCsv(res.columns, res.rows), "employees.csv")}>
              <Download data-icon="inline-start" /> CSV
            </Button>
          )}
        </FieldGroup>
        {res && <div className="mt-3"><ResultTable columns={res.columns} rows={res.rows} /></div>}
        </CardContent>
      </Card>
    );
  }
}

function ResultTable({ columns, rows }: { columns: ReportColumn[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <Empty message="No data for this report." />;
  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c.key} className="whitespace-normal">{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={JSON.stringify(r)}>{columns.map((c) => <TableCell key={c.key} className="max-w-[24rem] whitespace-normal"><span className="block break-words">{r[c.key] == null ? "—" : String(r[c.key])}</span></TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
