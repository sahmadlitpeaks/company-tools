import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field as FormField, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Eye, RefreshCw, Save, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api/client";
import type {
  IntakeFormDetail,
  IntakeFormField,
  IntakeTargets,
  MappingPreview,
  MappingRule,
  RemapResult,
} from "../api/types";
import {
  ConfirmDialog,
  Empty,
  ErrorState,
  Loading,
  PageHead,
  useToast,
} from "../components/ui";
import { useFetch } from "../hooks/useApi";

/** Sent as the target when a field should stay in the extras rather than
 *  become a column. Kept out of the columns, never out of the record. */
const KEEP = "extra";

const TARGET_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  subject: "Subject",
  message: "Message",
  page_url: "Page URL",
  type: "Submission type",
  extra: "Keep as extra field",
};

const TRANSFORM_LABELS: Record<string, string> = {
  trim: "Trim spaces",
  lower: "Lowercase",
  upper: "Uppercase",
  title: "Title Case",
  digits: "Digits only",
  strip_html: "Strip HTML",
  join_array: "Join list",
  first_line: "First line only",
  email_only: "Extract email",
};

const STATUS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  mapped: "success",
  auto: "warning",
  partial: "destructive",
  none: "secondary",
};

const STATUS_HINT: Record<string, string> = {
  mapped: "An administrator has confirmed this mapping.",
  auto: "Guessed automatically. Review it before relying on this form.",
  partial: "Some fields had to be recovered by guesswork — please check.",
  none: "Nothing is mapped yet. Values are recovered by shape only.",
};

const EMPTY_FIELDS: IntakeFormField[] = [];

/** One editable row of the mapping, keyed by the raw field name. */
type Draft = { target: string; transform: string[] };

function draftFromMapping(
  fields: IntakeFormField[],
  rules: MappingRule[] | undefined,
): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const field of fields) out[field.name] = { target: KEEP, transform: ["trim"] };
  for (const rule of rules ?? []) {
    for (const source of rule.sources) {
      out[source] = { target: rule.target, transform: rule.transform ?? [] };
    }
  }
  return out;
}

function mappingFromDraft(draft: Record<string, Draft>): { version: number; rules: MappingRule[]; extras: string } {
  const rules: MappingRule[] = [];
  for (const [source, value] of Object.entries(draft)) {
    if (!value.target || value.target === KEEP) continue;
    rules.push({
      sources: [source],
      target: value.target,
      combine: "first",
      join: " ",
      transform: value.transform,
    });
  }
  return { version: 1, rules, extras: "keep" };
}

