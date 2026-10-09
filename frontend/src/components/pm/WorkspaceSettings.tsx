import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, pmError, type PmMember, type PmProject } from "@/api/pm";
import { type CustomField, type WorkspaceConfig } from "@/api/pm-workspace";
import { FilterSelect } from "@/components/ListControls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const newKey = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function WorkspaceSettings({ project, members, config, onSaved }: {
  project: PmProject; members: PmMember[]; config: WorkspaceConfig; onSaved: (config: WorkspaceConfig) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [state, setState] = useState({ busy: false, error: "", saved: false });
  const disabled = state.busy || project.status === "archived";
  function edit<K extends keyof WorkspaceConfig>(key: K, value: WorkspaceConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value })); setState({ busy: false, error: "", saved: false });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setState({ busy: true, error: "", saved: false });
    try {
      const saved = await api<WorkspaceConfig>(`/api/pm/projects/${project.id}/configuration`, { method: "PUT", body: draft });
      onSaved(saved); setState({ busy: false, error: "", saved: true });
    } catch (cause) { setState({ busy: false, error: pmError(cause), saved: false }); }
  }
  return <Card>
    <CardHeader><CardTitle>Project workflow and fields</CardTitle><CardDescription>Configure the team's process, reusable issue templates and component ownership.</CardDescription></CardHeader>
    <CardContent>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        {state.saved && <p role="status" className="text-sm text-success">Project configuration saved.</p>}
        <Tabs defaultValue="workflow">
          <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="workflow">Workflow</TabsTrigger><TabsTrigger value="fields">Fields</TabsTrigger><TabsTrigger value="components">Components</TabsTrigger><TabsTrigger value="templates">Templates</TabsTrigger></TabsList>
          <TabsContent value="workflow" className="flex flex-col gap-3 pt-4">
            <p className="text-sm text-muted-foreground">Names describe your workflow. Categories keep sprint completion and reports consistent. Move existing issues before removing a state or changing its category.</p>
            {draft.states.map((workflow, index) => <section key={workflow.key} className="flex flex-col gap-3 border border-border p-3" aria-label={workflow.name || "New workflow state"}>
              <FieldGroup className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field><FieldLabel htmlFor={`pm-state-${workflow.key}`}>State name</FieldLabel><Input id={`pm-state-${workflow.key}`} required maxLength={80} disabled={disabled} value={workflow.name} onChange={(event) => edit("states", draft.states.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
                <FilterSelect id={`pm-category-${workflow.key}`} label="Reporting category" value={workflow.category} options={ISSUE_STATUSES} disabled={disabled || ISSUE_STATUSES.some((item) => item.value === workflow.key)} onChange={(value) => edit("states", draft.states.map((item, i) => i === index ? { ...item, category: value as typeof workflow.category } : item))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${workflow.name} state`} disabled={disabled || ISSUE_STATUSES.some((item) => item.value === workflow.key)} onClick={() => edit("states", draft.states.filter((item) => item.key !== workflow.key).map((item) => ({ ...item, allowed_next: item.allowed_next?.filter((key) => key !== workflow.key) ?? null })))}><Trash2 /></Button>
              </FieldGroup>
              <Field orientation="horizontal"><Switch id={`pm-rules-${workflow.key}`} checked={workflow.allowed_next !== null} disabled={disabled} onCheckedChange={(checked) => edit("states", draft.states.map((item, i) => i === index ? { ...item, allowed_next: checked ? draft.states.map((target) => target.key) : null } : item))} /><FieldLabel htmlFor={`pm-rules-${workflow.key}`}>Limit transitions from this state</FieldLabel></Field>
              {workflow.allowed_next !== null && <FieldGroup className="flex flex-wrap gap-3">{draft.states.map((target) => <Field key={target.key} orientation="horizontal" className="w-auto">
                <Checkbox id={`pm-transition-${workflow.key}-${target.key}`} checked={workflow.allowed_next?.includes(target.key)} disabled={disabled} onCheckedChange={(checked) => edit("states", draft.states.map((item, i) => i === index ? { ...item, allowed_next: checked ? [...(item.allowed_next ?? []), target.key] : item.allowed_next?.filter((key) => key !== target.key) ?? [] } : item))} />
                <FieldLabel htmlFor={`pm-transition-${workflow.key}-${target.key}`}>{target.name}</FieldLabel>
              </Field>)}</FieldGroup>}
            </section>)}
            <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => edit("states", [...draft.states, { key: newKey("state"), name: "", category: "in_progress", allowed_next: null }])}><Plus data-icon="inline-start" />Add workflow state</Button>
          </TabsContent>
          <TabsContent value="fields" className="flex flex-col gap-3 pt-4">
            <p className="text-sm text-muted-foreground">New fields start optional. A required field needs a value on every existing issue before it can be enabled.</p>
            {draft.fields.map((field, index) => <section key={field.key} className="flex flex-col gap-3 border border-border p-3" aria-label={field.name || "New custom field"}>
              <FieldGroup className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field><FieldLabel htmlFor={`pm-field-${field.key}`}>Field name</FieldLabel><Input id={`pm-field-${field.key}`} required maxLength={80} disabled={disabled} value={field.name} onChange={(event) => edit("fields", draft.fields.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
                <FilterSelect id={`pm-field-type-${field.key}`} label="Field type" value={field.kind} options={["text", "number", "date", "select", "checkbox"].map((value) => ({ value, label: value === "select" ? "Selection" : value[0].toUpperCase() + value.slice(1) }))} disabled={disabled} onChange={(value) => edit("fields", draft.fields.map((item, i) => i === index ? { ...item, kind: value as CustomField["kind"] } : item))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.name} field`} disabled={disabled} onClick={() => edit("fields", draft.fields.filter((item) => item.key !== field.key))}><Trash2 /></Button>
              </FieldGroup>
              {field.kind === "select" && <Field><FieldLabel htmlFor={`pm-options-${field.key}`}>Options · one per line</FieldLabel><Textarea id={`pm-options-${field.key}`} value={field.options.join("\n")} disabled={disabled} onChange={(event) => edit("fields", draft.fields.map((item, i) => i === index ? { ...item, options: event.target.value.split("\n") } : item))} /></Field>}
              <Field orientation="horizontal"><Checkbox id={`pm-required-${field.key}`} checked={field.required} disabled={disabled} onCheckedChange={(checked) => edit("fields", draft.fields.map((item, i) => i === index ? { ...item, required: Boolean(checked) } : item))} /><FieldLabel htmlFor={`pm-required-${field.key}`}>Required</FieldLabel></Field>
            </section>)}
            <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => edit("fields", [...draft.fields, { key: newKey("field"), name: "", kind: "text", required: false, options: [] }])}><Plus data-icon="inline-start" />Add custom field</Button>
          </TabsContent>
          <TabsContent value="components" className="flex flex-col gap-3 pt-4">
            {draft.components.map((component, index) => <FieldGroup key={component.key} className="grid items-end gap-3 border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field><FieldLabel htmlFor={`pm-component-${component.key}`}>Component name</FieldLabel><Input id={`pm-component-${component.key}`} value={component.name} required maxLength={80} disabled={disabled} onChange={(event) => edit("components", draft.components.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
              <FilterSelect id={`pm-component-lead-${component.key}`} label="Owner" value={component.lead_id ?? ""} options={[{ value: "", label: "Unassigned" }, ...members.filter((member) => member.role !== "viewer").map((member) => ({ value: member.user_id, label: member.name }))]} disabled={disabled} onChange={(value) => edit("components", draft.components.map((item, i) => i === index ? { ...item, lead_id: value || null } : item))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${component.name} component`} disabled={disabled} onClick={() => edit("components", draft.components.filter((item) => item.key !== component.key))}><Trash2 /></Button>
            </FieldGroup>)}
            <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => edit("components", [...draft.components, { key: newKey("component"), name: "", lead_id: null }])}><Plus data-icon="inline-start" />Add component</Button>
          </TabsContent>
          <TabsContent value="templates" className="flex flex-col gap-3 pt-4">
            {draft.templates.map((template, index) => <section key={template.key} className="flex flex-col gap-3 border border-border p-3" aria-label={template.name || "New issue template"}>
              <FieldGroup className="grid items-end gap-3 sm:grid-cols-3">
                <Field><FieldLabel htmlFor={`pm-template-${template.key}`}>Template name</FieldLabel><Input id={`pm-template-${template.key}`} value={template.name} required maxLength={80} disabled={disabled} onChange={(event) => edit("templates", draft.templates.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
                <FilterSelect id={`pm-template-type-${template.key}`} label="Issue type" value={template.issue_type} options={ISSUE_TYPES.filter((item) => item.value !== "subtask")} disabled={disabled} onChange={(value) => edit("templates", draft.templates.map((item, i) => i === index ? { ...item, issue_type: value as typeof template.issue_type } : item))} />
                <FilterSelect id={`pm-template-priority-${template.key}`} label="Default priority" value={template.priority} options={ISSUE_PRIORITIES} disabled={disabled} onChange={(value) => edit("templates", draft.templates.map((item, i) => i === index ? { ...item, priority: value } : item))} />
              </FieldGroup>
              <Field><FieldLabel htmlFor={`pm-template-description-${template.key}`}>Description template</FieldLabel><Textarea id={`pm-template-description-${template.key}`} rows={5} value={template.description} maxLength={20000} disabled={disabled} placeholder={"## Steps to reproduce\n\n## Expected behavior\n\n## Actual behavior"} onChange={(event) => edit("templates", draft.templates.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /><FieldDescription>Supports Markdown and checklists.</FieldDescription></Field>
              <Button type="button" variant="ghost" className="self-start" disabled={disabled} onClick={() => edit("templates", draft.templates.filter((item) => item.key !== template.key))}><Trash2 data-icon="inline-start" />Remove template</Button>
            </section>)}
            <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => edit("templates", [...draft.templates, { key: newKey("template"), name: "", issue_type: "bug", description: "", priority: "medium" }])}><Plus data-icon="inline-start" />Add issue template</Button>
          </TabsContent>
        </Tabs>
        <Button type="submit" className="self-start" disabled={disabled}>Save workflow and fields</Button>
      </form>
    </CardContent>
  </Card>;
}
