import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { api } from "../../api/client";
import type { CrmImportIssue, CrmImportPreview, CrmImportResult } from "../../api/types";
import { Modal, useToast } from "../ui";
import { stageLabel } from "./crm";

const FIELD_OPTIONS = [
  { value: null, label: "Don't import" },
  { value: "name", label: "Name" }, { value: "email", label: "Email" }, { value: "phone", label: "Phone" },
  { value: "company", label: "Company" }, { value: "value", label: "Deal value" }, { value: "notes", label: "Notes" },
  { value: "status", label: "Stage" }, { value: "priority", label: "Priority" }, { value: "tags", label: "Tags" },
  { value: "next_step", label: "Next step" }, { value: "follow_up_date", label: "Follow-up date" },
  { value: "expected_close_date", label: "Expected close" }, { value: "lost_reason", label: "Lost reason" },
];
const MATCH_LABELS = { new: "New lead", duplicate_in_file: "Repeat in file", exists: "Already in CRM" } as const;
const MATCH_BADGES = { new: "success", duplicate_in_file: "warning", exists: "info" } as const;

function Issues({ title, issues, variant }: { title: string; issues: CrmImportIssue[]; variant: "default" | "destructive" }) {
  if (!issues.length) return null;
  const shown = issues.slice(0, 5);
  return <Alert variant={variant}>
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>
      <ul className="flex list-none flex-col gap-1">{shown.map((issue) => <li key={`${issue.row}-${issue.message}`}>Row {issue.row}: {issue.message}</li>)}</ul>
      {issues.length > shown.length && <p>…and {issues.length - shown.length} more{issues.length >= 100 ? " (first 100 shown)" : ""}.</p>}
    </AlertDescription>
  </Alert>;
}

