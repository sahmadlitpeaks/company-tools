import type { SharePointSourceOption } from "@/api/sharepoint";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SourceFilter({ id, value, sources, onChange }: {
  id: string; value: string; sources: SharePointSourceOption[]; onChange: (value: string) => void;
}) {
  return <Field className="w-full sm:max-w-xs">
    <FieldLabel htmlFor={id}>Document source</FieldLabel>
    <Select value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectItem value="all">All sources</SelectItem>
        {sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
  </Field>;
}
