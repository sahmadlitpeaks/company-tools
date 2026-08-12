import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field as FormField, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowLeft, Plus, ShieldBan, Signpost, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type {
  BlocklistEntry,
  IntakeSource,
  IntakeTargets,
  RoutingRule,
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

const KIND_LABEL: Record<string, string> = {
  page_url: "Page URL",
  form_key: "Form key",
  form_name: "Form name",
  field: "A form field",
  subject: "Subject",
  message: "Message",
  type: "Submission type",
};

const OP_LABEL: Record<string, string> = {
  equals: "is exactly",
  contains: "contains",
  starts_with: "starts with",
  regex: "matches pattern",
  exists: "has any value",
};

const DESTINATION_LABEL: Record<string, string> = {
  crm_lead: "Create a CRM lead",
  candidate: "Create a recruiting candidate",
  ticket: "Raise a ticket",
  inbox_only: "Leave in the inbox",
};

const BLOCK_KIND_LABEL: Record<string, string> = {
  ip: "IP address",
  cidr: "IP range",
  email: "Email address",
  domain: "Email domain",
  keyword: "Keyword",
  country: "Country",
  fingerprint: "Message fingerprint",
};

export default function IntakeRulesPage() {
  const [tab, setTab] = useState<"rules" | "blocklist">("rules");

  return (
    <div>
      <PageHead
        title="Routing & filtering"
        subtitle="Decide what an inbound submission is, where it goes, and what never gets through."
        action={
          <Button type="button" variant="ghost" render={<Link to="/inbox" />}>
            <ArrowLeft data-icon="inline-start" />
            Back to inbox
          </Button>
        }
      />

      <ToggleGroup
        value={[tab]}
        onValueChange={(value) => value[0] && setTab(value[0] as typeof tab)}
        variant="outline"
        spacing={0}
        className="mb-4"
      >
        <ToggleGroupItem value="rules">Routing rules</ToggleGroupItem>
        <ToggleGroupItem value="blocklist">Blocklist</ToggleGroupItem>
      </ToggleGroup>

      {tab === "rules" ? <RulesTab /> : <BlocklistTab />}
    </div>
  );
}

function RulesTab() {
  const { notify } = useToast();
  const rules = useFetch<RoutingRule[]>("/api/intake/routing-rules");
  const sources = useFetch<IntakeSource[]>("/api/intake/sources");
  const targets = useFetch<IntakeTargets>("/api/intake/targets");

  const [name, setName] = useState("");
  const [kind, setKind] = useState("page_url");
  const [field, setField] = useState("");
  const [op, setOp] = useState("contains");
  const [value, setValue] = useState("");
  const [destination, setDestination] = useState("candidate");
  const [type, setType] = useState("job_application");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [jobFromField, setJobFromField] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoutingRule | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/api/intake/routing-rules", {
        method: "POST",
        body: {
          name: name.trim() || "Untitled rule",
          source_id: sourceId,
          conditions: [{
            kind,
            op,
            value: op === "exists" ? null : value,
            field: kind === "field" ? field : null,
          }],
          outcome: {
            type,
            destination,
            job_from_field: jobFromField.trim() || null,
          },
        },
      });
      notify("Rule created.");
      setName("");
      setValue("");
      setField("");
      setJobFromField("");
      await rules.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create the rule.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: RoutingRule) {
    await api(`/api/intake/routing-rules/${rule.id}`, { method: "DELETE" });
    notify("Rule deleted.");
    await rules.reload();
  }

  async function toggle(rule: RoutingRule) {
    await api(`/api/intake/routing-rules/${rule.id}`, {
      method: "PATCH",
      body: { active: !rule.active },
    });
    await rules.reload();
  }

  if (rules.error) return <ErrorState message={rules.error} onRetry={() => void rules.reload()} />;

  const rows = rules.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a rule</CardTitle>
          <p className="text-sm text-muted-foreground">
            Rules run in priority order and the first match wins. This is how a careers
            form becomes an application instead of a sales lead — decided here, so nobody
            has to change anything on the website.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="flex flex-col gap-4">
            <FieldGroup>
              <FormField>
                <FieldLabel htmlFor="rule-name">Rule name</FieldLabel>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Careers pages are job applications"
                />
              </FormField>
            </FieldGroup>

            <div className="grid gap-4 sm:grid-cols-4">
              <FormField>
                <FieldLabel htmlFor="rule-kind">When</FieldLabel>
                <Picker
                  id="rule-kind"
                  label="When"
                  value={kind}
                  options={(targets.data?.condition_kinds ?? []).map((k) => ({
                    value: k, label: KIND_LABEL[k] ?? k,
                  }))}
                  onChange={setKind}
                />
              </FormField>
              {kind === "field" && (
                <FormField>
                  <FieldLabel htmlFor="rule-field">Field name</FieldLabel>
                  <Input
                    id="rule-field"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    placeholder="enquiry-type"
                  />
                </FormField>
              )}
              <FormField>
                <FieldLabel htmlFor="rule-op">Condition</FieldLabel>
                <Picker
                  id="rule-op"
                  label="Condition"
                  value={op}
                  options={(targets.data?.condition_ops ?? []).map((o) => ({
                    value: o, label: OP_LABEL[o] ?? o,
                  }))}
                  onChange={setOp}
                />
              </FormField>
              {op !== "exists" && (
                <FormField>
                  <FieldLabel htmlFor="rule-value">Value</FieldLabel>
                  <Input
                    id="rule-value"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="/careers"
                  />
                </FormField>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <FormField>
                <FieldLabel htmlFor="rule-dest">Then</FieldLabel>
                <Picker
                  id="rule-dest"
                  label="Then"
                  value={destination}
                  options={(targets.data?.destinations ?? []).map((d) => ({
                    value: d, label: DESTINATION_LABEL[d] ?? d,
                  }))}
                  onChange={setDestination}
                />
              </FormField>
              <FormField>
                <FieldLabel htmlFor="rule-type">Classify as</FieldLabel>
                <Picker
                  id="rule-type"
                  label="Classify as"
                  value={type}
                  options={(targets.data?.types ?? []).map((t) => ({
                    value: t, label: t.replace("_", " "),
                  }))}
                  onChange={setType}
                />
              </FormField>
              <FormField>
                <FieldLabel htmlFor="rule-source">Only for</FieldLabel>
                <Picker
                  id="rule-source"
                  label="Only for"
                  value={sourceId}
                  options={[
                    { value: null, label: "Every website" },
                    ...(sources.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  onChange={setSourceId}
                />
              </FormField>
              {destination === "candidate" && (
                <FormField>
                  <FieldLabel htmlFor="rule-job-field">Role from field</FieldLabel>
                  <Input
                    id="rule-job-field"
                    value={jobFromField}
                    onChange={(e) => setJobFromField(e.target.value)}
                    placeholder="position"
                  />
                </FormField>
              )}
            </div>

            <div>
              <Button type="submit" disabled={saving}>
                <Plus data-icon="inline-start" />
                {saving ? "Adding…" : "Add rule"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="py-(--card-spacing)">
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent className={rows.length > 0 ? "p-0" : undefined}>
          {rules.loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty
              icon={<Signpost />}
              message="No routing rules yet"
              hint="Without rules, every submission follows its form's own destination."
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 p-4 md:hidden">
                {rows.map((rule) => (
                  <div key={rule.id} className="border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{rule.name}</span>
                      <Badge variant={rule.active ? "success" : "secondary"}>
                        {rule.active ? "active" : "off"}
                      </Badge>
                    </div>
                    <p className="mt-1 mb-0 text-xs text-muted-foreground">
                      {describe(rule)}
                    </p>
                    <div className="mt-2 flex gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => void toggle(rule)}>
                        {rule.active ? "Disable" : "Enable"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(rule)}>
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priority</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Behaviour</TableHead>
                      <TableHead className="text-right">Matched</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="tabular-nums">{rule.priority}</TableCell>
                        <TableCell>
                          <div className="font-medium">{rule.name}</div>
                          {!rule.active && <Badge variant="secondary">off</Badge>}
                        </TableCell>
                        <TableCell className="max-w-[420px] text-muted-foreground">
                          {describe(rule)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {rule.match_count}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="outline" onClick={() => void toggle(rule)}>
                              {rule.active ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`Delete ${rule.name}`}
                              onClick={() => setConfirmDelete(rule)}
                            >
                              <Trash2 />
                            </Button>
                          </span>
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this rule?"
          message={`"${confirmDelete.name}" will stop classifying submissions. Records already created are unaffected.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function describe(rule: RoutingRule): string {
  const conditions = rule.conditions
    .map((c) => {
      const subject = c.kind === "field" ? `field "${c.field}"` : KIND_LABEL[c.kind] ?? c.kind;
      const operator = OP_LABEL[c.op] ?? c.op;
      return c.op === "exists" ? `${subject} ${operator}` : `${subject} ${operator} "${c.value}"`;
    })
    .join(" and ");
  const outcome = rule.outcome ?? {};
  const parts = [
    outcome.destination ? DESTINATION_LABEL[outcome.destination] ?? outcome.destination : null,
    outcome.type ? `as ${outcome.type.replace("_", " ")}` : null,
  ].filter(Boolean);
  return `When ${conditions} → ${parts.join(" ") || "no change"}`;
}

function BlocklistTab() {
  const { notify } = useToast();
  const entries = useFetch<BlocklistEntry[]>("/api/intake/blocklist");
  const targets = useFetch<IntakeTargets>("/api/intake/targets");

  const [kind, setKind] = useState("email");
  const [value, setValue] = useState("");
  const [action, setAction] = useState("block");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BlocklistEntry | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/api/intake/blocklist", {
        method: "POST",
        body: { kind, value: value.trim(), action, reason: reason.trim() || null },
      });
      notify("Entry added.");
      setValue("");
      setReason("");
      await entries.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add the entry.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: BlocklistEntry) {
    await api(`/api/intake/blocklist/${entry.id}`, { method: "DELETE" });
    notify("Entry removed.");
    await entries.reload();
  }

  if (entries.error) {
    return <ErrorState message={entries.error} onRetry={() => void entries.reload()} />;
  }

  const rows = entries.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add an entry</CardTitle>
          <p className="text-sm text-muted-foreground">
            Blocked submissions are refused outright and never stored — the only point in
            the pipeline where anything is discarded. An <strong>allow</strong> entry
            always wins, so a known customer can be exempted from a broader block.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid items-end gap-4 sm:grid-cols-[minmax(9rem,1fr)_minmax(0,2fr)_minmax(8rem,1fr)_minmax(0,2fr)_auto]">
            <FormField>
              <FieldLabel htmlFor="bl-kind">Match on</FieldLabel>
              <Picker
                id="bl-kind"
                label="Match on"
                value={kind}
                options={(targets.data?.blocklist_kinds ?? []).map((k) => ({
                  value: k, label: BLOCK_KIND_LABEL[k] ?? k,
                }))}
                onChange={setKind}
              />
            </FormField>
            <FormField>
              <FieldLabel htmlFor="bl-value">Value</FieldLabel>
              <Input
                id="bl-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="spam.example"
              />
            </FormField>
            <FormField>
              <FieldLabel htmlFor="bl-action">Action</FieldLabel>
              <Picker
                id="bl-action"
                label="Action"
                value={action}
                options={(targets.data?.blocklist_actions ?? []).map((a) => ({
                  value: a, label: a,
                }))}
                onChange={setAction}
              />
            </FormField>
            <FormField>
              <FieldLabel htmlFor="bl-reason">Reason</FieldLabel>
              <Input
                id="bl-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Persistent link spam"
              />
            </FormField>
            <Button type="submit" disabled={saving || !value.trim()}>
              <Plus data-icon="inline-start" />
              {saving ? "Adding…" : "Add"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="py-(--card-spacing)">
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent className={rows.length > 0 ? "p-0" : undefined}>
          {entries.loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty
              icon={<ShieldBan />}
              message="Nothing is blocked"
              hint="Everything else is screened by score, and held for review rather than refused."
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 p-4 md:hidden">
                {rows.map((entry) => (
                  <div key={entry.id} className="border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <code className="text-sm">{entry.value}</code>
                      <Badge variant={entry.action === "allow" ? "success" : "destructive"}>
                        {entry.action}
                      </Badge>
                    </div>
                    <p className="mt-1 mb-0 text-xs text-muted-foreground">
                      {BLOCK_KIND_LABEL[entry.kind] ?? entry.kind} · {entry.hit_count} hits
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setConfirmDelete(entry)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match on</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Hits</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground">
                          {BLOCK_KIND_LABEL[entry.kind] ?? entry.kind}
                        </TableCell>
                        <TableCell><code className="text-sm">{entry.value}</code></TableCell>
                        <TableCell>
                          <Badge variant={entry.action === "allow" ? "success" : "destructive"}>
                            {entry.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.reason ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{entry.hit_count}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Remove ${entry.value}`}
                            onClick={() => setConfirmDelete(entry)}
                          >
                            <Trash2 />
                          </Button>
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

      {confirmDelete && (
        <ConfirmDialog
          title="Remove this entry?"
          message={`Submissions matching "${confirmDelete.value}" will be screened normally again.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function Picker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  options: { value: string | null; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => onChange((next as string) ?? "")}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value ?? "none"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
