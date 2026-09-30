import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TaskChoice({ id, label, value, items, onChange, disabled = false, ariaLabel }: {
  id: string; label: string; value: string; items: Array<{ value: string; label: string }>;
  onChange: (value: string) => void; disabled?: boolean; ariaLabel?: string;
}) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={(next) => next !== null && onChange(next)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel ?? label} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}