export default function IntakeFormPage() {
  const { id = "" } = useParams();
  const { notify } = useToast();
  const form = useFetch<IntakeFormDetail>(id ? `/api/intake/forms/${id}` : null);
  const targets = useFetch<IntakeTargets>("/api/intake/targets");

  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<MappingPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmRemap, setConfirmRemap] = useState(false);
  const [remapConverted, setRemapConverted] = useState(false);

  const fields = form.data?.fields ?? EMPTY_FIELDS;

  useEffect(() => {
    if (form.data) setDraft(draftFromMapping(form.data.fields, form.data.mapping?.rules));
  }, [form.data]);

  const missing = useMemo(() => {
    const covered = new Set(
      Object.values(draft).map((d) => d.target).filter((t) => t && t !== KEEP),
    );
    return ["name", "email", "phone", "message"].filter((t) => !covered.has(t));
  }, [draft]);

  // Unmapped fields first — they are what the page is for.
  const ordered = useMemo(
    () =>
      [...fields].sort((a, b) => {
        const aMapped = (draft[a.name]?.target ?? KEEP) !== KEEP;
        const bMapped = (draft[b.name]?.target ?? KEEP) !== KEEP;
        if (aMapped !== bMapped) return aMapped ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [fields, draft],
  );

  function setTarget(name: string, target: string) {
    setDraft((prev) => ({ ...prev, [name]: { ...(prev[name] ?? { transform: ["trim"] }), target } }));
  }

  function setTransform(name: string, transform: string) {
    setDraft((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? { target: KEEP }), transform: transform ? [transform] : [] },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/api/intake/forms/${id}/mapping`, {
        method: "PUT",
        body: mappingFromDraft(draft),
      });
      notify("Mapping saved.");
      await form.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save the mapping.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      const result = await api<MappingPreview>(`/api/intake/forms/${id}/preview-mapping`, {
        method: "POST",
        body: { mapping: mappingFromDraft(draft), limit: 3 },
      });
      setPreview(result);
      if (result.items.length === 0) {
        notify("No submissions received yet, so there is nothing to preview.");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Preview failed.", "error");
    } finally {
      setPreviewing(false);
    }
  }

  async function autoMap() {
    try {
      const guessed = await api<IntakeFormDetail>(`/api/intake/forms/${id}/auto-map`);
      setDraft(draftFromMapping(fields, guessed.mapping?.rules));
      notify("Guessed a mapping. Review it, then save.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not guess a mapping.", "error");
    }
  }

  async function applyToPast() {
    const result = await api<RemapResult>(`/api/intake/forms/${id}/remap`, {
      method: "POST",
      body: { only_unconverted: !remapConverted, resync_leads: remapConverted, limit: 500 },
    });
    notify(
      result.updated
        ? `Updated ${result.updated} submission${result.updated === 1 ? "" : "s"}.`
        : "Every submission already matched this mapping.",
    );
    await form.reload();
  }

  if (form.loading && !form.data) return <div className="p-4"><Loading /></div>;
  if (form.error) return <ErrorState message={form.error} onRetry={() => void form.reload()} />;
  if (!form.data) return <Empty message="Form not found" />;

  const detail = form.data;

  return (
    <div>
      <PageHead
        title={detail.name}
        subtitle={`${detail.source_name ?? "Website"} · ${detail.form_key}`}
        action={
          <>
            <Button type="button" variant="ghost" render={<Link to="/inbox" />}>
              <ArrowLeft data-icon="inline-start" />
              Back to inbox
            </Button>
            <Button type="button" variant="outline" onClick={() => void autoMap()}>
              <Wand2 data-icon="inline-start" />
              Guess mapping
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runPreview()}
              disabled={previewing}
            >
              <Eye data-icon="inline-start" />
              Preview
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              <Save data-icon="inline-start" />
              {saving ? "Saving…" : "Save mapping"}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_BADGE[detail.mapping_status] ?? "secondary"}>
          {detail.mapping_status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {STATUS_HINT[detail.mapping_status]}
        </span>
      </div>

      {missing.length > 0 && (
        <Card className="mb-4 border-warning">
          <CardContent className="py-(--card-spacing) text-sm">
            <strong>No field maps to {missing.map((m) => TARGET_LABELS[m]).join(", ")}.</strong>{" "}
            Submissions will still be stored in full, and these values recovered by shape
            where possible — but mapping them explicitly is more reliable.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="py-0">
          <CardHeader className="py-(--card-spacing)">
            <CardTitle>Fields this form sends</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sample values are shown so you can tell what an opaque name like
              <code className="mx-1">tel-123</code> actually holds. Contact details are
              masked.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {ordered.length === 0 ? (
              <Empty
                message="No fields discovered yet"
                hint="Fields appear after the first submission, or as soon as the plugin pushes this form's schema."
              />
            ) : (
              <>
                {/* Mobile: one card per field. */}
                <div className="flex flex-col gap-3 p-4 md:hidden">
                  {ordered.map((field) => (
                    <div key={field.name} className="border border-border p-3">
                      <div className="mb-2 flex flex-wrap items-baseline gap-2">
                        <code className="text-sm font-medium">{field.name}</code>
                        {field.label && (
                          <span className="text-xs text-muted-foreground">{field.label}</span>
                        )}
                      </div>
                      {field.sample && (
                        <p className="mb-2 truncate text-xs text-muted-foreground">
                          e.g. {field.sample}
                        </p>
                      )}
                      <FieldGroup>
                        <FormField>
                          <FieldLabel htmlFor={`t-${field.name}`}>Maps to</FieldLabel>
                          <TargetSelect
                            id={`t-${field.name}`}
                            value={draft[field.name]?.target ?? KEEP}
                            options={targets.data?.targets ?? []}
                            onChange={(v) => setTarget(field.name, v)}
                          />
                        </FormField>
                        <FormField>
                          <FieldLabel htmlFor={`x-${field.name}`}>Clean up</FieldLabel>
                          <TransformSelect
                            id={`x-${field.name}`}
                            value={draft[field.name]?.transform?.[0] ?? ""}
                            options={targets.data?.transforms ?? []}
                            onChange={(v) => setTransform(field.name, v)}
                          />
                        </FormField>
                      </FieldGroup>
                    </div>
                  ))}
                </div>

                {/* Desktop: a table reads far faster for this. */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Form field</TableHead>
                        <TableHead>Sample value</TableHead>
                        <TableHead>Maps to</TableHead>
                        <TableHead>Clean up</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ordered.map((field) => (
                        <TableRow key={field.name}>
                          <TableCell>
                            <code className="text-sm">{field.name}</code>
                            <div className="text-xs text-muted-foreground">
                              {field.label ?? "No label"}
                              {field.type ? ` · ${field.type}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-muted-foreground">
                            {field.sample ?? "—"}
                          </TableCell>
                          <TableCell className="w-[200px]">
                            <TargetSelect
                              id={`t-${field.name}`}
                              value={draft[field.name]?.target ?? KEEP}
                              options={targets.data?.targets ?? []}
                              onChange={(v) => setTarget(field.name, v)}
                            />
                          </TableCell>
                          <TableCell className="w-[180px]">
                            <TransformSelect
                              id={`x-${field.name}`}
                              value={draft[field.name]?.transform?.[0] ?? ""}
                              options={targets.data?.transforms ?? []}
                              onChange={(v) => setTransform(field.name, v)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="py-0">
            <CardHeader className="py-(--card-spacing)">
              <CardTitle>Preview</CardTitle>
              <p className="text-sm text-muted-foreground">
                What the current mapping would produce from real submissions. Nothing is
                saved by previewing.
              </p>
            </CardHeader>
            <CardContent className="py-(--card-spacing)">
              {!preview ? (
                <p className="text-sm text-muted-foreground">
                  Press Preview to check the mapping against recent submissions.
                </p>
              ) : preview.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No submissions stored for this form yet.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Every previewed item is a distinct submission; the
                      id-less case is the single ad-hoc sample. */}
                  {preview.items.map((item) => (
                    <div key={item.submission_id ?? "sample"} className="border border-border p-3">
                      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                        {Object.entries(item.core)
                          .filter(([, value]) => value)
                          .map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="text-muted-foreground">{TARGET_LABELS[key] ?? key}</dt>
                              <dd className="m-0 truncate">{value}</dd>
                            </div>
                          ))}
                      </dl>
                      {Object.keys(item.extras).length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Kept as extras: {Object.keys(item.extras).join(", ")}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_BADGE[item.status] ?? "secondary"}>
                          {item.status}
                        </Badge>
                        <Badge
                          variant={
                            item.spam_score >= 60
                              ? "destructive"
                              : item.spam_score > 25
                                ? "warning"
                                : "success"
                          }
                        >
                          spam {item.spam_score}
                        </Badge>
                      </div>
                      {item.notes.length > 0 && (
                        <ul className="mt-2 mb-0 pl-4 text-xs text-muted-foreground">
                          {item.notes.map((note) => <li key={note}>{note}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="py-(--card-spacing)">
              <CardTitle>Apply to past submissions</CardTitle>
              <p className="text-sm text-muted-foreground">
                Every submission is stored exactly as it arrived, so a corrected mapping can
                be replayed over the ones already received.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-(--card-spacing)">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={remapConverted} onCheckedChange={setRemapConverted} />
                Also update leads already created from them
              </label>
              <Button type="button" variant="outline" onClick={() => setConfirmRemap(true)}>
                <RefreshCw data-icon="inline-start" />
                Re-apply mapping
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {confirmRemap && (
        <ConfirmDialog
          title="Re-apply this mapping?"
          message={
            remapConverted
              ? "Past submissions for this form will be re-read from their original payloads, and the contact details on any leads created from them will be refreshed. Status, owner and value are left untouched."
              : "Past submissions for this form will be re-read from their original payloads. Submissions already converted to a lead or candidate are skipped."
          }
          confirmLabel="Re-apply"
          onConfirm={applyToPast}
          onClose={() => setConfirmRemap(false)}
        />
      )}
    </div>
  );
}

function TargetSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options.map((t) => ({ value: t, label: TARGET_LABELS[t] ?? t }))}
      value={value}
      onValueChange={(next) => onChange((next as string) ?? KEEP)}
    >
      <SelectTrigger id={id} aria-label="Maps to" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((t) => (
            <SelectItem key={t} value={t}>{TARGET_LABELS[t] ?? t}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function TransformSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={[
        { value: null, label: "None" },
        ...options.map((t) => ({ value: t, label: TRANSFORM_LABELS[t] ?? t })),
      ]}
      value={value || null}
      onValueChange={(next) => onChange((next as string) ?? "")}
    >
      <SelectTrigger id={id} aria-label="Clean up" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={null}>None</SelectItem>
          {options.map((t) => (
            <SelectItem key={t} value={t}>{TRANSFORM_LABELS[t] ?? t}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
