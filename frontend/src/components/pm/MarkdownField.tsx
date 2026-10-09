import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bold, Italic, ListChecks, List, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export function MarkdownContent({ text }: { text: string }) {
  return <div className="flex flex-col gap-2 break-words text-sm [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:bg-muted [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ input: ({ checked }) => <Checkbox checked={Boolean(checked)} disabled aria-label="Checklist completion" /> }}>{text}</ReactMarkdown>
  </div>;
}
export function MarkdownField({ id, label, value, onChange, rows = 5, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; rows?: number; disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  function insert(before: string, after = "", fallback = "text") {
    const textarea = ref.current;
    const start = textarea?.selectionStart ?? value.length, end = textarea?.selectionEnd ?? value.length;
    const selection = value.slice(start, end) || fallback;
    onChange(value.slice(0, start) + before + selection + after + value.slice(end));
    textarea?.focus();
  }
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <div className="flex flex-wrap gap-1 border border-border bg-muted/20 p-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Bold in ${label}`} disabled={disabled || preview} onClick={() => insert("**", "**")}><Bold /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Italic in ${label}`} disabled={disabled || preview} onClick={() => insert("*", "*")}><Italic /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`List in ${label}`} disabled={disabled || preview} onClick={() => insert("\n- ", "", "Item")}><List /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Checklist in ${label}`} disabled={disabled || preview} onClick={() => insert("\n- [ ] ", "", "Item")}><ListChecks /></Button>
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setPreview(!preview)}>{preview ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}{preview ? "Write" : "Preview"}</Button>
    </div>
    {preview ? <div className="min-h-24 border border-border p-3"><MarkdownContent text={value || "Nothing to preview yet."} /></div> :
      <Textarea ref={ref} id={id} value={value} disabled={disabled} rows={rows} maxLength={20000} onChange={(event) => onChange(event.target.value)} />}
    <FieldDescription>Markdown supports headings, links and checklists.</FieldDescription>
  </Field>;
}
