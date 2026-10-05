import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FilterSelect({ id, label, value, options, onChange, disabled = false }: {
  id: string; label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; disabled?: boolean;
}) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={options} value={value} disabled={disabled} onValueChange={(next) => onChange(next ?? "")}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}

export function DateRangeFields({ id, after, before, onChange }: {
  id: string; after: string; before: string; onChange: (field: "after" | "before", value: string) => void;
}) {
  return <FieldGroup className="grid gap-3 sm:grid-cols-2">
    <Field><FieldLabel htmlFor={`${id}-after`}>From date (UTC)</FieldLabel><Input id={`${id}-after`} type="date" max={before || undefined} value={after} onChange={(event) => onChange("after", event.target.value)} /></Field>
    <Field><FieldLabel htmlFor={`${id}-before`}>To date (UTC)</FieldLabel><Input id={`${id}-before`} type="date" min={after || undefined} value={before} onChange={(event) => onChange("before", event.target.value)} /></Field>
  </FieldGroup>;
}

export function ListPagination({ id, total, offset, limit, loading, onPage, onPageSize }: {
  id: string; total: number; offset: number; limit: number; loading: boolean;
  onPage: (offset: number) => void; onPageSize: (limit: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3">
    <p className="text-sm text-muted-foreground" aria-live="polite">{total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : "0 results"}</p>
    <div className="flex flex-wrap items-center gap-4">
      <div className="w-28"><FilterSelect id={`${id}-page-size`} label="Rows per page" value={String(limit)} options={[10, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))} onChange={(value) => onPageSize(Number(value))} disabled={loading} /></div>
      <Pagination aria-label={`${id} pagination`} className="w-auto">
        <PaginationContent>
          <PaginationItem><PaginationPrevious disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - limit))} /></PaginationItem>
          <PaginationItem><span className="px-2 text-sm tabular-nums">Page {Math.floor(offset / limit) + 1} of {pages}</span></PaginationItem>
          <PaginationItem><PaginationNext disabled={loading || offset + limit >= total} onClick={() => onPage(offset + limit)} /></PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  </div>;
}
