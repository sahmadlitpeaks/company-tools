import { useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { WorkLog, WorkLogSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, MetricCard, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const KINDS = ["ticket", "task", "rnd", "support", "meeting", "admin", "other"];
const KIND_BADGE: Record<string, "info" | "success" | "warning" | "secondary"> = {
  ticket: "info", rnd: "success", support: "warning", meeting: "secondary",
  admin: "secondary", task: "info", other: "secondary",
};

export function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

export default function WorkLogPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const logs = useFetch<WorkLog[]>(`/api/worklogs?scope=${scope}`);
  const summary = useFetch<WorkLogSummary>(`/api/worklogs/summary?scope=${scope}`);
  const [adding, setAdding] = useState(false);
  const canTeam = user?.is_admin || user?.role === "manager";
  const { notify } = useToast();

  async function remove(l: WorkLog) {
    await api(`/api/worklogs/${l.id}`, { method: "DELETE" });
    notify("Entry deleted.");
    logs.reload();
    summary.reload();
  }

  return (
    <div>
      <PageHead
        title="Work Log"
        subtitle="Capture effort on tickets and tasks — and the R&D/ad-hoc work that usually goes unrecorded."
        action={
          <div className="flex flex-wrap gap-2">
            {canTeam && (
              <Button type="button" variant={scope === "team" ? "default" : "outline"}
                onClick={() => setScope((s) => (s === "team" ? "mine" : "team"))}
              >
                {scope === "team" ? "Team" : "My log"}
              </Button>
            )}
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" /> Log work
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard value={hm(summary.data?.total_minutes ?? 0)} label="Total logged" />
        <MetricCard value={summary.data?.entries ?? 0} label="Entries" />
        <MetricCard value={hm(summary.data?.by_kind?.rnd ?? 0)} label="R&D / dev" />
        <MetricCard value={hm(summary.data?.by_kind?.ticket ?? 0)} label="On tickets" />
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
        {logs.loading ? (
          <Loading />
        ) : (logs.data?.length ?? 0) === 0 ? (
          <Empty icon={<Clock />} message="Nothing logged yet" hint="Record what you worked on — it takes seconds." />
        ) : (
          <Table>
            <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                {scope === "team" && <TableHead>Who</TableHead>}
                <TableHead>Type</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {logs.data!.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{l.work_date}</TableCell>
                  {scope === "team" && <TableCell className="font-medium">{l.user_name}</TableCell>}
                  <TableCell><Badge variant={KIND_BADGE[l.kind] ?? "secondary"}>{l.kind}</Badge></TableCell>
                  <TableCell className="max-w-[32rem] whitespace-normal">
                    <span className="line-clamp-2">{l.description}</span>
                    {l.entity_label && (
                      <span className="text-xs text-muted-foreground"> · {l.entity_label}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{hm(l.minutes)}</TableCell>
                  <TableCell className="text-right">
                    {(l.user_id === user?.id || user?.is_admin) && (
                      <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => remove(l)}>
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

      {adding && (
        <LogModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            logs.reload();
            summary.reload();
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function LogModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    minutes: "30",
    description: "",
    kind: "rnd",
    work_date: new Date().toISOString().slice(0, 10),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/worklogs", {
        method: "POST",
        body: {
          minutes: Number(form.minutes) || 0,
          description: form.description,
          kind: form.kind,
          work_date: form.work_date || null,
        },
      });
      notify("Work logged.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Log work" onClose={onClose}>
      <form onSubmit={submit}>
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="worklog-description">What did you work on? *</FieldLabel>
          <Textarea id="worklog-description" required rows={3} placeholder="e.g. R&D on the new report engine" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="worklog-type">Type</FieldLabel>
            <Select items={KINDS.map((k) => ({ value: k, label: k }))} value={form.kind} onValueChange={(value) => set("kind", value ?? "")}>
              <SelectTrigger id="worklog-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="worklog-date">Date</FieldLabel>
            <Input id="worklog-date" type="date" value={form.work_date} onChange={(e) => set("work_date", e.target.value)} />
          </Field>
        </FieldGroup>
        <Field>
          <FieldLabel htmlFor="worklog-minutes"><Clock /> Minutes</FieldLabel>
          <Input id="worklog-minutes" type="number" min="0" value={form.minutes} onChange={(e) => set("minutes", e.target.value)} />
          <ToggleGroup value={[form.minutes]} onValueChange={(value) => value[0] && set("minutes", value[0])} variant="outline" size="sm">
            {[15, 30, 60, 120].map((m) => (
              <ToggleGroupItem key={m} value={String(m)}>
                {hm(m)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save entry"}
          </Button>
        </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}
