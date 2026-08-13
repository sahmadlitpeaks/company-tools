import { useMemo, useState } from "react";
import {
  AlertCircle,
  Camera,
  ClipboardList,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type {
  ChecklistTemplate,
  ChecklistTemplateItem,
  Department,
  ResponseType,
  TrackedAsset,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmDialog,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSurface,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { numericInput } from "../utils/numbers";

const TEAMS = ["it", "facilities", "hr", "finance", "other"];
const SCHEDULES = ["daily", "weekdays", "weekly", "monthly"];
const RESPONSE_TYPES: { key: ResponseType; label: string }[] = [
  { key: "ok_issue", label: "OK / Issue" },
  { key: "done", label: "Tick when done" },
  { key: "text", label: "Text reading" },
  { key: "number", label: "Number reading" },
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

type DraftItem = Omit<ChecklistTemplateItem, "id" | "template_id"> & {
  draftId: string;
};

let nextDraftItemId = 0;

function createDraftItemId(): string {
  nextDraftItemId += 1;
  return `new-${nextDraftItemId}`;
}

function itemControlId(item: DraftItem, control: string): string {
  return `checklist-template-item-${item.draftId}-${control}`;
}

function scheduleLabel(t: ChecklistTemplate): string {
  if (t.schedule === "weekly") {
    const days = (t.days_of_week ?? [])
      .map((n) => WEEKDAYS.find((w) => w.n === n)?.label)
      .filter(Boolean)
      .join(", ");
    return `Weekly · ${days || "no day set"}`;
  }
  if (t.schedule === "monthly") return `Monthly · day ${t.day_of_month ?? 1}`;
  return t.schedule === "weekdays" ? "Weekdays" : "Daily";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ownerDetails(
  t: ChecklistTemplate,
): { name: string; kind: string; unrouted?: boolean } {
  if (t.assignee_name) return { name: t.assignee_name, kind: "Person" };
  if (t.assignee_department_name) {
    return { name: t.assignee_department_name, kind: "Department rota" };
  }
  // Predates the routing requirement: its runs are visible to managers only.
  return { name: "Unassigned", kind: "Only managers see its runs", unrouted: true };
}

function reviewerDetails(t: ChecklistTemplate): { name: string; required: boolean } {
  if (!t.requires_verification) return { name: "Not required", required: false };
  return { name: t.reviewer_name ?? "Any manager", required: true };
}

function TemplateMobileCard({
  template,
  onEdit,
  onDelete,
}: {
  template: ChecklistTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const owner = ownerDetails(template);
  const reviewer = reviewerDetails(template);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="pr-2">{template.name}</CardTitle>
        <CardDescription>
          {titleCase(template.team)} · {template.item_count} {template.item_count === 1 ? "check" : "checks"}
        </CardDescription>
        <CardAction>
          <Badge variant={template.active ? "success" : "secondary"}>
            {template.active ? "Active" : "Inactive"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">Schedule</dt>
            <dd className="text-sm">
              {scheduleLabel(template)}
              {template.due_time ? ` · ${template.due_time}` : ""}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">Next run</dt>
            <dd className="text-sm">{template.active ? template.next_run_date ?? "Not scheduled" : "Paused"}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">Owner</dt>
            <dd className="truncate text-sm" title={owner.name}>
              {owner.unrouted ? <Badge variant="warning">{owner.name}</Badge> : owner.name}
            </dd>
            <dd className="text-xs text-muted-foreground">{owner.kind}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">Verification</dt>
            <dd className="truncate text-sm" title={reviewer.name}>{reviewer.name}</dd>
            <dd className="text-xs text-muted-foreground">
              {reviewer.required ? "Sign-off required" : "No sign-off"}
            </dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Pencil data-icon="inline-start" /> Edit
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          aria-label={`Delete ${template.name}`}
          title="Delete checklist"
          onClick={onDelete}
        >
          <Trash2 data-icon="inline-start" />
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function ChecklistTemplatesPage() {
  const { notify } = useToast();
  const templates = useFetch<ChecklistTemplate[]>("/api/checklist-templates");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ChecklistTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    setSeeding(true);
    try {
      const made = await api<ChecklistTemplate[]>("/api/checklist-templates/samples", {
        method: "POST",
      });
      notify(
        made.length
          ? `Added ${made.length} starter checklist(s).`
          : "The starter checklists already exist.",
      );
      templates.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setSeeding(false);
    }
  }

  async function remove(t: ChecklistTemplate) {
    await api(`/api/checklist-templates/${t.id}`, { method: "DELETE" });
    notify("Checklist deleted.");
    setDeleting(null);
    templates.reload();
  }

  const list = templates.data ?? [];

  return (
    <div>
      <PageHead
        title="Checklists"
        subtitle="Define the rounds each team performs, how often, and who signs them off."
        action={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> New checklist
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Template library</CardTitle>
          <CardDescription>
            Reusable rounds with ownership, timing, evidence, and sign-off rules.
          </CardDescription>
          {!templates.loading && !templates.error && list.length > 0 ? (
            <CardAction>
              <Badge variant="outline">{list.length} {list.length === 1 ? "template" : "templates"}</Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {templates.loading ? (
            <Loading />
          ) : templates.error ? (
            <ErrorState message={templates.error} onRetry={templates.reload} />
          ) : list.length === 0 ? (
            <Empty
              icon={<ClipboardList />}
              message="No checklists yet"
              hint="Start from the sample rounds for IT, Facilities and the lab, then edit them to match your buildings."
              action={
                <Button type="button" onClick={seed} disabled={seeding}>
                  {seeding ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Sparkles data-icon="inline-start" />
                  )}
                  {seeding ? "Adding…" : "Add starter checklists"}
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:hidden">
                {list.map((template) => (
                  <TemplateMobileCard
                    key={template.id}
                    template={template}
                    onEdit={() => setEditingId(template.id)}
                    onDelete={() => setDeleting(template)}
                  />
                ))}
              </div>
              <TableSurface className="hidden lg:block">
                <Table className="min-w-4xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checklist</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Ownership</TableHead>
                      <TableHead>Verification</TableHead>
                      <TableHead>Next run</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((template) => {
                      const owner = ownerDetails(template);
                      const reviewer = reviewerDetails(template);
                      return (
                        <TableRow key={template.id}>
                          <TableCell className="min-w-56 whitespace-normal">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{template.name}</p>
                                <Badge variant={template.active ? "success" : "secondary"}>
                                  {template.active ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className="capitalize">{template.team}</Badge>
                                <p className="text-xs text-muted-foreground">
                                  {template.item_count} {template.item_count === 1 ? "check" : "checks"}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-40 whitespace-normal">
                            <p>{scheduleLabel(template)}</p>
                            <p className="text-xs text-muted-foreground">
                              {template.due_time ? `Due ${template.due_time}` : "No due time"}
                            </p>
                          </TableCell>
                          <TableCell className="min-w-48 whitespace-normal">
                            {owner.unrouted ? (
                              <Badge variant="warning">{owner.name}</Badge>
                            ) : (
                              <p className="font-medium">{owner.name}</p>
                            )}
                            <p className="text-xs text-muted-foreground">{owner.kind}</p>
                          </TableCell>
                          <TableCell className="min-w-44 whitespace-normal">
                            <p className="font-medium">{reviewer.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {reviewer.required ? "Sign-off required" : "No sign-off"}
                            </p>
                          </TableCell>
                          <TableCell>
                            {template.active ? template.next_run_date ?? "Not scheduled" : "Paused"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingId(template.id)}
                              >
                                <Pencil data-icon="inline-start" /> Edit
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon-sm"
                                aria-label={`Delete ${template.name}`}
                                title="Delete checklist"
                                onClick={() => setDeleting(template)}
                              >
                                <Trash2 data-icon="inline-start" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableSurface>
            </>
          )}
        </CardContent>
      </Card>

      {(creating || editingId) && (
        <TemplateEditor
          id={editingId}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onSaved={() => {
            templates.reload();
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete checklist"
          message={`Delete "${deleting.name}"? Rounds already generated from it are removed too.`}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}

type TemplateForm = {
  name: string;
  description: string;
  team: string;
  schedule: ChecklistTemplate["schedule"];
  days_of_week: number[];
  day_of_month: number;
  due_time: string;
  grace_minutes: number;
  active: boolean;
  requires_verification: boolean;
  assignee_id: string;
  assignee_department_id: string;
  reviewer_id: string;
};

type FetchResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type SelectOption = { value: string | null; label: string };

function initialForm(template: ChecklistTemplate | null): TemplateForm {
  return {
    name: template?.name ?? "",
    description: template?.description ?? "",
    team: template?.team ?? "it",
    schedule: template?.schedule ?? "daily",
    days_of_week: template?.days_of_week ?? [],
    day_of_month: template?.day_of_month ?? 1,
    due_time: template?.due_time ?? "09:00",
    grace_minutes: template?.grace_minutes ?? 60,
    active: template?.active ?? true,
    requires_verification: template?.requires_verification ?? true,
    assignee_id: template?.assignee_id ?? "",
    assignee_department_id: template?.assignee_department_id ?? "",
    reviewer_id: template?.reviewer_id ?? "",
  };
}

function initialItems(template: ChecklistTemplate | null): DraftItem[] {
  return (template?.items ?? []).map(({ id: draftId, template_id: _templateId, ...item }) => ({
    ...item,
    draftId,
  }));
}

function userOptions(
  data: User[] | null,
  currentId: string,
  emptyLabel: string,
): SelectOption[] {
  const options: SelectOption[] = [
    { value: null, label: emptyLabel },
    ...(data ?? []).map((user) => ({
      value: user.id,
      label: user.display_name || user.email || "Unnamed person",
    })),
  ];
  if (currentId && !data?.some((user) => user.id === currentId)) {
    options.push({ value: currentId, label: "Current person (details unavailable)" });
  }
  return options;
}

function departmentOptions(data: Department[] | null, currentId: string): SelectOption[] {
  const options: SelectOption[] = [
    { value: null, label: "None" },
    ...(data ?? []).map((department) => ({ value: department.id, label: department.name })),
  ];
  if (currentId && !data?.some((department) => department.id === currentId)) {
    options.push({ value: currentId, label: "Current department (details unavailable)" });
  }
  return options;
}

function assetOptions(data: TrackedAsset[] | null, currentId: string | null): SelectOption[] {
  const options: SelectOption[] = [
    { value: null, label: "No linked asset" },
    ...(data ?? []).map((asset) => ({
      value: asset.id,
      label: `${asset.name} (${asset.asset_tag})`,
    })),
  ];
  if (currentId && !data?.some((asset) => asset.id === currentId)) {
    options.push({ value: currentId, label: "Current asset (details unavailable)" });
  }
  return options;
}

function FetchErrorAlert({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

function TemplateEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = useFetch<ChecklistTemplate>(id ? `/api/checklist-templates/${id}` : null);
  const users = useFetch<User[]>("/api/users");
  const departments = useFetch<Department[]>("/api/departments");
  const assets = useFetch<TrackedAsset[]>("/api/asset-tracker");
  const title = id ? "Edit checklist" : "New checklist";

  if (id && existing.loading) {
    return (
      <Modal title={title} description="Loading template details." onClose={onClose} maxWidth={1080}>
        <Loading />
      </Modal>
    );
  }

  if (id && existing.error) {
    return (
      <Modal title={title} description="Template details are unavailable." onClose={onClose} maxWidth={1080}>
        <ErrorState message={existing.error} onRetry={existing.reload} />
      </Modal>
    );
  }

  if (id && !existing.data) {
    return (
      <Modal title={title} description="Template details are unavailable." onClose={onClose} maxWidth={1080}>
        <ErrorState message="Checklist details could not be loaded." onRetry={existing.reload} />
      </Modal>
    );
  }

  return (
    <TemplateEditorForm
      key={id ?? "new"}
      id={id}
      template={existing.data}
      users={users}
      departments={departments}
      assets={assets}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TemplateEditorForm({
  id,
  template,
  users,
  departments,
  assets,
  onClose,
  onSaved,
}: {
  id: string | null;
  template: ChecklistTemplate | null;
  users: FetchResource<User[]>;
  departments: FetchResource<Department[]>;
  assets: FetchResource<TrackedAsset[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(() => initialForm(template));
  const [items, setItems] = useState<DraftItem[]>(() => initialItems(template));
  const weeklyDaysMissing = form.schedule === "weekly" && form.days_of_week.length === 0;
  // Non-managers only see runs they own, review, or that belong to their
  // department. A round with neither is generated but reaches nobody.
  const routingMissing = !form.assignee_id && !form.assignee_department_id;
  const usersUnavailable = users.loading || Boolean(users.error && !users.data);
  const departmentsUnavailable = departments.loading || Boolean(departments.error && !departments.data);
  const assetsUnavailable = assets.loading || Boolean(assets.error && !assets.data);
  const personItems = userOptions(users.data, form.assignee_id, "Nobody (use a department rota)");
  const reviewerItems = userOptions(users.data, form.reviewer_id, "The assignee's manager");
  const departmentItems = departmentOptions(departments.data, form.assignee_department_id);

  const sections = useMemo(
    () => Array.from(new Set(items.map((item) => item.section).filter(Boolean))) as string[],
    [items],
  );

  function set<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addItem() {
    setItems((list) => [
      ...list,
      {
        draftId: createDraftItemId(),
        section: list[list.length - 1]?.section ?? "",
        title: "",
        sort: list.length,
        response_type: "ok_issue",
        photo_required: false,
        asset_id: null,
        auto_ticket_on_issue: true,
        ticket_priority: "normal",
      },
    ]);
  }

  function patchItem(index: number, patch: Partial<Omit<DraftItem, "draftId">>) {
    setItems((list) => list.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  }

  function removeItem(index: number) {
    setItems((list) => list
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, sort: itemIndex })));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    if (weeklyDaysMissing) {
      const message = "Choose at least one day for a weekly checklist.";
      setSaveError(message);
      notify(message, "error");
      return;
    }
    if (routingMissing) {
      const message =
        "Assign this round to a person or to a department rota — otherwise only managers can see the runs it generates.";
      setSaveError(message);
      notify(message, "error");
      return;
    }
    if (!items.length || items.some((item) => !item.title.trim())) {
      const message = items.length
        ? "Every check needs a title."
        : "Add at least one check before saving.";
      setSaveError(message);
      notify(message, "error");
      return;
    }

    setBusy(true);
    const body = {
      ...form,
      description: form.description || null,
      due_time: form.due_time || null,
      assignee_id: form.assignee_id || null,
      assignee_department_id: form.assignee_department_id || null,
      reviewer_id: form.reviewer_id || null,
      days_of_week: form.schedule === "weekly" ? form.days_of_week : null,
      day_of_month: form.schedule === "monthly" ? form.day_of_month : null,
      items: items.map((item, sort) => ({
        section: item.section || null,
        title: item.title,
        sort,
        response_type: item.response_type,
        photo_required: item.photo_required,
        asset_id: item.asset_id,
        auto_ticket_on_issue: item.auto_ticket_on_issue,
        ticket_priority: item.ticket_priority,
      })),
    };

    try {
      if (id) await api(`/api/checklist-templates/${id}`, { method: "PATCH", body });
      else await api("/api/checklist-templates", { method: "POST", body });
      notify(id ? "Checklist updated." : "Checklist created.");
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checklist could not be saved.";
      setSaveError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={id ? "Edit checklist" : "New checklist"}
      description="Set the cadence, ownership, sign-off, and evidence required for every round."
      onClose={onClose}
      maxWidth={1080}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="checklist-template-editor-form" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? "Saving…" : id ? "Save checklist" : "Create checklist"}
          </Button>
        </>
      }
    >
      <form
        id="checklist-template-editor-form"
        className="flex flex-col gap-5"
        onSubmit={save}
        aria-busy={busy || undefined}
      >
        {saveError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Checklist not saved</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}

        {users.error ? (
          <FetchErrorAlert title="People could not be loaded" error={users.error} onRetry={users.reload} />
        ) : null}
        {departments.error ? (
          <FetchErrorAlert
            title="Departments could not be loaded"
            error={departments.error}
            onRetry={departments.reload}
          />
        ) : null}
        {assets.error ? (
          <FetchErrorAlert title="Assets could not be loaded" error={assets.error} onRetry={assets.reload} />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Template details</CardTitle>
            <CardDescription>Name the round and route any generated tickets to the right team.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-3">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="checklist-template-name">Name *</FieldLabel>
                <Input
                  id="checklist-template-name"
                  required
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Morning IT Checks"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="checklist-template-team">Team</FieldLabel>
                <Select
                  items={TEAMS.map((team) => ({ value: team, label: titleCase(team) }))}
                  value={form.team}
                  onValueChange={(value) => set("team", value ?? "it")}
                >
                  <SelectTrigger id="checklist-template-team" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TEAMS.map((team) => (
                        <SelectItem key={team} value={team}>{titleCase(team)}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Used as the category for tickets raised from issues.</FieldDescription>
              </Field>
              <Field className="md:col-span-3">
                <FieldLabel htmlFor="checklist-template-description">Description</FieldLabel>
                <Textarea
                  id="checklist-template-description"
                  rows={3}
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="What this round covers and any context the assignee needs."
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Choose when rounds are generated and how long assignees have after the due time.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="checklist-template-schedule">Frequency</FieldLabel>
                <Select
                  items={SCHEDULES.map((schedule) => ({
                    value: schedule,
                    label: titleCase(schedule),
                  }))}
                  value={form.schedule}
                  onValueChange={(value) => set(
                    "schedule",
                    (value ?? "daily") as ChecklistTemplate["schedule"],
                  )}
                >
                  <SelectTrigger id="checklist-template-schedule" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SCHEDULES.map((schedule) => (
                        <SelectItem key={schedule} value={schedule}>{titleCase(schedule)}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {form.schedule === "monthly" ? (
                <Field>
                  <FieldLabel htmlFor="checklist-template-day-of-month">Day of month</FieldLabel>
                  <Input
                    id="checklist-template-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      day_of_month: numericInput(event.target.value, current.day_of_month),
                    }))}
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="checklist-template-due-time">Due by</FieldLabel>
                <Input
                  id="checklist-template-due-time"
                  type="time"
                  value={form.due_time}
                  onChange={(event) => set("due_time", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="checklist-template-grace-minutes">Grace period (minutes)</FieldLabel>
                <Input
                  id="checklist-template-grace-minutes"
                  type="number"
                  min={0}
                  value={form.grace_minutes}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    grace_minutes: numericInput(event.target.value, current.grace_minutes),
                  }))}
                />
              </Field>
              {form.schedule === "weekly" ? (
                <FieldSet
                  className="sm:col-span-2 lg:col-span-4"
                  data-invalid={weeklyDaysMissing || undefined}
                >
                  <FieldLegend variant="label">Run on</FieldLegend>
                  <ToggleGroup
                    multiple
                    variant="outline"
                    size="sm"
                    className="flex w-full flex-wrap justify-start"
                    value={form.days_of_week.map(String)}
                    onValueChange={(values) => set(
                      "days_of_week",
                      values.map(Number).sort((a, b) => a - b),
                    )}
                    aria-invalid={weeklyDaysMissing || undefined}
                    aria-label="Weekly run days"
                  >
                    {WEEKDAYS.map((weekday) => (
                      <ToggleGroupItem key={weekday.n} value={String(weekday.n)}>
                        {weekday.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {weeklyDaysMissing ? (
                    <FieldError>Choose at least one weekday.</FieldError>
                  ) : (
                    <FieldDescription>Use arrow keys to move between days and Space to toggle.</FieldDescription>
                  )}
                </FieldSet>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ownership and verification</CardTitle>
            <CardDescription>Assign a named owner or let a department rota claim each generated round.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {routingMissing ? (
              <Alert>
                <AlertTitle>This round would reach nobody</AlertTitle>
                <AlertDescription>
                  Pick a person or a department rota. People who aren't managers only
                  see rounds they own, review, or that belong to their department —
                  so an unassigned round generates every day and stays invisible to
                  the team meant to walk it.
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="grid gap-4 lg:grid-cols-3">
              <Field data-disabled={usersUnavailable || undefined}>
                <FieldLabel htmlFor="checklist-template-assignee">Assign to a person</FieldLabel>
                <Select
                  items={personItems}
                  value={form.assignee_id || null}
                  disabled={usersUnavailable}
                  onValueChange={(value) => set("assignee_id", value ?? "")}
                >
                  <SelectTrigger id="checklist-template-assignee" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {personItems.map((option) => (
                        <SelectItem key={option.value ?? "no-person"} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {users.loading ? "Loading people…" : "A named person takes direct ownership."}
                </FieldDescription>
              </Field>
              <Field data-disabled={departmentsUnavailable || undefined}>
                <FieldLabel htmlFor="checklist-template-assignee-department">
                  Or assign a department rota
                </FieldLabel>
                <Select
                  items={departmentItems}
                  value={form.assignee_department_id || null}
                  disabled={departmentsUnavailable}
                  onValueChange={(value) => set("assignee_department_id", value ?? "")}
                >
                  <SelectTrigger id="checklist-template-assignee-department" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {departmentItems.map((option) => (
                        <SelectItem key={option.value ?? "no-department"} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {departments.loading
                    ? "Loading departments…"
                    : "Anyone in the department can claim the round."}
                </FieldDescription>
              </Field>
              <Field data-disabled={!form.requires_verification || usersUnavailable || undefined}>
                <FieldLabel htmlFor="checklist-template-reviewer">Verified by</FieldLabel>
                <Select
                  items={reviewerItems}
                  value={form.reviewer_id || null}
                  disabled={!form.requires_verification || usersUnavailable}
                  onValueChange={(value) => set("reviewer_id", value ?? "")}
                >
                  <SelectTrigger id="checklist-template-reviewer" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {reviewerItems.map((option) => (
                        <SelectItem key={option.value ?? "default-reviewer"} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {form.requires_verification
                    ? "Defaults to the assignee's manager."
                    : "Enable verification to choose a reviewer."}
                </FieldDescription>
              </Field>
            </FieldGroup>

            <Separator />

            <FieldSet>
              <FieldLegend variant="label">Generation and sign-off</FieldLegend>
              <FieldGroup className="grid gap-3 md:grid-cols-2">
                <Field orientation="horizontal" className="items-start border p-3">
                  <Checkbox
                    id="checklist-template-requires-verification"
                    checked={form.requires_verification}
                    onCheckedChange={(checked) => set("requires_verification", checked)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="checklist-template-requires-verification">
                      Require manager verification
                    </FieldLabel>
                    <FieldDescription>
                      A reviewer must sign off the completed round.
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field orientation="horizontal" className="items-start border p-3">
                  <Checkbox
                    id="checklist-template-active"
                    checked={form.active}
                    onCheckedChange={(checked) => set("active", checked)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="checklist-template-active">Active</FieldLabel>
                    <FieldDescription>
                      Generate new rounds on this template's schedule.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>
            </FieldSet>
          </CardContent>
        </Card>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>Checklist items</CardTitle>
            <CardDescription>
              Group checks into sections, set the expected response, and automate evidence or follow-up.
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <Badge variant="outline">{items.length} {items.length === 1 ? "check" : "checks"}</Badge>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus data-icon="inline-start" /> Add check
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {sections.length > 0 ? (
              <datalist id="section-suggestions">
                {sections.map((section) => <option key={section} value={section} />)}
              </datalist>
            ) : null}

            {items.length === 0 ? (
              <Empty
                icon={<ClipboardList />}
                message="No checks in this template"
                hint="Add one checkpoint for every response the assignee must record. Sections can group checks by area or system."
                action={
                  <Button type="button" variant="outline" onClick={addItem}>
                    <Plus data-icon="inline-start" /> Add first check
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item, index) => {
                  const linkedAssetItems = assetOptions(assets.data, item.asset_id ?? null);
                  return (
                    <Card key={item.draftId} size="sm">
                      <CardHeader>
                        <CardTitle className="flex min-w-0 items-center gap-2">
                          <Badge variant="secondary">{index + 1}</Badge>
                          <p className="truncate">{item.title.trim() || "Untitled check"}</p>
                        </CardTitle>
                        <CardDescription className="truncate">
                          {item.section?.trim() || "No section"}
                        </CardDescription>
                        <CardAction>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            aria-label={`Remove check ${index + 1}`}
                            title="Remove check"
                            onClick={() => removeItem(index)}
                          >
                            <Trash2 data-icon="inline-start" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <FieldGroup className="grid gap-4 md:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor={itemControlId(item, "section")}>Section</FieldLabel>
                            <Input
                              id={itemControlId(item, "section")}
                              list="section-suggestions"
                              value={item.section ?? ""}
                              placeholder="HQ Building / Dr T's Office"
                              onChange={(event) => patchItem(index, { section: event.target.value })}
                            />
                            <FieldDescription>Reuse a section name to group related checks.</FieldDescription>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={itemControlId(item, "title")}>Check *</FieldLabel>
                            <Input
                              id={itemControlId(item, "title")}
                              required
                              value={item.title}
                              placeholder="Confirm the meeting-room TV is working"
                              onChange={(event) => patchItem(index, { title: event.target.value })}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={itemControlId(item, "response-type")}>Response type</FieldLabel>
                            <Select
                              items={RESPONSE_TYPES.map((response) => ({
                                value: response.key,
                                label: response.label,
                              }))}
                              value={item.response_type}
                              onValueChange={(value) => patchItem(index, {
                                response_type: value as ResponseType,
                              })}
                            >
                              <SelectTrigger id={itemControlId(item, "response-type")} className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {RESPONSE_TYPES.map((response) => (
                                    <SelectItem key={response.key} value={response.key}>
                                      {response.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field data-disabled={assetsUnavailable || undefined}>
                            <FieldLabel htmlFor={itemControlId(item, "asset")}>Linked asset</FieldLabel>
                            <Select
                              items={linkedAssetItems}
                              value={item.asset_id ?? null}
                              disabled={assetsUnavailable}
                              onValueChange={(value) => patchItem(index, { asset_id: value })}
                            >
                              <SelectTrigger id={itemControlId(item, "asset")} className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {linkedAssetItems.map((option) => (
                                    <SelectItem key={option.value ?? "no-asset"} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <FieldDescription>
                              {assets.loading
                                ? "Loading assets…"
                                : "Attach this response to a tracked asset."}
                            </FieldDescription>
                          </Field>
                        </FieldGroup>
                      </CardContent>
                      <CardFooter className="items-start">
                        <FieldSet className="w-full">
                          <FieldLegend variant="label">Evidence and issue handling</FieldLegend>
                          <FieldGroup className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                            <Field orientation="horizontal" className="items-start">
                              <Checkbox
                                id={itemControlId(item, "photo-required")}
                                checked={item.photo_required}
                                onCheckedChange={(checked) => patchItem(index, {
                                  photo_required: checked,
                                })}
                              />
                              <FieldContent>
                                <FieldLabel htmlFor={itemControlId(item, "photo-required")}>
                                  <Camera className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                  Photo required
                                </FieldLabel>
                                <FieldDescription>Require visual evidence for this response.</FieldDescription>
                              </FieldContent>
                            </Field>
                            <Field orientation="horizontal" className="items-start">
                              <Checkbox
                                id={itemControlId(item, "auto-ticket")}
                                checked={item.auto_ticket_on_issue}
                                onCheckedChange={(checked) => patchItem(index, {
                                  auto_ticket_on_issue: checked,
                                })}
                              />
                              <FieldContent>
                                <FieldLabel htmlFor={itemControlId(item, "auto-ticket")}>
                                  Raise ticket on Issue
                                </FieldLabel>
                                <FieldDescription>Create a service ticket automatically.</FieldDescription>
                              </FieldContent>
                            </Field>
                            {item.auto_ticket_on_issue ? (
                              <Field>
                                <FieldLabel htmlFor={itemControlId(item, "ticket-priority")}>
                                  Ticket priority
                                </FieldLabel>
                                <Select
                                  items={PRIORITIES.map((priority) => ({
                                    value: priority,
                                    label: titleCase(priority),
                                  }))}
                                  value={item.ticket_priority}
                                  onValueChange={(value) => patchItem(index, {
                                    ticket_priority: value ?? "normal",
                                  })}
                                >
                                  <SelectTrigger
                                    id={itemControlId(item, "ticket-priority")}
                                    className="w-full"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {PRIORITIES.map((priority) => (
                                        <SelectItem key={priority} value={priority}>
                                          {titleCase(priority)}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                            ) : null}
                          </FieldGroup>
                        </FieldSet>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </Modal>
  );
}
