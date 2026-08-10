import { useState } from "react";
import {
  Briefcase, CalendarPlus, ChevronLeft, ChevronRight, FileUp, Plus,
  Star, Target, Trash2, UserCheck, Users,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  Candidate, CandidateDetail, Department, JobOpening, OnboardingTemplate, User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STAGES = ["applied", "screen", "interview", "offer", "hired", "rejected"];
const STAGE_LABEL: Record<string, string> = {
  applied: "Applied", screen: "Screening", interview: "Interview",
  offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const JOB_BADGE: Record<string, "success" | "secondary" | "warning" | "destructive" | "info"> = {
  open: "success", draft: "secondary", on_hold: "warning", closed: "destructive", filled: "info",
};
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

export default function RecruitingPage() {
  const jobs = useFetch<JobOpening[]>("/api/recruiting/jobs");
  const [openJob, setOpenJob] = useState<JobOpening | null>(null);
  const [adding, setAdding] = useState(false);

  if (openJob) {
    return <JobBoard job={openJob} onBack={() => { setOpenJob(null); jobs.reload(); }} />;
  }

  return (
    <div>
      <PageHead
        title="Recruiting"
        subtitle="Job openings, candidate pipeline, interviews and offers."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> New job
          </Button>
        }
      />
      {jobs.loading ? (
        <Loading />
      ) : (jobs.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<Briefcase />} message="No job openings yet" hint="Create a job to start receiving candidates." /></CardContent></Card>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            <RecruitStat icon={<Briefcase size={18} />} label="Open roles" value={jobs.data!.filter((j) => j.status === "open").length} />
            <RecruitStat icon={<Users size={18} />} label="Candidates" value={jobs.data!.reduce((s, j) => s + j.candidate_count, 0)} />
            <RecruitStat icon={<UserCheck size={18} />} label="Hired" value={jobs.data!.reduce((s, j) => s + j.hired_count, 0)} />
            <RecruitStat
              icon={<Target size={18} />}
              label="Positions to fill"
              value={jobs.data!.reduce((s, j) => s + Math.max(0, j.openings - j.hired_count), 0)}
            />
          </div>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {jobs.data!.map((j) => {
              const pct = j.openings ? Math.min(100, Math.round((j.hired_count / j.openings) * 100)) : 0;
              return (
                <Card
                  key={j.id}
                >
                  <CardHeader className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                    <span className="grid size-10 flex-none place-items-center bg-primary text-primary-foreground"><Briefcase /></span>
                    <div className="min-w-0 flex-1">
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto max-w-full justify-start p-0 text-left font-semibold"
                        aria-label={`Open job: ${j.title}`}
                        onClick={() => setOpenJob(j)}
                      >
                        <span className="truncate">{j.title}</span>
                      </Button>
                      <div className="text-xs text-muted-foreground">{j.department_name ?? "—"}{j.location ? ` · ${j.location}` : ""}</div>
                    </div>
                    <Badge variant={JOB_BADGE[j.status] ?? "secondary"}>{j.status.replace("_", " ")}</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary"><Users /> {j.candidate_count}</Badge>
                    <div className="h-1.5 flex-1 overflow-hidden bg-muted">
                      <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">{j.hired_count}/{j.openings} hired</span>
                  </div>
                  {j.hiring_manager_name && <div className="text-xs text-muted-foreground">Hiring manager · {j.hiring_manager_name}</div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {adding && <JobModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); jobs.reload(); }} />}
    </div>
  );
}

function RecruitStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
      <span className="grid size-10 flex-none place-items-center bg-primary text-primary-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-none [font-variant-numeric:tabular-nums]">{value}</span>
        <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">{label}</span>
      </span>
      </CardContent>
    </Card>
  );
}

function JobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const departments = useFetch<Department[]>("/api/departments");
  const users = useFetch<User[]>("/api/users");
  const [f, setF] = useState({ title: "", department_id: "", location: "", employment_type: "full_time", openings: 1, hiring_manager_id: "", description: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/recruiting/jobs", {
        method: "POST",
        body: {
          title: f.title.trim(), department_id: f.department_id || null, location: f.location || null,
          employment_type: f.employment_type || null, openings: f.openings,
          hiring_manager_id: f.hiring_manager_id || null, description: f.description || null,
        },
      });
      notify("Job created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New job opening" onClose={onClose} maxWidth={560}>
      <form onSubmit={save} aria-busy={isSubmitting || undefined}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="recruit-job-title">Title *</FieldLabel>
            <Input id="recruit-job-title" required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Backend Engineer" />
          </Field>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="recruit-job-dept">Department</FieldLabel>
              <Select
                items={[{ value: null, label: "—" }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
                value={f.department_id || null}
                onValueChange={(value) => set("department_id", value ?? "")}
              >
                <SelectTrigger id="recruit-job-dept" aria-label="Department" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>—</SelectItem>
                  {(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-job-location">Location</FieldLabel>
              <Input id="recruit-job-location" value={f.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
          </FieldGroup>
          <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_7rem_1fr]">
            <Field>
              <FieldLabel htmlFor="recruit-job-type">Type</FieldLabel>
              <Select
                items={["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => ({ value: t, label: t.replace("_", " ") }))}
                value={f.employment_type}
                onValueChange={(value) => set("employment_type", value ?? "")}
              >
                <SelectTrigger id="recruit-job-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-job-openings">Openings</FieldLabel>
              <Input id="recruit-job-openings" type="number" min={1} value={f.openings} onChange={(e) => set("openings", Number(e.target.value))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-job-manager">Hiring manager</FieldLabel>
              <Select
                items={[{ value: null, label: "—" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
                value={f.hiring_manager_id || null}
                onValueChange={(value) => set("hiring_manager_id", value ?? "")}
              >
                <SelectTrigger id="recruit-job-manager" aria-label="Hiring manager" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>—</SelectItem>
                  {(users.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="recruit-job-description">Description</FieldLabel>
            <Textarea id="recruit-job-description" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function JobBoard({ job, onBack }: { job: JobOpening; onBack: () => void }) {
  const { notify } = useToast();
  const pipeline = useFetch<Record<string, Candidate[]>>(`/api/recruiting/jobs/${job.id}/pipeline`);
  const [openCand, setOpenCand] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function move(c: Candidate, dir: 1 | -1) {
    const flow = ["applied", "screen", "interview", "offer"];
    const idx = flow.indexOf(c.stage);
    const next = idx >= 0 ? flow[idx + dir] : undefined;
    if (!next) return;
    await api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { stage: next } });
    pipeline.reload();
  }
  async function reject(c: Candidate) {
    await api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { stage: "rejected" } });
    pipeline.reload();
  }
  async function addCandidate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await api(`/api/recruiting/jobs/${job.id}/candidates`, { method: "POST", body: { name: name.trim(), email: email.trim() || null } });
      setName(""); setEmail(""); setAdding(false);
      pipeline.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <PageHead
        title={job.title}
        subtitle={`${job.department_name ?? "—"}${job.location ? ` · ${job.location}` : ""} · ${job.status.replace("_", " ")}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBack}>← All jobs</Button>
            <Button onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" /> Add candidate
            </Button>
          </div>
        }
      />

      {adding && (
        <Card className="mb-4">
        <CardContent>
        <form onSubmit={addCandidate} aria-busy={isSubmitting || undefined}>
          <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="recruit-cand-name">Name *</FieldLabel>
            <Input id="recruit-cand-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="recruit-cand-email">Email</FieldLabel>
            <Input id="recruit-cand-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </FieldGroup>
        </form>
        </CardContent>
        </Card>
      )}

      {pipeline.loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-3">
            {STAGES.map((stage) => {
              const cands = pipeline.data?.[stage] ?? [];
              return (
                <Card key={stage} className="w-[230px] flex-none bg-muted/40">
                  <CardHeader className="grid grid-cols-[1fr_auto] items-center">
                    <CardTitle>{STAGE_LABEL[stage]}</CardTitle>
                    <Badge variant="secondary">{cands.length}</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {cands.map((c) => (
                      <Card key={c.id} size="sm">
                        <CardContent className="flex flex-col gap-2">
                        <Button variant="ghost" className="h-auto w-full justify-start px-0 text-left" onClick={() => setOpenCand(c.id)}>
                          <Avatar className="size-8">
                            <AvatarFallback>{initials(c.name)}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{c.email ?? c.source ?? ""}</span>
                          </span>
                        </Button>
                        {c.rating != null && (
                          <div className="mt-1 flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={n <= (c.rating ?? 0) ? "fill-primary text-primary" : "text-muted-foreground/40"} />)}
                          </div>
                        )}
                        {!["hired", "rejected"].includes(c.stage) && (
                          <div className="mt-1.5 flex justify-between">
                            <Button variant="outline" size="icon-sm" title="Move back" aria-label="Move back" disabled={c.stage === "applied"} onClick={() => move(c, -1)}><ChevronLeft /></Button>
                            <Button variant="destructive" size="icon-sm" title="Reject" aria-label="Reject" onClick={() => reject(c)}><Trash2 /></Button>
                            <Button variant="outline" size="icon-sm" title="Move forward" aria-label="Move forward" disabled={c.stage === "offer"} onClick={() => move(c, 1)}><ChevronRight /></Button>
                          </div>
                        )}
                        </CardContent>
                      </Card>
                    ))}
                    {cands.length === 0 && <div className="px-1 py-3 text-center text-xs text-muted-foreground">—</div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {openCand && <CandidateModal candId={openCand} onClose={() => setOpenCand(null)} onChanged={() => pipeline.reload()} />}
    </div>
  );
}

function CandidateModal({ candId, onClose, onChanged }: { candId: string; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const detail = useFetch<CandidateDetail>(`/api/recruiting/candidates/${candId}`);
  const users = useFetch<User[]>("/api/users");
  const templates = useFetch<OnboardingTemplate[]>("/api/people/templates?kind=onboarding");
  const [note, setNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [iv, setIv] = useState({ scheduled_at: "", interviewer_id: "", mode: "video", location: "" });
  const [offering, setOffering] = useState(false);
  const [offer, setOffer] = useState({ amount: "", currency: "AED", pay_period: "monthly", start_date: "" });
  const [hiring, setHiring] = useState(false);
  const [hireEmail, setHireEmail] = useState("");
  const [hireTpl, setHireTpl] = useState("");

  const c = detail.data;
  if (!c) return <Modal title="Candidate" onClose={onClose}><Loading /></Modal>;

  async function act(fn: () => Promise<unknown>, msg?: string) {
    try {
      await fn();
      if (msg) notify(msg);
      detail.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <Modal title={c.name} onClose={onClose} maxWidth={640}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="info">{STAGE_LABEL[c.stage]}</Badge>
        <Badge variant="secondary">{c.status}</Badge>
        {c.job_title && <Badge variant="secondary">{c.job_title}</Badge>}
        {c.email && <span className="text-sm text-muted-foreground">{c.email}</span>}
        {c.phone && <span className="text-sm text-muted-foreground">{c.phone}</span>}
      </div>

      {/* Rating */}
      <div className="mb-3 flex items-center gap-1">
        <div role="group" aria-label="Candidate rating" className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Rating</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
              aria-pressed={(c.rating ?? 0) === n}
              onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { rating: n } }))}
            >
              <Star className={n <= (c.rating ?? 0) ? "fill-primary text-primary" : "text-muted-foreground/40"} />
            </Button>
          ))}
        </div>
        <span className="ml-auto flex gap-1">
          <Input id={`recruit-resume-${c.id}`} type="file" className="peer sr-only" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.append("file", file);
            act(() => api(`/api/recruiting/candidates/${c.id}/resume`, { method: "POST", form: fd }), "Résumé uploaded.");
          }} />
          <FieldLabel
            htmlFor={`recruit-resume-${c.id}`}
            className={`${buttonVariants({ variant: "outline", size: "sm" })} cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-1 peer-focus-visible:ring-ring/50`}
          >
            <FileUp data-icon="inline-start" /> {c.resume_path ? "Replace résumé" : "Résumé"}
          </FieldLabel>
          {c.resume_path && (
            <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/recruiting/candidates/${c.id}/resume`, `${c.name}-resume`).catch(() => notify("Download failed", "error"))}>
              View résumé
            </Button>
          )}
        </span>
      </div>

      {/* Interviews */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="text-sm">Interviews</h4>
          <Button variant="outline" size="sm" onClick={() => setScheduling((v) => !v)}>
            <CalendarPlus data-icon="inline-start" /> Schedule
          </Button>
        </div>
        {scheduling && (
          <Card size="sm" className="mb-2">
            <CardContent className="flex flex-col gap-3">
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="recruit-iv-when">When</FieldLabel>
                <Input id="recruit-iv-when" type="datetime-local" value={iv.scheduled_at} onChange={(e) => setIv((p) => ({ ...p, scheduled_at: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="recruit-iv-interviewer">Interviewer</FieldLabel>
                 <Select
                   items={[{ value: null, label: "—" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
                   value={iv.interviewer_id || null}
                   onValueChange={(value) => setIv((p) => ({ ...p, interviewer_id: value ?? "" }))}
                 >
                   <SelectTrigger id="recruit-iv-interviewer" aria-label="Interviewer" className="w-full"><SelectValue /></SelectTrigger>
                   <SelectContent><SelectGroup>
                     <SelectItem value={null}>—</SelectItem>
                     {(users.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
                   </SelectGroup></SelectContent>
                 </Select>
              </Field>
            </FieldGroup>
            <Button size="sm"
              onClick={() => iv.scheduled_at && act(() => api(`/api/recruiting/candidates/${c.id}/interviews`, {
                method: "POST",
                body: { scheduled_at: new Date(iv.scheduled_at).toISOString(), interviewer_id: iv.interviewer_id || null, mode: iv.mode, location: iv.location || null },
              }), "Interview scheduled.")}
            >
              Schedule
            </Button>
            </CardContent>
          </Card>
        )}
        {c.interviews.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <div className="divide-y">
            {c.interviews.map((i) => (
              <InterviewRow key={i.id} iv={i} onSave={(body) => act(() => api(`/api/recruiting/interviews/${i.id}`, { method: "PATCH", body }), "Scorecard saved.")} />
            ))}
          </div>
        )}
      </div>

      {/* Offers */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="text-sm">Offers</h4>
          <Button variant="outline" size="sm" onClick={() => setOffering((v) => !v)}>+ Offer</Button>
        </div>
        {offering && (
          <Card size="sm" className="mb-2">
          <CardContent>
          <FieldGroup className="grid gap-2 sm:grid-cols-[7rem_6rem_1fr_1fr_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor="recruit-offer-amount">Amount</FieldLabel>
              <Input id="recruit-offer-amount" type="number" value={offer.amount} onChange={(e) => setOffer((p) => ({ ...p, amount: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-offer-currency">Currency</FieldLabel>
              <Input id="recruit-offer-currency" value={offer.currency} onChange={(e) => setOffer((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-offer-period">Period</FieldLabel>
              <Select
                items={["monthly", "annual", "hourly"].map((p2) => ({ value: p2, label: p2 }))}
                value={offer.pay_period}
                onValueChange={(value) => setOffer((p) => ({ ...p, pay_period: value ?? "" }))}
              >
                <SelectTrigger id="recruit-offer-period" aria-label="Period" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {["monthly", "annual", "hourly"].map((p2) => <SelectItem key={p2} value={p2}>{p2}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recruit-offer-start">Start date</FieldLabel>
              <Input id="recruit-offer-start" type="date" value={offer.start_date} onChange={(e) => setOffer((p) => ({ ...p, start_date: e.target.value }))} />
            </Field>
            <Button size="sm" onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}/offers`, {
              method: "POST",
              body: { amount: offer.amount || null, currency: offer.currency, pay_period: offer.pay_period, start_date: offer.start_date || null },
            }), "Offer created.")}>Create</Button>
          </FieldGroup>
          </CardContent>
          </Card>
        )}
        {c.offers.map((o) => (
          <div key={o.id} className="flex items-center justify-between py-1 text-sm">
            <span>{o.currency} {o.amount ?? "—"} / {o.pay_period}{o.start_date ? ` · starts ${o.start_date}` : ""}</span>
            <Select
              items={["draft", "sent", "accepted", "declined"].map((s) => ({ value: s, label: s }))}
              value={o.status}
              onValueChange={(value) => value !== null && act(() => api(`/api/recruiting/offers/${o.id}`, { method: "PATCH", body: { status: value } }))}
            >
              <SelectTrigger id={`recruit-offer-status-${o.id}`} aria-label="Offer status" className="w-full" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {["draft", "sent", "accepted", "declined"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {/* Notes / timeline */}
      <div className="mb-3">
        <h4 className="mb-1 text-sm">Timeline</h4>
        <div className="flex items-end gap-2">
          <Field>
            <FieldLabel htmlFor="recruit-note" className="sr-only">Note</FieldLabel>
            <Input id="recruit-note" aria-label="Add a note" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button variant="outline" size="sm" onClick={() => note.trim() && act(() => api(`/api/recruiting/candidates/${c.id}/notes`, { method: "POST", body: { body: note.trim() } }).then(() => setNote("")))}>Add</Button>
        </div>
        <div className="mt-1 flex max-h-36 flex-col gap-1 overflow-auto">
          {c.activities.map((a) => (
            <div key={a.id} className="bg-muted/40 px-2 py-1 text-xs">
              <span className={a.kind === "stage" ? "font-medium" : ""}>{a.body}</span>
              <span className="text-muted-foreground"> · {a.author_name ?? "system"} · {new Date(a.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hire */}
      {!c.user_id && c.status === "active" && (
        <Card size="sm" className="bg-muted/40">
          <CardContent>
          {hiring ? (
            <FieldGroup className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field>
                <FieldLabel htmlFor="recruit-hire-email">Work email</FieldLabel>
                <Input id="recruit-hire-email" type="email" autoComplete="email" value={hireEmail} onChange={(e) => setHireEmail(e.target.value)} placeholder="name@agholding.net" />
              </Field>
              <Field>
                <FieldLabel htmlFor="recruit-hire-tpl">Onboarding packet</FieldLabel>
                 <Select
                   items={[{ value: null, label: "Default checklist" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
                   value={hireTpl || null}
                   onValueChange={(value) => setHireTpl(value ?? "")}
                 >
                   <SelectTrigger id="recruit-hire-tpl" aria-label="Onboarding packet" className="w-full"><SelectValue /></SelectTrigger>
                   <SelectContent><SelectGroup>
                     <SelectItem value={null}>Default checklist</SelectItem>
                     {(templates.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                   </SelectGroup></SelectContent>
                 </Select>
              </Field>
              <Button size="sm"
                onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}/hire`, {
                  method: "POST",
                  body: { email: hireEmail.trim() || null, start_onboarding: true, template_id: hireTpl || null },
                }), "Hired — employee created and onboarding started.")}>
                <UserCheck data-icon="inline-start" /> Confirm hire
              </Button>
            </FieldGroup>
          ) : (
            <Button onClick={() => { setHiring(true); setHireEmail(""); }}>
              <UserCheck data-icon="inline-start" /> Hire — create employee + onboarding
            </Button>
          )}
          </CardContent>
        </Card>
      )}
      {c.user_id && <p className="mt-1 text-sm text-muted-foreground">Hired — employee record created.</p>}
    </Modal>
  );
}

function InterviewRow({ iv, onSave }: { iv: import("../api/types").InterviewItem; onSave: (body: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(iv.rating ?? 0);
  const [rec, setRec] = useState(iv.recommendation ?? "");
  const [fb, setFb] = useState(iv.feedback ?? "");
  return (
    <div className="py-1.5 text-sm">
      <div className="flex items-center justify-between">
        <span>
          {new Date(iv.scheduled_at).toLocaleString()} · {iv.mode}
          {iv.interviewer_name ? ` · ${iv.interviewer_name}` : ""}
          {iv.recommendation && <Badge className="ml-1" variant={iv.recommendation === "yes" ? "success" : iv.recommendation === "no" ? "destructive" : "warning"}>{iv.recommendation}</Badge>}
        </span>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Scorecard"}</Button>
      </div>
      {open && (
        <Card size="sm" className="mt-1">
        <CardContent>
          <div className="mb-1 flex items-center gap-1">
            <div role="group" aria-label="Interview rating" className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                  aria-pressed={rating === n}
                  onClick={() => setRating(n)}
                >
                  <Star className={n <= rating ? "fill-primary text-primary" : "text-muted-foreground/40"} />
                </Button>
              ))}
            </div>
            <Select
              items={[{ value: null, label: "Recommendation…" }, ...["yes", "maybe", "no"].map((r) => ({ value: r, label: r }))]}
              value={rec || null}
              onValueChange={(value) => setRec(value ?? "")}
            >
              <SelectTrigger id={`recruit-recommendation-${iv.id}`} aria-label="Recommendation" className="ml-2 w-full" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>Recommendation…</SelectItem>
                {["yes", "maybe", "no"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <Textarea
            rows={2}
            aria-label="Feedback"
            placeholder="Feedback"
            value={fb}
            onChange={(e) => setFb(e.target.value)}
          />
          <Button type="button" size="sm" className="mt-1" onClick={() => onSave({ rating: rating || null, recommendation: rec || null, feedback: fb || null })}>Save</Button>
        </CardContent>
        </Card>
      )}
    </div>
  );
}