/** Preview a CSV/XLSX, adjust its column matching and duplicate handling, then import it. */
export default function CrmImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { notify } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CrmImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "merge">("skip");

  function formFor(selected: File, sheet?: string | null, mapping?: Record<string, string | null>) {
    const body = new FormData();
    body.append("file", selected);
    if (sheet) body.append("sheet", sheet);
    if (mapping) body.append("mapping", JSON.stringify(mapping));
    return body;
  }

  async function load(selected: File, sheet?: string | null, mapping?: Record<string, string | null>) {
    setLoading(true); setError(null);
    try { setPreview(await api<CrmImportPreview>("/api/crm/import/preview", { method: "POST", form: formFor(selected, sheet, mapping) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The file couldn't be read"); }
    finally { setLoading(false); }
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected); setPreview(null);
    if (selected) void load(selected);
  }

  function remap(column: string, field: string | null) {
    if (!file || !preview) return;
    const mapping = { ...preview.mapping, [column]: field };
    // Each field except notes takes one column: moving it frees its old column.
    if (field && field !== "notes") for (const other of preview.columns) if (other !== column && mapping[other] === field) mapping[other] = null;
    void load(file, preview.sheet, mapping);
  }

  async function runImport() {
    if (!file || !preview) return;
    setImporting(true);
    const body = formFor(file, preview.sheet, preview.mapping);
    body.append("on_duplicate", onDuplicate);
    try {
      const result = await api<CrmImportResult>("/api/crm/import", { method: "POST", form: body });
      const parts = [`${result.created} added`, result.merged && `${result.merged} merged`, result.skipped && `${result.skipped} skipped`].filter(Boolean);
      notify(`Import finished: ${parts.join(", ")}.`);
      onImported();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const duplicates = (preview?.duplicates_in_file ?? 0) + (preview?.existing_matches ?? 0);
  const toImport = preview ? (onDuplicate === "skip" ? preview.valid_rows - duplicates : preview.valid_rows) : 0;

  return <Modal
    title="Import leads"
    description="Upload a .csv or .xlsx file. Nothing is saved until you confirm."
    onClose={onClose}
    maxWidth={760}
    footer={<>
      <Button type="button" variant="outline" onClick={onClose} disabled={importing}>Cancel</Button>
      <Button type="button" onClick={() => void runImport()} disabled={!preview || loading || importing || preview.valid_rows === 0}>
        {importing && <Spinner data-icon="inline-start" />}
        {preview ? (onDuplicate === "merge" && duplicates ? `Import ${toImport} rows` : `Import ${toImport} leads`) : "Import"}
      </Button>
    </>}
  >
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="crm-import-file">Spreadsheet</FieldLabel>
        <Input id="crm-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose} />
        <FieldDescription>Up to 5 MB and 5,000 rows. The first row must hold the column names. Dates use YYYY-MM-DD.</FieldDescription>
      </Field>
      {preview && preview.sheets.length > 1 && <Field>
        <FieldLabel htmlFor="crm-import-sheet">Sheet</FieldLabel>
        <Select items={preview.sheets.map((value) => ({ value, label: value }))} value={preview.sheet ?? null} onValueChange={(sheet) => file && sheet && void load(file, sheet)}>
          <SelectTrigger id="crm-import-sheet" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{preview.sheets.map((sheet) => <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>}
    </FieldGroup>

    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Reading file…</p>}
    {error && <Alert variant="destructive"><AlertTitle>Can't import this file</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

    {preview && <>
      <section aria-labelledby="crm-import-columns" className="flex flex-col gap-3">
        <h3 id="crm-import-columns" className="text-sm font-semibold">Match columns</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {preview.columns.map((column, index) => <Field key={column}>
            <FieldLabel htmlFor={`crm-import-col-${index}`} className="break-all">{column}</FieldLabel>
            <Select items={FIELD_OPTIONS} value={preview.mapping[column] ?? null} disabled={loading} onValueChange={(field) => remap(column, field)}>
              <SelectTrigger id={`crm-import-col-${index}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{FIELD_OPTIONS.map((option) => <SelectItem key={option.value ?? "none"} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>)}
        </div>
      </section>

      <p role="status" className="text-sm">
        {preview.total_rows} rows · {preview.valid_rows} ready · {preview.duplicates_in_file} repeated in the file · {preview.existing_matches} already in the CRM
      </p>

      {duplicates > 0 && <Field>
        <FieldLabel id="crm-import-duplicates">Rows with an email that's already in the CRM or earlier in the file</FieldLabel>
        <ToggleGroup aria-labelledby="crm-import-duplicates" variant="outline" spacing={0} className="flex-wrap justify-start" value={[onDuplicate]} onValueChange={(value) => value[0] && setOnDuplicate(value[0] as "skip" | "merge")}>
          <ToggleGroupItem value="skip">Skip them</ToggleGroupItem>
          <ToggleGroupItem value="merge">Merge into the existing lead</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>{onDuplicate === "merge" ? "Fills empty fields only and adds the row's notes to the lead's timeline. Existing values are never overwritten." : "The existing lead is left unchanged."}</FieldDescription>
      </Field>}

      <Issues title={`${preview.errors.length} rows can't be imported`} issues={preview.errors} variant="destructive" />
      <Issues title="Adjusted while reading" issues={preview.warnings} variant="default" />

      {preview.sample.length > 0 && <section aria-labelledby="crm-import-sample" className="flex flex-col gap-2">
        <h3 id="crm-import-sample" className="text-sm font-semibold">First rows</h3>
        <ul className="flex flex-col gap-2 sm:hidden">{preview.sample.map((row) => <li key={row.row} className="flex flex-col gap-1 border p-2 text-sm">
          <span className="flex items-center justify-between gap-2"><span className="min-w-0 break-words font-medium">{row.name ?? row.email ?? row.phone}</span><Badge variant={MATCH_BADGES[row.match]}>{MATCH_LABELS[row.match]}</Badge></span>
          <span className="break-all text-xs text-muted-foreground">{[row.email, row.phone, row.company].filter(Boolean).join(" · ")}</span>
        </li>)}</ul>
        <div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Lead</TableHead><TableHead>Stage</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
          <TableBody>{preview.sample.map((row) => <TableRow key={row.row}>
            <TableCell className="tabular-nums">{row.row}</TableCell>
            <TableCell className="max-w-72 whitespace-normal"><p className="break-words font-medium">{row.name ?? "—"}</p><p className="break-all text-xs text-muted-foreground">{[row.email, row.phone, row.company].filter(Boolean).join(" · ")}</p></TableCell>
            <TableCell>{stageLabel(row.status)}</TableCell>
            <TableCell><Badge variant={MATCH_BADGES[row.match]}>{MATCH_LABELS[row.match]}</Badge></TableCell>
          </TableRow>)}</TableBody></Table></div>
      </section>}
    </>}
  </Modal>;
}
