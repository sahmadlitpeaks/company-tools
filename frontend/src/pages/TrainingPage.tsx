import { useState } from "react";
import { Award, BookOpen, ExternalLink, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Certification, Course, CourseAssignment, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const A_BADGE: Record<string, "warning" | "info" | "success" | "secondary"> = { assigned: "warning", in_progress: "info", completed: "success", waived: "secondary" };

export default function TrainingPage() {
  const { user } = useAuth();
  const canManage = !!user?.is_admin || user?.role === "manager" || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"mine" | "courses" | "certs">("mine");

  return (
    <div>
      <PageHead title="Training" subtitle="Assigned learning, course catalogue and certifications." />
      <ToggleGroup className="mb-4" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as typeof tab)} variant="outline">
        <ToggleGroupItem value="mine">My learning</ToggleGroupItem>
        <ToggleGroupItem value="certs">Certifications</ToggleGroupItem>
        {canManage && <ToggleGroupItem value="courses">Course catalogue</ToggleGroupItem>}
      </ToggleGroup>
      {tab === "mine" && <MyLearning />}
      {tab === "certs" && <Certifications />}
      {tab === "courses" && canManage && <Courses />}
    </div>
  );
}

function MyLearning() {
  const { notify } = useToast();
  const mine = useFetch<CourseAssignment[]>("/api/training/my/assignments");

  async function setRecordStatus(a: CourseAssignment, status: string) {
    try {
      await api(`/api/training/assignments/${a.id}?status=${status}`, { method: "PATCH" });
      mine.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  if (mine.loading) return <Loading />;
  if ((mine.data?.length ?? 0) === 0) return <Card><CardContent><Empty icon={<BookOpen />} message="No training assigned" hint="Assigned courses will appear here." /></CardContent></Card>;

  return (
    <Card className="py-0"><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Course</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {mine.data!.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="max-w-[28rem] whitespace-normal"><span className="line-clamp-2 font-medium">{a.course_title}</span></TableCell>
              <TableCell className="text-muted-foreground">{a.due_date ?? "—"}</TableCell>
              <TableCell><Badge variant={A_BADGE[a.status]}>{a.status.replace("_", " ")}</Badge></TableCell>
              <TableCell className="text-right">
                {a.status !== "completed" && (
                  <span className="flex justify-end gap-1">
                    {a.status === "assigned" && <Button type="button" variant="outline" size="sm" onClick={() => setRecordStatus(a, "in_progress")}>Start</Button>}
                    <Button type="button" size="sm" onClick={() => setRecordStatus(a, "completed")}>Mark complete</Button>
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function Certifications() {
  const { notify } = useToast();
  const certs = useFetch<Certification[]>("/api/training/my/certifications");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", issuer: "", issued_date: "", expiry_date: "", credential_id: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Certification | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/training/my/certifications", { method: "POST", body: { ...f, issued_date: f.issued_date || null, expiry_date: f.expiry_date || null } });
      setF({ name: "", issuer: "", issued_date: "", expiry_date: "", credential_id: "" });
      setAdding(false);
      certs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function del(c: Certification) {
    await api(`/api/training/my/certifications/${c.id}`, { method: "DELETE" });
    certs.reload();
  }

  return (
    <Card className="py-0">
      <CardHeader className="grid grid-cols-[1fr_auto] items-center py-(--card-spacing)">
        <CardTitle className="inline-flex items-center gap-2"><Award /> My certifications</CardTitle>
        <Button type="button" size="sm" onClick={() => setAdding((v) => !v)}><Plus data-icon="inline-start" /> Add</Button>
      </CardHeader>
      <CardContent className={certs.data?.length ? "p-0" : undefined}>
      {adding && (
        <form onSubmit={add} className="mb-3 border p-3">
          <FieldGroup>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="cert-name">Name</FieldLabel><Input id="cert-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="cert-issuer">Issuer</FieldLabel><Input id="cert-issuer" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
          </FieldGroup>
          <FieldGroup className="grid gap-3 sm:grid-cols-3">
            <Field><FieldLabel htmlFor="cert-issued">Issued</FieldLabel><Input id="cert-issued" type="date" value={f.issued_date} onChange={(e) => setF({ ...f, issued_date: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="cert-expires">Expires</FieldLabel><Input id="cert-expires" type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="cert-id">Credential ID</FieldLabel><Input id="cert-id" value={f.credential_id} onChange={(e) => setF({ ...f, credential_id: e.target.value })} /></Field>
          </FieldGroup>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
          </FieldGroup>
        </form>
      )}
      {certs.loading ? (
        <Loading />
      ) : (certs.data?.length ?? 0) === 0 ? (
        <Empty icon={<Award />} message="No certifications recorded" />
      ) : (
        <Table>
           <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Issuer</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {certs.data!.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="max-w-[28rem] whitespace-normal"><span className="truncate font-medium" title={c.name}>{c.name}</span></TableCell>
                <TableCell className="text-muted-foreground">{c.issuer ?? "—"}</TableCell>
                <TableCell>
                  {c.expiry_date ? (
                    <Badge variant={c.expired ? "destructive" : (c.days_to_expiry ?? 999) < 60 ? "warning" : "success"}>
                      {c.expired ? "expired" : `${c.days_to_expiry}d`}
                    </Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right"><Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleting(c)}><Trash2 /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </CardContent>
      {deleting && (
        <ConfirmDialog
          title="Remove certification"
          message={`Remove "${deleting.name}"?`}
          confirmLabel="Remove certification"
          danger
          onConfirm={() => del(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}

function Courses() {
  const { notify } = useToast();
  const courses = useFetch<Course[]>("/api/training/courses");
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);

  async function del(c: Course) {
    await api(`/api/training/courses/${c.id}`, { method: "DELETE" });
    courses.reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2"><BookOpen /> Course catalogue</h3>
        <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New course</Button>
      </div>
      {courses.loading ? (
        <Loading />
      ) : (courses.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<BookOpen />} message="No courses yet" /></CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {courses.data!.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{c.title}{c.category && <Badge variant="secondary" className="ml-1">{c.category}</Badge>}</div>
                  {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
                  {c.url && <Button render={<a href={c.url} target="_blank" rel="noreferrer" />} variant="link" className="px-0">Open content <ExternalLink data-icon="inline-end" /></Button>}
                  <div className="mt-1 text-xs text-muted-foreground">{c.assigned_count} assigned</div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => setAssignFor(c)}>Assign</Button>
                  <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleting(c)}><Trash2 /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {creating && <CourseModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); courses.reload(); notify("Course created."); }} />}
      {assignFor && <AssignModal course={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); courses.reload(); }} />}
      {deleting && (
        <ConfirmDialog
          title="Delete course"
          message={`Delete course "${deleting.title}"?`}
          confirmLabel="Delete course"
          danger
          onConfirm={() => del(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function CourseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ title: "", category: "", url: "", description: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function save() {
    if (!f.title.trim()) { notify("Title required", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/training/courses", { method: "POST", body: { ...f, category: f.category || null, url: f.url || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal title="New course" onClose={onClose} maxWidth={480}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="course-title">Title</FieldLabel><Input id="course-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor="course-category">Category</FieldLabel><Input id="course-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor="course-url">Content URL</FieldLabel><Input id="course-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://lms/..." /></Field>
      <Field><FieldLabel htmlFor="course-description">Description</FieldLabel><Textarea id="course-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Saving…" : "Create"}</Button>
      </div>
      </FieldGroup>
    </Modal>
  );
}

function AssignModal({ course, onClose, onDone }: { course: Course; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [selected, setSelected] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function save() {
    if (selected.length === 0) { notify("Pick at least one person", "error"); return; }
    setIsSubmitting(true);
    try {
      await api(`/api/training/courses/${course.id}/assign`, { method: "POST", body: { user_ids: selected, due_date: due || null } });
      notify("Assigned.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal title={`Assign — ${course.title}`} onClose={onClose} maxWidth={460}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="assign-due">Due date (optional)</FieldLabel><Input id="assign-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field><FieldLabel>Employees</FieldLabel>
      <div className="max-h-64 overflow-auto border border-border p-2">
        {(people.data ?? []).map((u) => (
          <Field key={u.id} orientation="horizontal">
            <Checkbox id={`assign-${u.id}`} checked={selected.includes(u.id)} onCheckedChange={() => toggle(u.id)} />
            <FieldLabel htmlFor={`assign-${u.id}`}>{u.display_name ?? u.email}</FieldLabel>
          </Field>
        ))}
      </div>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Assigning…" : `Assign (${selected.length})`}</Button>
      </div>
      </FieldGroup>
    </Modal>
  );
}
