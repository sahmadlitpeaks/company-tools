import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  FileClock,
  FileDown,
  FileText,
  KeyRound,
  ListChecks,
  Lock,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import { useDeferredValue, useState, type FormEvent, type HTMLInputTypeAttribute, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import type {
  AccessGrant,
  AssignedAsset,
  Brand,
  HrDocument,
  Journey,
  JourneyDetail,
  JourneyTask,
  OnboardingTemplate,
  ProvisionSuggestion,
  ProvisionSuggestions,
  User,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";

const TASK_CATEGORIES = ["access", "accounts", "equipment", "hr", "other"] as const;
const TASK_STATUSES = ["pending", "done", "na"] as const;
const JOURNEY_LIMIT = 12;
const DOCUMENT_LIMIT = 8;

const CAT_BADGE: Record<string, "destructive" | "info" | "warning" | "success" | "secondary"> = {
  access: "destructive",
  accounts: "info",
  equipment: "warning",
  hr: "success",
  other: "secondary",
};

const STATUS_BADGE: Record<string, "warning" | "success" | "secondary"> = {
  in_progress: "warning",
  completed: "success",
  cancelled: "secondary",
};

type JourneyFilter = "active" | "onboarding" | "offboarding" | "completed";

function humanize(value?: string | null): string {
  if (!value) return "Not set";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function userLabel(user?: User | null): string {
  if (!user) return "Select employee";
  return user.display_name || user.email || user.personal_email || "Unnamed employee";
}

function userContext(user: User): string {
  return [user.job_title, user.department_name || user.department].filter(Boolean).join(" · ") || humanize(user.role);
}

function jInitials(name?: string | null): string {
  const source = (name || "?").trim();
  const parts = source.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
}

function journeyPercent(journey: Journey): number {
  return journey.total_tasks ? Math.round((journey.done_tasks / journey.total_tasks) * 100) : 0;
}

export default function PeopleOpsPage() {
  const { notify } = useToast();
  const journeys = useFetch<Journey[]>("/api/people/journeys");
  const expiring = useFetch<HrDocument[]>("/api/hr-documents/expiring?days=60");
  const [start, setStart] = useState<"onboarding" | "offboarding" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [filter, setFilter] = useState<JourneyFilter>("active");
  const [search, setSearch] = useState("");
  const [isReminding, setIsReminding] = useState(false);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const allJourneys = journeys.data ?? [];
  const activeCount = allJourneys.filter((journey) => journey.status === "in_progress").length;
  const onboardingCount = allJourneys.filter(
    (journey) => journey.kind === "onboarding" && journey.status === "in_progress",
  ).length;
  const offboardingCount = allJourneys.filter(
    (journey) => journey.kind === "offboarding" && journey.status === "in_progress",
  ).length;
  const completedCount = allJourneys.filter((journey) => journey.status === "completed").length;
  const filteredJourneys = [...allJourneys]
    .filter((journey) => {
      if (filter === "active" && journey.status !== "in_progress") return false;
      if (filter === "onboarding" && journey.kind !== "onboarding") return false;
      if (filter === "offboarding" && journey.kind !== "offboarding") return false;
      if (filter === "completed" && journey.status !== "completed") return false;
      if (!deferredSearch) return true;
      return [journey.target_name, journey.company_name]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(deferredSearch));
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const visibleJourneys = filteredJourneys.slice(0, JOURNEY_LIMIT);

  async function remindExpiring() {
    setIsReminding(true);
    try {
      const response = await api<{ reminders_sent: number }>(
        "/api/hr-documents/expiring/notify?days=60",
        { method: "POST" },
      );
      notify(`Sent ${response.reminders_sent} document reminder(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Document reminders failed", "error");
    } finally {
      setIsReminding(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        title="Onboarding & Offboarding"
        subtitle="Coordinate people, access, equipment, accounts, and HR through one accountable lifecycle record."
        action={
          <>
            <Button type="button" variant="outline" onClick={() => setManagingTemplates(true)}>
              <ClipboardList data-icon="inline-start" />
              Templates
            </Button>
            <Button type="button" variant="outline" onClick={() => setStart("offboarding")}>
              <UserMinus data-icon="inline-start" />
              Offboard
            </Button>
            <Button type="button" onClick={() => setStart("onboarding")}>
              <UserPlus data-icon="inline-start" />
              Onboard
            </Button>
          </>
        }
      />

      <div
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]"
        aria-busy={journeys.loading || undefined}
      >
        <JourneyStat icon={<ListChecks />} label="Active journeys" value={activeCount} />
        <JourneyStat icon={<UserPlus />} label="Onboarding now" value={onboardingCount} />
        <JourneyStat icon={<UserMinus />} label="Offboarding now" value={offboardingCount} />
        <JourneyStat icon={<CheckCircle2 />} label="Completed journeys" value={completedCount} />
      </div>

      <ExpiringDocumentsPanel
        documents={expiring.data ?? []}
        loading={expiring.loading}
        error={expiring.error}
        isReminding={isReminding}
        onRetry={expiring.reload}
        onRemind={remindExpiring}
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Employee journeys</CardTitle>
          <CardDescription>Prioritized by most recently started. Up to {JOURNEY_LIMIT} journeys are shown.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <ToggleGroup
              value={[filter]}
              onValueChange={(value) => value[0] && setFilter(value[0] as JourneyFilter)}
              variant="outline"
              spacing={0}
              className="max-w-full overflow-x-auto"
              aria-label="Filter employee journeys"
            >
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
              <ToggleGroupItem value="onboarding">Onboarding</ToggleGroupItem>
              <ToggleGroupItem value="offboarding">Offboarding</ToggleGroupItem>
              <ToggleGroupItem value="completed">Completed</ToggleGroupItem>
            </ToggleGroup>
            <InputGroup className="w-full lg:max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee or branch"
                aria-label="Search journeys by employee or branch"
              />
            </InputGroup>
          </div>

          {journeys.loading ? (
            <Loading />
          ) : journeys.error ? (
            <ErrorState message={journeys.error} onRetry={journeys.reload} />
          ) : allJourneys.length === 0 ? (
            <Empty
              icon={<ClipboardCheck />}
              message="No employee journeys yet"
              hint="Start an onboarding or offboarding journey to build the first lifecycle record."
              action={
                <Button type="button" onClick={() => setStart("onboarding")}>
                  <UserPlus data-icon="inline-start" />
                  Onboard an employee
                </Button>
              }
            />
          ) : filteredJourneys.length === 0 ? (
            <Empty
              icon={<Search />}
              message="No matching journeys"
              hint="Try another employee, branch, or lifecycle filter."
              action={
                <Button type="button" variant="outline" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
                {visibleJourneys.map((journey) => (
                  <JourneyCard key={journey.id} journey={journey} onOpen={() => setOpenId(journey.id)} />
                ))}
              </div>
              <p className="m-0 text-xs text-muted-foreground" aria-live="polite">
                Showing {visibleJourneys.length} of {filteredJourneys.length} matching journeys
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {start ? (
        <StartModal
          kind={start}
          onClose={() => setStart(null)}
          onSaved={() => {
            void journeys.reload();
            setStart(null);
          }}
        />
      ) : null}
      {openId ? <JourneyModal id={openId} onClose={() => setOpenId(null)} onChanged={journeys.reload} /> : null}
      {managingTemplates ? <TemplatesModal onClose={() => setManagingTemplates(false)} /> : null}
    </div>
  );
}

function JourneyStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center bg-primary/10 text-foreground [&_svg]:size-5">
          {icon}
        </span>
        <span className="min-w-0">
          <CardTitle className="text-xl font-semibold leading-none tabular-nums">{value}</CardTitle>
          <CardDescription className="mt-1 font-medium">{label}</CardDescription>
        </span>
      </CardHeader>
    </Card>
  );
}

function ExpiringDocumentsPanel({
  documents,
  loading,
  error,
  isReminding,
  onRetry,
  onRemind,
}: {
  documents: HrDocument[];
  loading: boolean;
  error: string | null;
  isReminding: boolean;
  onRetry: () => void;
  onRemind: () => void;
}) {
  const sortedDocuments = [...documents].sort(
    (a, b) => (a.days_to_expiry ?? Number.MAX_SAFE_INTEGER) - (b.days_to_expiry ?? Number.MAX_SAFE_INTEGER),
  );

  return (
    <Card>
      <CardHeader className="border-b">
        <span className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center bg-warning/15 text-foreground [&_svg]:size-4">
            <CalendarClock />
          </span>
          <span>
            <CardTitle>Documents expiring within 60 days</CardTitle>
            <CardDescription>
              {documents.length} {documents.length === 1 ? "record needs" : "records need"} HR review
            </CardDescription>
          </span>
        </span>
        {documents.length > 0 ? (
          <CardAction>
            <Button type="button" size="sm" variant="outline" onClick={onRemind} disabled={isReminding}>
              {isReminding ? <Spinner data-icon="inline-start" /> : <BellRing data-icon="inline-start" />}
              {isReminding ? "Sending reminders" : "Remind HR"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : sortedDocuments.length === 0 ? (
          <Empty
            icon={<ShieldCheck />}
            message="No documents are expiring soon"
            hint="Passport, permit, and HR document deadlines within 60 days will appear here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sortedDocuments.slice(0, DOCUMENT_LIMIT).map((document) => {
              const expired = document.days_to_expiry != null && document.days_to_expiry < 0;
              return (
                <Link
                  key={document.id}
                  to={`/people/${document.user_id}`}
                  className="grid gap-3 border border-border p-3 transition-colors hover:bg-muted sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                  aria-label={`Review ${document.title} for ${document.user_name || "employee"}`}
                >
                  <span className="grid size-9 place-items-center bg-muted text-foreground [&_svg]:size-4">
                    <FileClock />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{document.title}</span>
                      <Badge variant="secondary">{humanize(document.category)}</Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {document.user_name || "Unknown employee"}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
                    <span className="font-medium tabular-nums">{formatDate(document.expiry_date)}</span>
                    <Badge variant={expired ? "destructive" : "warning"}>
                      {expired
                        ? `${Math.abs(document.days_to_expiry ?? 0)} days overdue`
                        : `${document.days_to_expiry ?? 0} days left`}
                    </Badge>
                  </span>
                </Link>
              );
            })}
            {sortedDocuments.length > DOCUMENT_LIMIT ? (
              <p className="m-0 text-xs text-muted-foreground">
                Showing the {DOCUMENT_LIMIT} most urgent of {sortedDocuments.length} documents.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JourneyCard({ journey, onOpen }: { journey: Journey; onOpen: () => void }) {
  const percent = journeyPercent(journey);
  const openTasks = Math.max(0, journey.total_tasks - journey.done_tasks);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar className="size-11 shrink-0">
            <AvatarFallback className="bg-primary/10 text-foreground">{jInitials(journey.target_name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <CardTitle className="truncate">{journey.target_name || "Unnamed employee"}</CardTitle>
            <span className="mt-1 flex flex-wrap gap-1">
              <Badge variant={journey.kind === "onboarding" ? "success" : "warning"}>
                {humanize(journey.kind)}
              </Badge>
              <Badge variant={STATUS_BADGE[journey.status] ?? "secondary"}>{humanize(journey.status)}</Badge>
            </span>
          </span>
        </span>
        <CardAction>
          <span className="text-sm font-semibold tabular-nums">{percent}%</span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">{journey.company_name || "No branch assigned"}</span>
          </span>
          <span className="flex items-start gap-2">
            <CalendarClock className="size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <span>Started {formatDate(journey.created_at)}</span>
              {journey.completed_at ? <span>Completed {formatDate(journey.completed_at)}</span> : null}
            </span>
          </span>
        </div>
        {journey.note ? (
          <p className="m-0 line-clamp-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
            {journey.note}
          </p>
        ) : null}
        <Progress value={percent} aria-label={`Checklist progress for ${journey.target_name || "employee"}`}>
          <ProgressLabel>Checklist progress</ProgressLabel>
          <ProgressValue>{() => `${percent}%`}</ProgressValue>
        </Progress>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium tabular-nums">{journey.done_tasks} done</span>
          <span className="text-muted-foreground tabular-nums">{openTasks} open</span>
        </div>
      </CardContent>
      <CardFooter className="justify-end bg-muted/40">
        <Button type="button" onClick={onOpen}>
          View details
          <ArrowRight data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast();
  const templates = useFetch<OnboardingTemplate[]>("/api/people/templates?include_inactive=true");
  const [editing, setEditing] = useState<OnboardingTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OnboardingTemplate | null>(null);

  async function deleteTemplate(template: OnboardingTemplate) {
    try {
      await api(`/api/people/templates/${template.id}`, { method: "DELETE" });
      notify(`${template.name} deleted.`);
      await templates.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Template deletion failed", "error");
    }
  }

  if (editing || creating) {
    return (
      <TemplateEditor
        template={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={() => {
          setEditing(null);
          setCreating(false);
          void templates.reload();
        }}
      />
    );
  }

  return (
    <Modal
      title="Lifecycle templates"
      description="Build reusable, ordered checklist packets for onboarding and offboarding."
      onClose={onClose}
      maxWidth={720}
    >
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          New template
        </Button>
      </div>
      {templates.loading ? (
        <Loading />
      ) : templates.error ? (
        <ErrorState message={templates.error} onRetry={templates.reload} />
      ) : (templates.data?.length ?? 0) === 0 ? (
        <Empty
          icon={<ClipboardList />}
          message="No lifecycle templates"
          hint="Create a template to standardize the steps applied to future employee journeys."
          action={
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              Create template
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...(templates.data ?? [])]
            .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
            .map((template) => (
              <Card key={template.id} size="sm">
                <CardHeader>
                  <CardTitle className="truncate">{template.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {template.description || "No description provided."}
                  </CardDescription>
                  <CardAction>
                    <Badge variant={template.active ? "success" : "secondary"}>
                      {template.active ? "Active" : "Inactive"}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant={template.kind === "onboarding" ? "success" : "warning"}>
                    {humanize(template.kind)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {template.items.length} {template.items.length === 1 ? "step" : "steps"}
                  </span>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(template)}>
                    Edit template
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    aria-label={`Delete ${template.name} template`}
                    onClick={() => setDeleting(template)}
                  >
                    <Trash2 />
                  </Button>
                </CardFooter>
              </Card>
            ))}
        </div>
      )}
      {deleting ? (
        <ConfirmDialog
          title="Delete lifecycle template?"
          message={`Delete “${deleting.name}”? Existing journeys will not change, but this template cannot be used again.`}
          confirmLabel="Delete template"
          danger
          onConfirm={() => deleteTemplate(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Modal>
  );
}

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: OnboardingTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [kind, setKind] = useState(template?.kind ?? "onboarding");
  const [active, setActive] = useState(template?.active ?? true);
  const [items, setItems] = useState<{ id: string; title: string; category: string }[]>(() =>
    template?.items.length
      ? template.items.map((item) => ({
          id: item.id || crypto.randomUUID(),
          title: item.title,
          category: item.category,
        }))
      : [{ id: crypto.randomUUID(), title: "", category: "other" }],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = "lifecycle-template-form";

  function setItem(index: number, patch: Partial<{ title: string; category: string }>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const cleaned = items
      .filter((item) => item.title.trim())
      .map((item, index) => ({ title: item.title.trim(), category: item.category, sort: index }));
    if (!name.trim() || cleaned.length === 0) {
      setError("Add a template name and at least one checklist step.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      if (template) {
        await api(`/api/people/templates/${template.id}`, {
          method: "PATCH",
          body: { name: name.trim(), description: description.trim() || null, active, items: cleaned },
        });
      } else {
        await api("/api/people/templates", {
          method: "POST",
          body: { name: name.trim(), description: description.trim() || null, kind, items: cleaned },
        });
      }
      notify(template ? "Template updated." : "Template created.");
      onSaved();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Template could not be saved";
      setError(message);
      notify(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={template ? `Edit ${template.name}` : "New lifecycle template"}
      description="Define the ordered work packet applied when a journey starts."
      onClose={onClose}
      maxWidth={720}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : <ClipboardCheck data-icon="inline-start" />}
            {isSubmitting ? "Saving template" : "Save template"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} aria-busy={isSubmitting || undefined}>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Template needs attention</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldSet>
            <FieldLegend>Template details</FieldLegend>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field data-invalid={!name.trim() && Boolean(error)}>
                  <FieldLabel htmlFor="template-name">Template name</FieldLabel>
                  <Input
                    id="template-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="New starter essentials"
                    required
                    aria-invalid={!name.trim() && Boolean(error)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="template-kind">Journey kind</FieldLabel>
                  <Select
                    items={[
                      { value: "onboarding", label: "Onboarding" },
                      { value: "offboarding", label: "Offboarding" },
                    ]}
                    value={kind}
                    onValueChange={(value) => setKind(value ?? "onboarding")}
                    disabled={Boolean(template)}
                  >
                    <SelectTrigger id="template-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="onboarding">Onboarding</SelectItem>
                        <SelectItem value="offboarding">Offboarding</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="template-description">Description</FieldLabel>
                <Textarea
                  id="template-description"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="When this checklist should be used"
                />
              </Field>
              {template ? (
                <Field orientation="horizontal">
                  <Switch id="template-active" checked={active} onCheckedChange={setActive} />
                  <span>
                    <FieldLabel htmlFor="template-active">Template is active</FieldLabel>
                    <FieldDescription>Inactive templates remain in history but cannot be selected for new journeys.</FieldDescription>
                  </span>
                </Field>
              ) : null}
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Checklist steps</FieldLegend>
            <FieldDescription>Steps run in this order. Category controls how each task is classified.</FieldDescription>
            <FieldGroup>
              {items.map((item, index) => (
                <Card key={item.id} size="sm">
                  <CardHeader>
                    <CardTitle>Step {index + 1}</CardTitle>
                    <CardAction>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="destructive"
                        aria-label={`Remove template step ${index + 1}${item.title ? `: ${item.title}` : ""}`}
                        onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}
                      >
                        <Trash2 />
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                        <Field>
                          <FieldLabel htmlFor={`template-step-${item.id}`}>Step title</FieldLabel>
                          <Input
                            id={`template-step-${item.id}`}
                            value={item.title}
                            onChange={(event) => setItem(index, { title: event.target.value })}
                            placeholder="Prepare employee account"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`template-category-${item.id}`}>Category</FieldLabel>
                          <Select
                            items={TASK_CATEGORIES.map((category) => ({ value: category, label: humanize(category) }))}
                            value={item.category}
                            onValueChange={(value) => setItem(index, { category: value ?? "other" })}
                          >
                            <SelectTrigger id={`template-category-${item.id}`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {TASK_CATEGORIES.map((category) => (
                                  <SelectItem key={category} value={category}>
                                    {humanize(category)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    </FieldGroup>
                  </CardContent>
                </Card>
              ))}
              {items.length === 0 ? (
                <FieldError>Add at least one checklist step before saving.</FieldError>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setItems((current) => [...current, { id: crypto.randomUUID(), title: "", category: "other" }])
                }
              >
                <Plus data-icon="inline-start" />
                Add checklist step
              </Button>
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function StartModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: "onboarding" | "offboarding";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const users = useFetch<User[]>("/api/users");
  const brands = useFetch<Brand[]>("/api/companies");
  const templates = useFetch<OnboardingTemplate[]>(`/api/people/templates?kind=${kind}`);
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("existing");
  const [targetId, setTargetId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(kind === "onboarding");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employee, setEmployee] = useState({
    given_name: "",
    surname: "",
    personal_email: "",
    email: "",
    job_title: "",
    department: "",
    mobile_phone: "",
    passport_no: "",
    nationality: "",
  });
  const formId = `start-${kind}-form`;
  const isOnboarding = kind === "onboarding";
  const canCreateEmployee = isOnboarding && Boolean(user?.is_admin);
  const effectiveMode = isOnboarding ? mode : "existing";
  const selectableUsers = (users.data ?? []).filter((candidate) =>
    kind === "offboarding" ? candidate.is_active && candidate.status === "active" : true,
  );
  const selectedUser = (users.data ?? []).find((candidate) => candidate.id === targetId);
  const selectedBrand = (brands.data ?? []).find((brand) => brand.id === brandId);
  const selectedTemplate = (templates.data ?? []).find((template) => template.id === templateId);
  const selectedPerson =
    effectiveMode === "new"
      ? [employee.given_name.trim(), employee.surname.trim()].filter(Boolean).join(" ") || "New employee not named"
      : userLabel(selectedUser);

  function setEmployeeField(field: keyof typeof employee, value: string) {
    setEmployee((current) => ({ ...current, [field]: value }));
  }

  function validateNewEmployee(): string | null {
    const validEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    if (!employee.given_name.trim() || !employee.surname.trim()) return "First and last name are required.";
    if (!employee.personal_email.trim() && !employee.email.trim()) {
      return "A personal or official email is required.";
    }
    if (employee.personal_email.trim() && !validEmail(employee.personal_email.trim())) {
      return "Enter a valid personal email address.";
    }
    if (employee.email.trim() && !validEmail(employee.email.trim())) {
      return "Enter a valid official email address.";
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      let target = targetId;
      if (effectiveMode === "new") {
        if (!canCreateEmployee) throw new Error("Admin privileges are required to create an employee.");
        const validationError = validateNewEmployee();
        if (validationError) throw new Error(validationError);
        const created = await api<User>("/api/users", {
          method: "POST",
          body: {
            given_name: employee.given_name.trim(),
            surname: employee.surname.trim(),
            personal_email: employee.personal_email.trim() || null,
            email: employee.email.trim() || null,
            job_title: employee.job_title.trim() || null,
            department: employee.department.trim() || null,
            mobile_phone: employee.mobile_phone.trim() || null,
            passport_no: employee.passport_no.trim() || null,
            nationality: employee.nationality.trim() || null,
          },
        });
        target = created.id;
      }
      if (!target) throw new Error(`Select an ${kind === "offboarding" ? "active " : ""}employee.`);

      await api("/api/people/journeys", {
        method: "POST",
        body: {
          kind,
          target_user_id: target,
          company_id: brandId || null,
          note: note.trim() || null,
          announce,
          template_id: templateId || null,
        },
      });
      notify(`${isOnboarding ? "Onboarding" : "Offboarding"} started.`);
      onSaved();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `${humanize(kind)} could not be started`;
      setError(message);
      notify(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={isOnboarding ? "Start onboarding" : "Start offboarding"}
      description={
        isOnboarding
          ? "Create a coordinated employee arrival plan and assign the right checklist."
          : "Create a controlled departure record for an existing active employee."
      }
      onClose={onClose}
      maxWidth={760}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? (
              <Spinner data-icon="inline-start" />
            ) : isOnboarding ? (
              <UserPlus data-icon="inline-start" />
            ) : (
              <UserMinus data-icon="inline-start" />
            )}
            {isSubmitting ? `Starting ${kind}` : `Start ${kind}`}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} aria-busy={isSubmitting || undefined}>
        <FieldGroup>
          <Alert variant={isOnboarding ? "default" : "destructive"}>
            {isOnboarding ? <ShieldCheck /> : <ShieldAlert />}
            <AlertTitle>{isOnboarding ? "Prepare access before day one" : "Departure safety check"}</AlertTitle>
            <AlertDescription>
              {isOnboarding
                ? "The selected checklist can create tasks, notify owners, and optionally announce the new starter."
                : "Only active employees can be selected. Review access, equipment, and subscriptions before completing the journey."}
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Journey could not start</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FieldSet>
            <FieldLegend>Person</FieldLegend>
            <FieldGroup>
              {isOnboarding ? (
                <Field>
                  <FieldLabel>Employee source</FieldLabel>
                  <ToggleGroup
                    value={[effectiveMode]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (next === "existing" || (next === "new" && canCreateEmployee)) setMode(next);
                    }}
                    variant="outline"
                    spacing={0}
                    aria-label="Choose an existing employee or create a new employee"
                  >
                    <ToggleGroupItem value="existing">
                      <Users data-icon="inline-start" />
                      Existing
                    </ToggleGroupItem>
                    <ToggleGroupItem value="new" disabled={!canCreateEmployee}>
                      <UserPlus data-icon="inline-start" />
                      Create new
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {!canCreateEmployee ? (
                    <FieldDescription>Only administrators can create a new employee from onboarding.</FieldDescription>
                  ) : null}
                </Field>
              ) : null}

              {effectiveMode === "existing" ? (
                <Field data-invalid={Boolean(error) && !targetId}>
                  <FieldLabel htmlFor="journey-target">
                    {kind === "offboarding" ? "Active employee" : "Employee"}
                  </FieldLabel>
                  {users.loading ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner /> Loading employees
                    </span>
                  ) : users.error ? (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertTitle>Employees could not be loaded</AlertTitle>
                      <AlertDescription className="flex flex-wrap items-center gap-2">
                        {users.error}
                        <Button type="button" size="sm" variant="outline" onClick={users.reload}>
                          Retry employees
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : selectableUsers.length === 0 ? (
                    <Alert>
                      <Users />
                      <AlertTitle>No eligible employees</AlertTitle>
                      <AlertDescription>
                        {kind === "offboarding"
                          ? "There are no active employees available to offboard."
                          : "No employees are available. An administrator can use Create new instead."}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Select
                      items={[
                        { value: null, label: "Select employee" },
                        ...selectableUsers.map((candidate) => ({ value: candidate.id, label: userLabel(candidate) })),
                      ]}
                      value={targetId || null}
                      onValueChange={(value) => setTargetId(value ?? "")}
                    >
                      <SelectTrigger id="journey-target" className="w-full" aria-invalid={Boolean(error) && !targetId}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={null}>Select employee</SelectItem>
                          {selectableUsers.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              <span className="flex min-w-0 flex-col items-start">
                                <span className="font-medium">{userLabel(candidate)}</span>
                                <span className="text-muted-foreground">{userContext(candidate)}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                  <FieldDescription>
                    {kind === "offboarding"
                      ? "Inactive and departed employees are intentionally excluded."
                      : "Choose a person already present in the employee directory."}
                  </FieldDescription>
                </Field>
              ) : (
                <FieldGroup>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <JourneyInput
                      id="journey-first-name"
                      label="First name"
                      value={employee.given_name}
                      onChange={(value) => setEmployeeField("given_name", value)}
                      required
                    />
                    <JourneyInput
                      id="journey-last-name"
                      label="Last name"
                      value={employee.surname}
                      onChange={(value) => setEmployeeField("surname", value)}
                      required
                    />
                  </div>
                </FieldGroup>
              )}
            </FieldGroup>
          </FieldSet>

          {effectiveMode === "new" ? (
            <>
              <FieldSet>
                <FieldLegend>Role and contact</FieldLegend>
                <FieldGroup>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <JourneyInput
                      id="journey-personal-email"
                      label="Personal email"
                      type="email"
                      placeholder="name@example.com"
                      value={employee.personal_email}
                      onChange={(value) => setEmployeeField("personal_email", value)}
                      description="A personal or official email is required."
                    />
                    <JourneyInput
                      id="journey-official-email"
                      label="Official email"
                      type="email"
                      placeholder="Can be assigned later"
                      value={employee.email}
                      onChange={(value) => setEmployeeField("email", value)}
                    />
                    <JourneyInput
                      id="journey-title"
                      label="Job title"
                      value={employee.job_title}
                      onChange={(value) => setEmployeeField("job_title", value)}
                    />
                    <JourneyInput
                      id="journey-department"
                      label="Department"
                      value={employee.department}
                      onChange={(value) => setEmployeeField("department", value)}
                    />
                    <JourneyInput
                      id="journey-phone"
                      label="Mobile phone"
                      type="tel"
                      value={employee.mobile_phone}
                      onChange={(value) => setEmployeeField("mobile_phone", value)}
                    />
                  </div>
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>Sensitive HR details</FieldLegend>
                <Alert>
                  <Lock />
                  <AlertTitle>Restricted personal information</AlertTitle>
                  <AlertDescription>
                    Enter identity details only when HR has a legitimate operational need and an approved source.
                  </AlertDescription>
                </Alert>
                <FieldGroup>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <JourneyInput
                      id="journey-nationality"
                      label="Nationality"
                      value={employee.nationality}
                      onChange={(value) => setEmployeeField("nationality", value)}
                    />
                    <JourneyInput
                      id="journey-passport"
                      label="Passport or ID number"
                      value={employee.passport_no}
                      onChange={(value) => setEmployeeField("passport_no", value)}
                    />
                  </div>
                </FieldGroup>
              </FieldSet>
            </>
          ) : null}

          <FieldSet>
            <FieldLegend>Journey setup</FieldLegend>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="journey-company">Branch or sub-company</FieldLabel>
                  <Select
                    items={[
                      { value: null, label: "No branch assigned" },
                      ...(brands.data ?? []).map((brand) => ({ value: brand.id, label: brand.name })),
                    ]}
                    value={brandId || null}
                    onValueChange={(value) => setBrandId(value ?? "")}
                    disabled={brands.loading || Boolean(brands.error)}
                  >
                    <SelectTrigger id="journey-company" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={null}>No branch assigned</SelectItem>
                        {(brands.data ?? []).map((brand) => (
                          <SelectItem key={brand.id} value={brand.id}>
                            {brand.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {brands.error ? <FieldError>{brands.error}</FieldError> : null}
                </Field>

                <Field>
                  <FieldLabel htmlFor="journey-template">Checklist template</FieldLabel>
                  {templates.loading ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner /> Loading {kind} templates
                    </span>
                  ) : templates.error ? (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertTitle>Templates could not be loaded</AlertTitle>
                      <AlertDescription className="flex flex-wrap items-center gap-2">
                        {templates.error}
                        <Button type="button" size="sm" variant="outline" onClick={templates.reload}>
                          Retry templates
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <Select
                        items={[
                          { value: null, label: "Default checklist" },
                          ...(templates.data ?? []).map((template) => ({
                            value: template.id,
                            label: `${template.name} (${template.items.length} steps)`,
                          })),
                        ]}
                        value={templateId || null}
                        onValueChange={(value) => setTemplateId(value ?? "")}
                      >
                        <SelectTrigger id="journey-template" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={null}>Default checklist</SelectItem>
                            {(templates.data ?? []).map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {template.name} ({template.items.length} steps)
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {(templates.data?.length ?? 0) === 0 ? (
                        <FieldDescription>
                          No active {kind} templates are available. The built-in default checklist will be used.
                        </FieldDescription>
                      ) : null}
                    </>
                  )}
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="journey-note">Operational note</FieldLabel>
                <Textarea
                  id="journey-note"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    isOnboarding
                      ? "Start date, manager context, or special preparation"
                      : "Last working day, handover owner, or departure context"
                  }
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="journey-announce"
                  checked={announce}
                  onCheckedChange={(checked) => setAnnounce(Boolean(checked))}
                />
                <span>
                  <FieldLabel htmlFor="journey-announce">Post an announcement to everyone</FieldLabel>
                  <FieldDescription>
                    {isOnboarding
                      ? "Publishes a welcome announcement when the journey starts."
                      : "Publishes a farewell announcement when the journey starts."}
                  </FieldDescription>
                </span>
              </Field>
            </FieldGroup>
          </FieldSet>

          <Card size="sm" className="bg-muted/40">
            <CardHeader>
              <CardTitle>Journey summary</CardTitle>
              <CardDescription>Review the operational record before it is created.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <SummaryItem icon={<Users />} label="Person" value={selectedPerson} />
              <SummaryItem icon={<Building2 />} label="Company" value={selectedBrand?.name || "No branch assigned"} />
              <SummaryItem
                icon={<ClipboardList />}
                label="Template"
                value={selectedTemplate?.name || "Default checklist"}
              />
            </CardContent>
          </Card>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function JourneyInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  description,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  description?: string;
  required?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate font-medium" title={value}>
          {value}
        </span>
      </span>
    </span>
  );
}

type ConfirmAction =
  | { type: "task"; task: JourneyTask }
  | { type: "access" }
  | { type: "grant-revoke"; grant: AccessGrant }
  | { type: "grant-delete"; grant: AccessGrant }
  | { type: "asset"; asset: AssignedAsset }
  | { type: "seat"; seatId: string; name: string };

function JourneyModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<JourneyDetail>(`/api/people/journeys/${id}`);
  const users = useFetch<User[]>("/api/users");
  const assignable = useFetch<AssignedAsset[]>("/api/people/assignable-assets");
  const journey = detail.data;
  const suggestions = useFetch<ProvisionSuggestions>(
    journey?.kind === "onboarding" ? `/api/people/journeys/${id}/suggestions` : null,
  );
  const [newTask, setNewTask] = useState({ title: "", category: "other", owner_id: "" });
  const [assetPick, setAssetPick] = useState("");
  const [grant, setGrant] = useState({ name: "", system: "", username: "" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const percent = journey ? journeyPercent(journey) : 0;

  async function runAction(key: string, action: () => Promise<void>, success?: string) {
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
      if (success) notify(success);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The lifecycle action failed";
      setActionError(message);
      notify(message, "error");
      throw caught;
    } finally {
      setPendingAction(null);
    }
  }

  async function refreshDetail(changed = false) {
    await detail.reload();
    if (changed) onChanged();
  }

  async function provisionSubscription(suggestion: ProvisionSuggestion) {
    if (!suggestion.ref_id || !journey?.target_user_id) return;
    await runAction(`suggestion-sub-${suggestion.ref_id}`, async () => {
      await api(`/api/subscriptions/${suggestion.ref_id}/seats`, {
        method: "POST",
        body: { user_ids: [journey.target_user_id] },
      });
      await Promise.all([suggestions.reload(), refreshDetail(true)]);
    }, `${suggestion.label} seat assigned.`);
  }

  async function provisionAccess(suggestion: ProvisionSuggestion) {
    await runAction(`suggestion-access-${suggestion.label}`, async () => {
      await api(`/api/people/journeys/${id}/grants`, {
        method: "POST",
        body: { name: suggestion.label },
      });
      await Promise.all([suggestions.reload(), refreshDetail(true)]);
    }, `${suggestion.label} access recorded.`);
  }

  async function assignAsset() {
    if (!assetPick) return;
    await runAction("asset-assign", async () => {
      await api(`/api/people/journeys/${id}/assets`, { method: "POST", body: { asset_id: assetPick } });
      setAssetPick("");
      await Promise.all([refreshDetail(true), assignable.reload()]);
    }, "Equipment assigned.");
  }

  async function returnAsset(asset: AssignedAsset) {
    await runAction(`asset-return-${asset.id}`, async () => {
      await api(`/api/people/journeys/${id}/assets/${asset.id}/return`, { method: "POST" });
      await Promise.all([refreshDetail(), assignable.reload()]);
    }, `${asset.asset_tag} returned.`);
  }

  async function addGrant() {
    if (!grant.name.trim()) {
      setActionError("Enter an access name before adding a grant.");
      return;
    }
    await runAction("grant-add", async () => {
      await api(`/api/people/journeys/${id}/grants`, {
        method: "POST",
        body: {
          name: grant.name.trim(),
          system: grant.system.trim() || null,
          username: grant.username.trim() || null,
        },
      });
      setGrant({ name: "", system: "", username: "" });
      await refreshDetail();
    }, "Access grant added.");
  }

  async function revokeGrant(accessGrant: AccessGrant) {
    await runAction(`grant-revoke-${accessGrant.id}`, async () => {
      await api(`/api/people/grants/${accessGrant.id}/revoke`, { method: "POST" });
      await refreshDetail();
    }, `${accessGrant.name} access revoked.`);
  }

  async function deleteGrant(accessGrant: AccessGrant) {
    await runAction(`grant-delete-${accessGrant.id}`, async () => {
      await api(`/api/people/grants/${accessGrant.id}`, { method: "DELETE" });
      await refreshDetail();
    }, `${accessGrant.name} record deleted.`);
  }

  async function revokeSeat(seatId: string, name: string) {
    await runAction(`seat-revoke-${seatId}`, async () => {
      await api(`/api/subscriptions/seats/${seatId}/revoke`, { method: "POST" });
      await refreshDetail();
    }, `${name} seat revoked.`);
  }

  async function updateTask(task: JourneyTask, patch: { status?: string; owner_id?: string | null }) {
    await runAction(`task-${task.id}`, async () => {
      await api(`/api/people/tasks/${task.id}`, { method: "PATCH", body: patch });
      await refreshDetail(Boolean(patch.status));
    });
  }

  async function toggleTask(task: JourneyTask) {
    await updateTask(task, { status: task.status === "done" ? "pending" : "done" });
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!newTask.title.trim()) {
      setActionError("Enter a checklist task title.");
      return;
    }
    await runAction("task-add", async () => {
      await api(`/api/people/journeys/${id}/tasks`, {
        method: "POST",
        body: {
          title: newTask.title.trim(),
          category: newTask.category,
          owner_id: newTask.owner_id || null,
        },
      });
      setNewTask({ title: "", category: "other", owner_id: "" });
      await refreshDetail(true);
    }, "Checklist task added.");
  }

  async function removeTask(task: JourneyTask) {
    await runAction(`task-delete-${task.id}`, async () => {
      await api(`/api/people/tasks/${task.id}`, { method: "DELETE" });
      await refreshDetail(true);
    }, `${task.title} removed.`);
  }

  async function updateAccess(action: string) {
    await runAction(`access-${action}`, async () => {
      await api(`/api/people/journeys/${id}/access`, { method: "POST", body: { action } });
      await refreshDetail();
    }, "Employee access updated.");
  }

  async function syncAzure() {
    if (!journey?.target?.email) return;
    await runAction("azure", async () => {
      const response = await api<{ temp_password?: string }>(`/api/users/${journey.target!.id}/sync-azure`, {
        method: "POST",
      });
      notify(response.temp_password ? `Created in Azure. Temp password: ${response.temp_password}` : "Synced to Azure.");
      await refreshDetail();
    });
  }

  async function syncBamboo() {
    if (!journey?.target) return;
    await runAction("bamboo", async () => {
      await api(`/api/users/${journey.target!.id}/sync-bamboo`, { method: "POST" });
      await refreshDetail();
    }, "Pushed to BambooHR.");
  }

  function confirmationProps(action: ConfirmAction) {
    if (action.type === "task") {
      return {
        title: "Remove checklist task?",
        message: `Remove “${action.task.title}” from this journey? Linked work will also be removed.`,
        confirmLabel: "Remove task",
        onConfirm: () => removeTask(action.task),
      };
    }
    if (action.type === "access") {
      return {
        title: "Revoke all employee access?",
        message: "This clears the employee's effective permissions and disables their account.",
        confirmLabel: "Revoke all access",
        onConfirm: () => updateAccess("revoke_access"),
      };
    }
    if (action.type === "grant-revoke") {
      return {
        title: "Revoke recorded access?",
        message: `Mark “${action.grant.name}” as revoked for this employee?`,
        confirmLabel: "Revoke grant",
        onConfirm: () => revokeGrant(action.grant),
      };
    }
    if (action.type === "grant-delete") {
      return {
        title: "Delete access record?",
        message: `Permanently delete the recorded “${action.grant.name}” grant?`,
        confirmLabel: "Delete access record",
        onConfirm: () => deleteGrant(action.grant),
      };
    }
    if (action.type === "asset") {
      return {
        title: "Return assigned equipment?",
        message: `Mark ${action.asset.asset_tag} · ${action.asset.name} as returned and available?`,
        confirmLabel: "Return equipment",
        onConfirm: () => returnAsset(action.asset),
      };
    }
    return {
      title: "Revoke subscription seat?",
      message: `Revoke the personal ${action.name} seat from this employee?`,
      confirmLabel: "Revoke seat",
      onConfirm: () => revokeSeat(action.seatId, action.name),
    };
  }

  return (
    <Modal
      title={journey ? `${humanize(journey.kind)} · ${journey.target_name || "Employee"}` : "Employee journey"}
      description="Lifecycle checklist, access, equipment, and subscription operations."
      onClose={onClose}
      maxWidth={1180}
    >
      {detail.loading ? (
        <Loading />
      ) : detail.error || !journey ? (
        <ErrorState message={detail.error || "Journey details are unavailable."} onRetry={detail.reload} />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar className="size-12 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-foreground">{jInitials(journey.target_name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <CardTitle className="truncate text-base">{journey.target_name || "Unnamed employee"}</CardTitle>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={journey.kind === "onboarding" ? "success" : "warning"}>
                      {humanize(journey.kind)}
                    </Badge>
                    <Badge variant={STATUS_BADGE[journey.status] ?? "secondary"}>{humanize(journey.status)}</Badge>
                  </span>
                </span>
              </span>
              <CardAction>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadFile(`/api/people/journeys/${id}/report.pdf`, `${journey.kind}-record.pdf`)
                  }
                >
                  <FileDown data-icon="inline-start" />
                  PDF record
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryItem icon={<Building2 />} label="Company" value={journey.company_name || "No branch assigned"} />
                <SummaryItem icon={<CalendarClock />} label="Started" value={formatDateTime(journey.created_at)} />
                <SummaryItem
                  icon={<CheckCircle2 />}
                  label="Completed"
                  value={journey.completed_at ? formatDateTime(journey.completed_at) : "In progress"}
                />
                <SummaryItem
                  icon={<Users />}
                  label="Created by"
                  value={journey.created_by_name || "Unknown operator"}
                />
              </div>
              {journey.note ? (
                <Alert>
                  <FileText />
                  <AlertTitle>Journey note</AlertTitle>
                  <AlertDescription>{journey.note}</AlertDescription>
                </Alert>
              ) : null}
              <Progress value={percent} aria-label={`Journey progress for ${journey.target_name || "employee"}`}>
                <ProgressLabel>
                  {journey.done_tasks} of {journey.total_tasks} tasks completed
                </ProgressLabel>
                <ProgressValue>{() => `${percent}%`}</ProgressValue>
              </Progress>
            </CardContent>
          </Card>

          {actionError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Lifecycle action failed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="checklist">
            <TabsList className="max-w-full overflow-x-auto" aria-label="Journey detail sections">
              <TabsTrigger value="checklist">
                <ListChecks data-icon="inline-start" /> Checklist
              </TabsTrigger>
              <TabsTrigger value="access">
                <KeyRound data-icon="inline-start" /> Access
              </TabsTrigger>
              <TabsTrigger value="equipment">
                <Boxes data-icon="inline-start" /> Equipment
              </TabsTrigger>
              <TabsTrigger value="subscriptions">
                <WalletCards data-icon="inline-start" /> Subscriptions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="checklist">
              <ChecklistTab
                journey={journey}
                users={users.data ?? []}
                usersError={users.error}
                pendingAction={pendingAction}
                newTask={newTask}
                onNewTaskChange={setNewTask}
                onAddTask={addTask}
                onToggleTask={toggleTask}
                onUpdateTask={updateTask}
                onDeleteTask={(task) => setConfirmAction({ type: "task", task })}
              />
            </TabsContent>

            <TabsContent value="access">
              <AccessTab
                journey={journey}
                isAdmin={Boolean(user?.is_admin)}
                suggestions={suggestions}
                grant={grant}
                onGrantChange={setGrant}
                pendingAction={pendingAction}
                onAccess={updateAccess}
                onConfirmRevokeAccess={() => setConfirmAction({ type: "access" })}
                onSyncAzure={syncAzure}
                onSyncBamboo={syncBamboo}
                onAddGrant={addGrant}
                onConfirmRevokeGrant={(accessGrant) =>
                  setConfirmAction({ type: "grant-revoke", grant: accessGrant })
                }
                onConfirmDeleteGrant={(accessGrant) =>
                  setConfirmAction({ type: "grant-delete", grant: accessGrant })
                }
                onProvisionAccess={provisionAccess}
              />
            </TabsContent>

            <TabsContent value="equipment">
              <EquipmentTab
                journey={journey}
                assignable={assignable}
                assetPick={assetPick}
                onAssetPick={setAssetPick}
                pendingAction={pendingAction}
                onAssign={assignAsset}
                onConfirmReturn={(asset) => setConfirmAction({ type: "asset", asset })}
              />
            </TabsContent>

            <TabsContent value="subscriptions">
              <SubscriptionsTab
                journey={journey}
                suggestions={suggestions}
                pendingAction={pendingAction}
                onConfirmRevokeSeat={(seatId, name) => setConfirmAction({ type: "seat", seatId, name })}
                onProvisionSubscription={provisionSubscription}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {confirmAction ? (
        <ConfirmDialog
          {...confirmationProps(confirmAction)}
          danger
          onClose={() => setConfirmAction(null)}
        />
      ) : null}
    </Modal>
  );
}

function ChecklistTab({
  journey,
  users,
  usersError,
  pendingAction,
  newTask,
  onNewTaskChange,
  onAddTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
}: {
  journey: JourneyDetail;
  users: User[];
  usersError: string | null;
  pendingAction: string | null;
  newTask: { title: string; category: string; owner_id: string };
  onNewTaskChange: (value: { title: string; category: string; owner_id: string }) => void;
  onAddTask: (event: FormEvent) => void;
  onToggleTask: (task: JourneyTask) => void;
  onUpdateTask: (task: JourneyTask, patch: { status?: string; owner_id?: string | null }) => void;
  onDeleteTask: (task: JourneyTask) => void;
}) {
  const groupedTasks = TASK_CATEGORIES.map((category) => ({
    category,
    tasks: journey.tasks
      .filter(
        (task) =>
          task.category === category ||
          (category === "other" &&
            !TASK_CATEGORIES.includes(task.category as (typeof TASK_CATEGORIES)[number])),
      )
      .sort((a, b) => a.sort - b.sort),
  })).filter((group) => group.tasks.length > 0);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Journey checklist</CardTitle>
          <CardDescription>
            Use status for workflow state and the checkbox for a quick pending/done toggle. Not applicable tasks still count
            toward journey completion.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">
              {journey.done_tasks}/{journey.total_tasks} done
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {journey.tasks.length === 0 ? (
            <Empty
              icon={<ListChecks />}
              message="No checklist tasks"
              hint="Add the first task below to begin coordinating this journey."
            />
          ) : (
            groupedTasks.map((group) => (
              <section key={group.category} aria-labelledby={`task-group-${group.category}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 id={`task-group-${group.category}`} className="m-0 text-sm">
                    {humanize(group.category)}
                  </h4>
                  <Badge variant={CAT_BADGE[group.category] ?? "secondary"}>
                    {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {group.tasks.map((task) => {
                    const taskPending = pendingAction === `task-${task.id}`;
                    return (
                      <Card key={task.id} size="sm" className={cn(task.status === "done" && "bg-muted/40")}>
                        <CardContent className="flex min-w-0 flex-col gap-3">
                          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                            <Checkbox
                              checked={task.status === "done"}
                              onCheckedChange={() => void onToggleTask(task)}
                              disabled={taskPending}
                              aria-label={`Mark ${task.title} ${task.status === "done" ? "pending" : "done"}`}
                            />
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block break-words font-medium",
                                  task.status === "done" && "text-muted-foreground line-through",
                                )}
                              >
                                {task.title}
                              </span>
                              {task.done_at ? (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  Completed {formatDateTime(task.done_at)} by {task.done_by_name || "an operator"}
                                </span>
                              ) : task.status === "na" ? (
                                <span className="mt-1 block text-xs text-muted-foreground">Marked not applicable</span>
                              ) : (
                                <span className="mt-1 block text-xs text-muted-foreground">Awaiting completion</span>
                              )}
                            </span>
                          </div>
                          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(8rem,10rem)_minmax(10rem,1fr)_auto] sm:items-center sm:pl-7">
                            <Select
                              items={TASK_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
                              value={task.status}
                              onValueChange={(value) => value && void onUpdateTask(task, { status: value })}
                              disabled={taskPending}
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-full min-w-0"
                                aria-label={`Status for ${task.title}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="done">Done</SelectItem>
                                  <SelectItem value="na">Not applicable</SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <Select
                              items={[
                                { value: null, label: "Unassigned" },
                                ...users.map((owner) => ({ value: owner.id, label: userLabel(owner) })),
                              ]}
                              value={task.owner_id ?? null}
                              onValueChange={(value) => void onUpdateTask(task, { owner_id: value || null })}
                              disabled={taskPending || Boolean(usersError)}
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-full min-w-0"
                                aria-label={`Owner for ${task.title}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value={null}>Unassigned</SelectItem>
                                  {users.map((owner) => (
                                    <SelectItem key={owner.id} value={owner.id}>
                                      {userLabel(owner)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <span className="flex items-center justify-end gap-2">
                              {taskPending ? <Spinner /> : null}
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="destructive"
                                onClick={() => onDeleteTask(task)}
                                disabled={taskPending}
                                aria-label={`Remove checklist task: ${task.title}`}
                              >
                                <Trash2 />
                              </Button>
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add checklist task</CardTitle>
          <CardDescription>Create a journey task with its category and initial owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAddTask}>
            <FieldGroup>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem_13rem]">
                <Field>
                  <FieldLabel htmlFor="journey-new-task-title">Task title</FieldLabel>
                  <Input
                    id="journey-new-task-title"
                    value={newTask.title}
                    onChange={(event) => onNewTaskChange({ ...newTask, title: event.target.value })}
                    placeholder="Prepare security access"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="journey-new-task-category">Category</FieldLabel>
                  <Select
                    items={TASK_CATEGORIES.map((category) => ({ value: category, label: humanize(category) }))}
                    value={newTask.category}
                    onValueChange={(value) => onNewTaskChange({ ...newTask, category: value ?? "other" })}
                  >
                    <SelectTrigger id="journey-new-task-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {TASK_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {humanize(category)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="journey-new-task-owner">Owner</FieldLabel>
                  <Select
                    items={[
                      { value: null, label: "Unassigned" },
                      ...users.map((owner) => ({ value: owner.id, label: userLabel(owner) })),
                    ]}
                    value={newTask.owner_id || null}
                    onValueChange={(value) => onNewTaskChange({ ...newTask, owner_id: value ?? "" })}
                    disabled={Boolean(usersError)}
                  >
                    <SelectTrigger id="journey-new-task-owner" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={null}>Unassigned</SelectItem>
                        {users.map((owner) => (
                          <SelectItem key={owner.id} value={owner.id}>
                            {userLabel(owner)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {usersError ? <FieldError>Task owners could not be loaded: {usersError}</FieldError> : null}
              <Button type="submit" disabled={pendingAction === "task-add" || !newTask.title.trim()}>
                {pendingAction === "task-add" ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                {pendingAction === "task-add" ? "Adding task" : "Add task"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AccessTab({
  journey,
  isAdmin,
  suggestions,
  grant,
  onGrantChange,
  pendingAction,
  onAccess,
  onConfirmRevokeAccess,
  onSyncAzure,
  onSyncBamboo,
  onAddGrant,
  onConfirmRevokeGrant,
  onConfirmDeleteGrant,
  onProvisionAccess,
}: {
  journey: JourneyDetail;
  isAdmin: boolean;
  suggestions: ReturnType<typeof useFetch<ProvisionSuggestions>>;
  grant: { name: string; system: string; username: string };
  onGrantChange: (value: { name: string; system: string; username: string }) => void;
  pendingAction: string | null;
  onAccess: (action: string) => void;
  onConfirmRevokeAccess: () => void;
  onSyncAzure: () => void;
  onSyncBamboo: () => void;
  onAddGrant: () => void;
  onConfirmRevokeGrant: (grant: AccessGrant) => void;
  onConfirmDeleteGrant: (grant: AccessGrant) => void;
  onProvisionAccess: (suggestion: ProvisionSuggestion) => void;
}) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      {journey.target ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Employee account</CardTitle>
            <CardDescription>
              Role: {humanize(journey.target.role)} · {journey.target.effective_permissions.length} effective modules
            </CardDescription>
            <CardAction>
              <Badge variant={journey.target.status === "active" ? "success" : "destructive"}>
                {humanize(journey.target.status)}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1">
              {journey.target.effective_permissions.length ? (
                journey.target.effective_permissions.map((permission) => (
                  <Badge key={permission} variant="secondary">
                    {humanize(permission)}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No effective module permissions.</span>
              )}
            </div>
            {isAdmin ? (
              <div className="flex flex-wrap gap-2">
                {journey.target.status !== "active" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onAccess("activate")}
                    disabled={pendingAction === "access-activate"}
                  >
                    {pendingAction === "access-activate" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Check data-icon="inline-start" />
                    )}
                    Activate account
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onAccess("disable")}
                    disabled={pendingAction === "access-disable"}
                  >
                    {pendingAction === "access-disable" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Lock data-icon="inline-start" />
                    )}
                    Disable account
                  </Button>
                )}
                <Button type="button" size="sm" variant="destructive" onClick={onConfirmRevokeAccess}>
                  <UserMinus data-icon="inline-start" />
                  Revoke all access
                </Button>
              </div>
            ) : (
              <Alert>
                <ShieldCheck />
                <AlertTitle>Account controls require an administrator</AlertTitle>
                <AlertDescription>You can still record individual grants and complete journey tasks.</AlertDescription>
              </Alert>
            )}
          </CardContent>
          {isAdmin && journey.kind === "onboarding" ? (
            <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onSyncAzure()}
                disabled={!journey.target.email || pendingAction === "azure"}
                title={!journey.target.email ? "An official employee email is required before Azure sync." : undefined}
              >
                {pendingAction === "azure" ? <Spinner data-icon="inline-start" /> : <Cloud data-icon="inline-start" />}
                Sync to Azure
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onSyncBamboo()}
                disabled={pendingAction === "bamboo"}
              >
                {pendingAction === "bamboo" ? <Spinner data-icon="inline-start" /> : <Cloud data-icon="inline-start" />}
                Push to BambooHR
              </Button>
              {!journey.target.email ? (
                <span className="text-xs text-muted-foreground">
                  Azure sync is unavailable until an official employee email is assigned.
                </span>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      ) : (
        <Empty
          icon={<KeyRound />}
          message="No employee account is linked"
          hint="Account controls require a target employee on the journey."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recorded access grants</CardTitle>
          <CardDescription>Track system access, usernames, and revocation state for this employee.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {journey.access_grants.length === 0 ? (
            <Empty
              icon={<KeyRound />}
              message="No individual access recorded"
              hint="Add a grant below or provision one of the department suggestions."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {journey.access_grants.map((accessGrant) => (
                <Card key={accessGrant.id} size="sm">
                  <CardContent className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{accessGrant.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {[accessGrant.system, accessGrant.username].filter(Boolean).join(" · ") || "No system or username recorded"}
                      </span>
                    </span>
                    <Badge variant={accessGrant.status === "active" ? "success" : "secondary"}>
                      {humanize(accessGrant.status)}
                    </Badge>
                    <span className="flex flex-wrap justify-end gap-2 lg:shrink-0">
                      {accessGrant.status === "active" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => onConfirmRevokeGrant(accessGrant)}
                        >
                          <Lock data-icon="inline-start" />
                          Revoke grant
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => onConfirmDeleteGrant(accessGrant)}
                        aria-label={`Delete ${accessGrant.name} access record`}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <FieldGroup>
            <div className="grid gap-4 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="journey-grant-name">Access name</FieldLabel>
                <Input
                  id="journey-grant-name"
                  value={grant.name}
                  onChange={(event) => onGrantChange({ ...grant, name: event.target.value })}
                  placeholder="Google Workspace"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="journey-grant-system">System</FieldLabel>
                <Input
                  id="journey-grant-system"
                  value={grant.system}
                  onChange={(event) => onGrantChange({ ...grant, system: event.target.value })}
                  placeholder="Identity provider"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="journey-grant-username">Username</FieldLabel>
                <Input
                  id="journey-grant-username"
                  value={grant.username}
                  onChange={(event) => onGrantChange({ ...grant, username: event.target.value })}
                  placeholder="name@company.com"
                />
              </Field>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void onAddGrant()}
              disabled={pendingAction === "grant-add" || !grant.name.trim()}
            >
              {pendingAction === "grant-add" ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {pendingAction === "grant-add" ? "Adding access" : "Add access grant"}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      {journey.kind === "onboarding" ? (
        <SuggestionCard
          title={`Suggested access for ${suggestions.data?.department_name || "this department"}`}
          description="Common access held by department peers but not yet recorded for this employee."
          loading={suggestions.loading}
          error={suggestions.error}
          onRetry={suggestions.reload}
          suggestions={suggestions.data?.access ?? []}
          icon={<KeyRound />}
          emptyMessage="No additional access suggestions"
          pendingAction={pendingAction}
          pendingPrefix="suggestion-access-"
          actionLabel="Add access"
          onProvision={onProvisionAccess}
        />
      ) : null}
    </div>
  );
}

function EquipmentTab({
  journey,
  assignable,
  assetPick,
  onAssetPick,
  pendingAction,
  onAssign,
  onConfirmReturn,
}: {
  journey: JourneyDetail;
  assignable: ReturnType<typeof useFetch<AssignedAsset[]>>;
  assetPick: string;
  onAssetPick: (value: string) => void;
  pendingAction: string | null;
  onAssign: () => void;
  onConfirmReturn: (asset: AssignedAsset) => void;
}) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Card>
        <CardHeader>
          <CardTitle>Assigned equipment</CardTitle>
          <CardDescription>Assets linked through the central Asset Tracker.</CardDescription>
          <CardAction>
            <Badge variant="secondary">{journey.assigned_assets.length} assigned</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {journey.assigned_assets.length === 0 ? (
            <Empty
              icon={<PackageCheck />}
              message="No equipment assigned"
              hint="Assign an available asset below. Returned equipment will move back into the available pool."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {journey.assigned_assets.map((asset) => (
                <Card key={asset.id} size="sm">
                  <CardHeader>
                    <span className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center bg-muted text-foreground [&_svg]:size-4">
                        <Boxes />
                      </span>
                      <span className="min-w-0">
                        <CardTitle className="truncate">{asset.name}</CardTitle>
                        <CardDescription>{asset.asset_tag}</CardDescription>
                      </span>
                    </span>
                  </CardHeader>
                  <CardFooter className="justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={() => onConfirmReturn(asset)}>
                      <RotateCcw data-icon="inline-start" />
                      Return {asset.asset_tag}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign equipment</CardTitle>
          <CardDescription>Select an asset currently marked available.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignable.loading ? (
            <Loading />
          ) : assignable.error ? (
            <ErrorState message={assignable.error} onRetry={assignable.reload} />
          ) : (assignable.data?.length ?? 0) === 0 ? (
            <Empty
              icon={<Boxes />}
              message="No equipment is available"
              hint="Assets will appear here after they are marked available in Asset Tracker."
            />
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="journey-asset-pick">Available asset</FieldLabel>
                <Select
                  items={[
                    { value: null, label: "Select available equipment" },
                    ...(assignable.data ?? []).map((asset) => ({
                      value: asset.id,
                      label: `${asset.asset_tag} · ${asset.name}`,
                    })),
                  ]}
                  value={assetPick || null}
                  onValueChange={(value) => onAssetPick(value ?? "")}
                >
                  <SelectTrigger id="journey-asset-pick" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={null}>Select available equipment</SelectItem>
                      {(assignable.data ?? []).map((asset) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          {asset.asset_tag} · {asset.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button
                type="button"
                onClick={() => void onAssign()}
                disabled={!assetPick || pendingAction === "asset-assign"}
              >
                {pendingAction === "asset-assign" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Plus data-icon="inline-start" />
                )}
                {pendingAction === "asset-assign" ? "Assigning equipment" : "Assign equipment"}
              </Button>
            </FieldGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubscriptionsTab({
  journey,
  suggestions,
  pendingAction,
  onConfirmRevokeSeat,
  onProvisionSubscription,
}: {
  journey: JourneyDetail;
  suggestions: ReturnType<typeof useFetch<ProvisionSuggestions>>;
  pendingAction: string | null;
  onConfirmRevokeSeat: (seatId: string, name: string) => void;
  onProvisionSubscription: (suggestion: ProvisionSuggestion) => void;
}) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Card>
        <CardHeader>
          <CardTitle>Current subscriptions</CardTitle>
          <CardDescription>Personal seats can be revoked. Department and company coverage is shared.</CardDescription>
          <CardAction>
            <Badge variant="secondary">{journey.subscriptions.length} covered</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {journey.subscriptions.length === 0 ? (
            <Empty
              icon={<WalletCards />}
              message="No subscriptions found"
              hint="Personal seats and shared department or company coverage will appear here."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {journey.subscriptions.map((subscription) => (
                <Card key={`${subscription.subscription_id}-${subscription.source}`} size="sm">
                  <CardContent className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                    <span className="grid size-9 shrink-0 place-items-center bg-muted text-foreground [&_svg]:size-4">
                      <WalletCards />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{subscription.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {subscription.vendor || "Vendor not recorded"}
                      </span>
                    </span>
                    {subscription.source === "seat" ? (
                      <Badge variant={subscription.seat_status === "active" ? "success" : "destructive"}>
                        Personal seat · {humanize(subscription.seat_status)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Shared · {humanize(subscription.source)}</Badge>
                    )}
                    {subscription.source === "seat" && subscription.seat_status === "active" && subscription.seat_id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => onConfirmRevokeSeat(subscription.seat_id!, subscription.name)}
                      >
                        <Lock data-icon="inline-start" />
                        Revoke {subscription.name} seat
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {journey.kind === "onboarding" ? (
        <SuggestionCard
          title={`Suggested subscriptions for ${suggestions.data?.department_name || "this department"}`}
          description="Personal subscriptions commonly assigned to peers in the same department."
          loading={suggestions.loading}
          error={suggestions.error}
          onRetry={suggestions.reload}
          suggestions={suggestions.data?.subscriptions ?? []}
          icon={<WalletCards />}
          emptyMessage="No additional subscription suggestions"
          pendingAction={pendingAction}
          pendingPrefix="suggestion-sub-"
          actionLabel="Assign seat"
          onProvision={onProvisionSubscription}
        />
      ) : null}
    </div>
  );
}

function SuggestionCard({
  title,
  description,
  loading,
  error,
  onRetry,
  suggestions,
  icon,
  emptyMessage,
  pendingAction,
  pendingPrefix,
  actionLabel,
  onProvision,
}: {
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  suggestions: ProvisionSuggestion[];
  icon: ReactNode;
  emptyMessage: string;
  pendingAction: string | null;
  pendingPrefix: string;
  actionLabel: string;
  onProvision: (suggestion: ProvisionSuggestion) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : suggestions.length === 0 ? (
          <Empty icon={icon} message={emptyMessage} hint="Peer-based recommendations will appear when a common pattern is detected." />
        ) : (
          <div className="flex flex-col gap-2">
            {suggestions.map((suggestion) => {
              const key = suggestion.ref_id || suggestion.label;
              const isPending = pendingAction === `${pendingPrefix}${key}`;
              return (
                <Card key={key} size="sm">
                  <CardContent className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                    <span className="grid size-9 shrink-0 place-items-center bg-muted text-foreground [&_svg]:size-4">
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{suggestion.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {[suggestion.detail, `${suggestion.peer_count}/${suggestion.peer_total} peers`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void onProvision(suggestion)}
                      disabled={isPending || (pendingPrefix === "suggestion-sub-" && !suggestion.ref_id)}
                    >
                      {isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                      {isPending ? "Provisioning" : actionLabel}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
