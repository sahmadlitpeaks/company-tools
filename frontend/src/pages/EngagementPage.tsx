import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { Award, BarChart3, MailOpen, Plus, Send, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Kudos, Survey, SurveyResults, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function EngagementPage() {
  const { user } = useAuth();
  const isHr = !!user?.is_admin || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"kudos" | "surveys">("kudos");

  return (
    <div>
      <PageHead title="Engagement" subtitle="Recognition and employee surveys." />
      <ToggleGroup className="mb-4" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as "kudos" | "surveys")}>
        <ToggleGroupItem value="kudos">Kudos</ToggleGroupItem>
        <ToggleGroupItem value="surveys">Surveys</ToggleGroupItem>
      </ToggleGroup>
      {tab === "kudos" ? <KudosWall /> : <Surveys isHr={isHr} />}
    </div>
  );
}

function KudosWall() {
  const { notify } = useToast();
  const feed = useFetch<Kudos[]>("/api/engagement/kudos");
  const [giving, setGiving] = useState(false);

  return (
    <div>
      <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h3 className="m-0 flex items-center gap-2">
          Recognition wall
           {(feed.data?.length ?? 0) > 0 && <Badge variant="warning">{feed.data!.length}</Badge>}
        </h3>
        <Button type="button" size="sm" onClick={() => setGiving(true)}><Award data-icon="inline-start" /> Give kudos</Button>
      </div>
      {feed.loading ? (
        <Loading />
      ) : (feed.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<Award />} message="No kudos yet" hint="Be the first to recognise a colleague." /></CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {feed.data!.map((k) => (
            <Card key={k.id} className="relative border-l-4 border-l-warning">
              <CardContent>
              <div className="flex items-center gap-2">
                <span className="grid size-9 flex-none place-items-center bg-primary/10 text-foreground"><Award /></span>
                <div className="min-w-0">
                  <div className="text-sm"><strong>{k.from_name ?? "Someone"}</strong> → <strong>{k.to_name}</strong></div>
                  <div className="text-xs text-muted-foreground">{timeAgo(k.created_at)}</div>
                </div>
              </div>
              <p className="mt-2 mb-0">{k.message}</p>
              {k.value_tag && <Badge variant="secondary">{k.value_tag}</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {giving && <GiveKudosModal onClose={() => setGiving(false)} onDone={() => { setGiving(false); feed.reload(); notify("Kudos sent!"); }} />}
    </div>
  );
}

const VALUES = ["Ownership", "Teamwork", "Customer First", "Innovation", "Integrity"];

function GiveKudosModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [toId, setToId] = useState("");
  const [message, setBodyMessage] = useState("");
  const [tag, setTag] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    if (!toId || !message.trim()) { notify("Pick a colleague and write a message", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/engagement/kudos", { method: "POST", body: { to_user_id: toId, message: message.trim(), value_tag: tag || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Give kudos" onClose={onClose} maxWidth={460}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="rd-engagementpage-102-to">To</FieldLabel><Select items={[{ value: null, label: "Select a colleague…" }, ...(people.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={toId || null} onValueChange={(value) => setToId(value ?? "")}><SelectTrigger className="w-full" id="rd-engagementpage-102-to" aria-label="To"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select a colleague…</SelectItem>{(people.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel htmlFor="rd-engagementpage-108-message">Message</FieldLabel><Textarea id="rd-engagementpage-108-message" aria-label="What did they do well?" value={message} onChange={(e) => setBodyMessage(e.target.value)} placeholder="What did they do well?" /></Field>
      <Field><FieldLabel htmlFor="rd-engagementpage-110-company-value-optional">Company value (optional)</FieldLabel><Select items={[{ value: null, label: "None" }, ...VALUES.map((v) => ({ value: v, label: v }))]} value={tag || null} onValueChange={(value) => setTag(value ?? "")}><SelectTrigger className="w-full" id="rd-engagementpage-110-company-value-optional" aria-label="Company value (optional)"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>None</SelectItem>{VALUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </FieldGroup>
      <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Send" type="button" disabled={isSubmitting} onClick={save}><Send data-icon="inline-start" /> {isSubmitting ? "Sending…" : "Send"}</Button>
      </div>
    </Modal>
  );
}

function Surveys({ isHr }: { isHr: boolean }) {
  const { notify } = useToast();
  const surveys = useFetch<Survey[]>("/api/engagement/surveys");
  const [creating, setCreating] = useState(false);
  const [taking, setTaking] = useState<Survey | null>(null);
  const [viewing, setViewing] = useState<Survey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Survey | null>(null);

  async function setRecordStatus(s: Survey, status: string) {
    try {
      await api(`/api/engagement/surveys/${s.id}`, { method: "PATCH", body: { status } });
      surveys.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(s: Survey) {
    await api(`/api/engagement/surveys/${s.id}`, { method: "DELETE" });
    surveys.reload();
  }

  return (
    <div>
      <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h3 className="m-0">Surveys</h3>
        {isHr && (
          <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New survey</Button>
        )}
      </div>
      {surveys.loading ? (
        <Loading />
      ) : (surveys.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<BarChart3 />} message="No surveys" hint={isHr ? "Create a pulse or eNPS survey." : "No open surveys right now."} /></CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {surveys.data!.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription className="capitalize">{s.kind} · {s.anonymous ? "anonymous" : "named"}</CardDescription>
                <CardAction><Badge variant={s.status === "open" ? "success" : s.status === "closed" ? "secondary" : "warning"}>{s.status}</Badge></CardAction>
              </CardHeader>
              {s.description && <CardContent className="text-sm text-muted-foreground">{s.description}</CardContent>}
              <CardFooter className="flex flex-wrap gap-2">
                {s.status === "open" && (
                  <Button type="button" size="sm" onClick={() => setTaking(s)}>Take survey</Button>
                )}
                {isHr && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setViewing(s)}><BarChart3 data-icon="inline-start" /> Results ({s.response_count})</Button>
                    {s.status === "draft" && <Button type="button" variant="outline" size="sm" onClick={() => setRecordStatus(s, "open")}>Open</Button>}
                    {s.status === "open" && <Button type="button" variant="outline" size="sm" onClick={() => setRecordStatus(s, "closed")}>Close</Button>}
                    <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(s)}><Trash2 /></Button>
                  </>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {creating && <CreateSurveyModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); surveys.reload(); }} />}
      {taking && <TakeSurveyModal survey={taking} onClose={() => setTaking(null)} onDone={() => { setTaking(null); surveys.reload(); notify("Thanks for your feedback!"); }} />}
      {viewing && <ResultsModal survey={viewing} onClose={() => setViewing(null)} />}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete survey "${deleteTarget.title}"?`}
          message={`Permanently delete the "${deleteTarget.title}" survey?`}
          confirmLabel="Delete survey"
          danger
          onConfirm={() => del(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function CreateSurveyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("enps");
  const [anonymous, setAnonymous] = useState(true);
  const [questions, setQuestions] = useState<{ id: string; text: string; qtype: string }[]>([
    { id: crypto.randomUUID(), text: "", qtype: "scale" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    if (!title.trim()) { notify("Title required", "error"); return; }
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = { title: title.trim(), description: description || null, kind, anonymous };
      if (kind !== "enps") {
        body.questions = questions
          .filter((q) => q.text.trim())
          .map(({ text, qtype }) => ({ text, qtype }));
      }
      await api("/api/engagement/surveys", { method: "POST", body });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New survey" onClose={onClose} maxWidth={560}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="rd-engagementpage-220-title">Title</FieldLabel><Input id="rd-engagementpage-220-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field><FieldLabel htmlFor="rd-engagementpage-221-description">Description</FieldLabel><Textarea id="rd-engagementpage-221-description" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="rd-engagementpage-224-type">Type</FieldLabel><Select items={[{ value: "enps", label: "eNPS (auto questions)" }, { value: "pulse", label: "Pulse" }, { value: "custom", label: "Custom" }]} value={kind} onValueChange={(value) => setKind(value ?? "")}><SelectTrigger className="w-full" id="rd-engagementpage-224-type" aria-label="Type"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="enps">eNPS (auto questions)</SelectItem><SelectItem value="pulse">Pulse</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectGroup></SelectContent></Select></Field>
        <FieldLabel className="flex items-center gap-2"><Checkbox checked={anonymous} onCheckedChange={(checked) => setAnonymous(checked)} /> Anonymous</FieldLabel>
      </div>
      {kind !== "enps" && (
        <Field>
          <FieldLabel htmlFor="rd-engagementpage-237-muted-text-xs-questions">Questions</FieldLabel>
          {questions.map((q, i) => (
            <div key={q.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
              <Input id={`survey-question-${q.id}`} aria-label="Question text" placeholder="Question text" value={q.text} onChange={(e) => setQuestions((arr) => arr.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
              <Select items={[{ value: "scale", label: "Scale 1–5" }, { value: "nps", label: "NPS 0–10" }, { value: "text", label: "Text" }, { value: "boolean", label: "Yes/No" }]} value={q.qtype} onValueChange={(value) => setQuestions((arr) => arr.map((x, j) => j === i ? { ...x, qtype: value ?? "" } : x))}><SelectTrigger id={`survey-question-type-${q.id}`} aria-label="Question type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="scale">Scale 1–5</SelectItem><SelectItem value="nps">NPS 0–10</SelectItem><SelectItem value="text">Text</SelectItem><SelectItem value="boolean">Yes/No</SelectItem></SelectGroup></SelectContent></Select>
              <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setQuestions((arr) => arr.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setQuestions((a) => [...a, { id: crypto.randomUUID(), text: "", qtype: "scale" }])}>+ Add question</Button>
        </Field>
      )}
      </FieldGroup>
      <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Creating…" : "Create"}</Button>
      </div>
    </Modal>
  );
}

function TakeSurveyModal({ survey, onClose, onDone }: { survey: Survey; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [answers, setAnswers] = useState<Record<string, { value_num?: number; value_text?: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setNum(qid: string, n: number) { setAnswers((a) => ({ ...a, [qid]: { value_num: n } })); }
  function setText(qid: string, t: string) { setAnswers((a) => ({ ...a, [qid]: { value_text: t } })); }

  async function submit() {
    setIsSubmitting(true);
    try {
      const payload = survey.questions
        .filter((q) => answers[q.id] !== undefined)
        .map((q) => ({ question_id: q.id, ...answers[q.id] }));
      await api(`/api/engagement/surveys/${survey.id}/respond`, { method: "POST", body: { answers: payload } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={survey.title} onClose={onClose} maxWidth={520}>
       {survey.anonymous && <p className="text-sm text-muted-foreground">Your response is anonymous.</p>}
       {survey.questions.map((q) => (
        <Field key={q.id}>
          <FieldLabel htmlFor="rd-engagementpage-288-field">{q.text}</FieldLabel>
          {q.qtype === "text" ? (
            <Textarea id="rd-engagementpage-288-field" value={answers[q.id]?.value_text ?? ""} onChange={(e) => setText(q.id, e.target.value)} />
          ) : q.qtype === "boolean" ? (
            <ToggleGroup value={answers[q.id]?.value_num === undefined ? [] : [String(answers[q.id]?.value_num)]} onValueChange={(value) => value[0] !== undefined && setNum(q.id, Number(value[0]))}><ToggleGroupItem value="1">Yes</ToggleGroupItem><ToggleGroupItem value="0">No</ToggleGroupItem></ToggleGroup>
          ) : (
            <ToggleGroup className="flex-wrap" value={answers[q.id]?.value_num === undefined ? [] : [String(answers[q.id]?.value_num)]} onValueChange={(value) => value[0] !== undefined && setNum(q.id, Number(value[0]))}>
              {Array.from({ length: q.qtype === "nps" ? 11 : 5 }, (_, i) => (q.qtype === "nps" ? i : i + 1)).map((n) => (
                <ToggleGroupItem key={n} value={String(n)}>{n}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </Field>
      ))}
      <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Submit" type="button" disabled={isSubmitting} onClick={submit}>{isSubmitting ? "Submitting…" : "Submit"}</Button>
      </div>
    </Modal>
  );
}

function ResultsModal({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const res = useFetch<SurveyResults>(`/api/engagement/surveys/${survey.id}/results`);
  return (
    <Modal title={`Results — ${survey.title}`} onClose={onClose} maxWidth={560}>
      {res.loading || !res.data ? (
        <Loading />
      ) : res.data.response_count === 0 ? (
        <Empty icon={<MailOpen />} message="No responses yet" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">{res.data.response_count} response{res.data.response_count === 1 ? "" : "s"}</div>
          {res.data.questions.map((q) => (
            <div key={q.question_id} className="border border-border p-3">
              <div className="font-medium text-sm">{q.text}</div>
              {q.qtype === "nps" && q.enps != null && (
                 <div className={q.enps >= 0 ? "mt-1 text-2xl font-bold text-success" : "mt-1 text-2xl font-bold text-destructive"}>eNPS {q.enps}</div>
              )}
              {(q.qtype === "scale" || q.qtype === "boolean") && q.average != null && (
                <div className="mt-1 text-xl font-bold">{q.average} <span className="text-sm font-normal text-muted-foreground">avg</span></div>
              )}
              {q.qtype === "text" && (
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {q.text_answers.length === 0 ? <li className="text-muted-foreground">No comments</li> : q.text_answers.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
