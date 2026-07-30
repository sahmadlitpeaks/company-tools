import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, LayoutGrid, List, Mail, Upload, Users } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Department, ModuleCatalogue, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  ConfirmDialog,
  Empty,
  ErrorBox,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const ROLE_BADGE: Record<string, BadgeVariant> = {
  admin: "info",
  manager: "warning",
  member: "secondary",
};

const STATUS_BADGE: Record<string, BadgeVariant> = {
  active: "success",
  pending: "warning",
  disabled: "destructive",
};

function AccessModal({
  u,
  onClose,
  onSaved,
}: {
  u: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { data: cat } = useFetch<ModuleCatalogue>("/api/users/modules");
  const { data: departments } = useFetch<Department[]>("/api/departments");
  const [role, setRole] = useState(u.role);
  const [status, setRecordStatus] = useState(u.status);
  const [deptId, setDeptId] = useState(u.department_id ?? "");
  // What the person should end up with — we derive grant/revoke diffs on save.
  const [desired, setDesired] = useState<Set<string>>(
    () => new Set(u.effective_permissions),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Base permissions implied by the chosen department (or the role default).
  const dept = departments?.find((d) => d.id === deptId);
  const base = new Set(dept ? dept.permissions : cat?.role_defaults[role] ?? []);

  function toggle(key: string) {
    setDesired((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save() {
    setIsSubmitting(true);
    try {
      const extra = [...desired].filter((k) => !base.has(k));
      const revoked = [...base].filter((k) => !desired.has(k));
      await api(`/api/users/${u.id}`, {
        method: "PATCH",
        body: {
          role,
          status,
          department_id: deptId || null,
          permissions: null, // department + grants/revokes now drive access
          extra_permissions: extra,
          revoked_permissions: revoked,
        },
      });
      notify("Access updated.");
      onSaved();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  const isAdminRole = role === "admin";

  return (
    <Modal
      title={`Access — ${u.display_name ?? u.email}`}
      onClose={onClose}
      maxWidth={580}
    >
      <FieldGroup className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="directory-access-role">Role</FieldLabel>
          <Select items={[{ value: "member", label: "Member" }, { value: "manager", label: "Manager" }, { value: "admin", label: "Admin" }]} value={role} onValueChange={(value) => setRole(value ?? "")}>
            <SelectTrigger className="w-full" id="directory-access-role"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="member">Member</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="directory-access-status">Status</FieldLabel>
          <Select items={[{ value: "pending", label: "Pending approval" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} value={status} onValueChange={(value) => setRecordStatus(value ?? "")}>
            <SelectTrigger className="w-full" id="directory-access-status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="pending">Pending approval</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field data-disabled={isAdminRole}>
          <FieldLabel htmlFor="directory-access-department">Department</FieldLabel>
          <Select items={[{ value: null, label: "None" }, ...(departments ?? []).map((d) => ({ value: d.id, label: d.name }))]} value={deptId || null} onValueChange={(value) => setDeptId(value ?? "")} disabled={isAdminRole}>
            <SelectTrigger className="w-full" id="directory-access-department"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value={null}>None</SelectItem>{(departments ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
      </FieldGroup>

      {isAdminRole ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Admins have full access to every module and settings.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Base access comes from the {dept ? <strong>{dept.name}</strong> : `${role} role`}.
            Tick to grant extra modules to this person, or untick to revoke.
          </p>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {cat?.modules.map((m) => {
              const inBase = base.has(m.key);
              const on = desired.has(m.key);
              const tag = on && !inBase ? "granted" : !on && inBase ? "revoked" : null;
              return (
                <FieldLabel
                  key={m.key}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => toggle(m.key)}
                  />
                  <span className="flex-1">{m.label}</span>
                  {tag === "granted" && <Badge variant="success">+grant</Badge>}
                  {tag === "revoked" && <Badge variant="destructive">revoked</Badge>}
                </FieldLabel>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button aria-label="Save" type="button"
          disabled={isSubmitting}
          onClick={save}
        >
          {isSubmitting ? "Saving…" : "Save access"}
        </Button>
      </div>
    </Modal>
  );
}

function ManageBrandsModal({
  u,
  onClose,
  onSaved,
}: {
  u: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [ids, setIds] = useState<string[]>(u.managed_company_ids ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  function toggle(id: string) {
    setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function save() {
    setIsSubmitting(true);
    try {
      await api(`/api/users/${u.id}/brands`, {
        method: "PUT",
        body: { company_ids: ids },
      });
      notify("Company access updated.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal title={`Company access — ${u.display_name ?? u.email}`} onClose={onClose}>
      <div className="mb-3 text-sm text-muted-foreground">
        Choose which companies this manager can manage.
      </div>
      <div className="flex flex-col gap-1">
        {brands.map((b) => (
          <FieldLabel
            key={b.id}
            className="flex items-center gap-2.5 px-2 py-2 hover:bg-muted"
          >
            <Checkbox
              checked={ids.includes(b.id)}
              onCheckedChange={() => toggle(b.id)}
            />
            <span
              className="size-3.5 ring-1 ring-foreground/10"
              style={{ background: b.primary_color }}
            />
            <span className="font-medium">{b.name}</span>
          </FieldLabel>
        ))}
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}

function initials(name?: string | null, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function PersonAvatar({ u, size = 64 }: { u: User; size?: number }) {
  return (
    <Avatar className="flex-none" style={{ height: size, width: size }}>
      {u.avatar_url && <AvatarImage src={u.avatar_url} alt="" />}
      <AvatarFallback
        className="bg-primary font-semibold text-primary-foreground"
        style={{ fontSize: size * 0.36 }}
      >
        {initials(u.display_name, u.email ?? undefined)}
      </AvatarFallback>
    </Avatar>
  );
}

export default function DirectoryPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [syncing, setSyncing] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState<User | null>(null);
  const [editingAccess, setEditingAccess] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  // Set when a reset couldn't be emailed, so the admin can read the password out.
  const [resetShown, setResetShown] = useState<{ who: string; password: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch<User[]>(
    `/api/users${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ""}`,
  );
  const isAdmin = user?.is_admin;
  const pendingCount = data?.filter((u) => u.status === "pending").length ?? 0;
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const departments = [...new Set((data ?? []).map((u) => u.department).filter(Boolean))].sort();
  const filtered = (data ?? []).filter(
    (u) =>
      (!deptFilter || u.department === deptFilter) &&
      (!statusFilter || u.status === statusFilter),
  );

  async function approve(u: User) {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { status: "active" } });
      notify(`${u.display_name ?? u.email} approved.`);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function resetPassword(u: User) {
    const who = u.display_name ?? u.email;
    const r = await api<{
      credentials_emailed: boolean;
      sent_to: string | null;
      temp_password: string | null;
    }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
    if (r.credentials_emailed) notify(`New password emailed to ${r.sent_to}.`);
    else setResetShown({ who: who ?? "", password: r.temp_password ?? "" });
    reload();
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await api<{ synced: number }>("/api/users/sync", {
        method: "POST",
      });
      notify(`Synced ${res.synced} users from Entra ID.`);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>(
        "/api/users/import",
        { method: "POST", form: fd },
      );
      const errs = res.errors.length ? ` (${res.errors.length} issue${res.errors.length > 1 ? "s" : ""})` : "";
      notify(`Imported: ${res.created} new, ${res.updated} updated${errs}.`);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  return (
    <div>
      <Input aria-label="Import CSV" ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
      <PageHead
        title="Employee Directory"
        subtitle="Synced from Azure Entra ID into the platform database."
        action={
          user?.is_admin && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => downloadFile("/api/users/template.csv", "employees-template.csv").catch(() => notify("Download failed", "error"))}>
                <FileText data-icon="inline-start" /> Template
              </Button>
              <Button type="button" variant="outline" onClick={() => importRef.current?.click()}>
                <Upload data-icon="inline-start" /> Import
              </Button>
              <Button type="button" variant="outline" onClick={() => downloadFile("/api/users/export.csv", "employees.csv").catch(() => notify("Export failed", "error"))}>
                <Download data-icon="inline-start" /> Export
              </Button>
              <Button type="button" variant="outline" onClick={sync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync from Entra ID"}
              </Button>
              <Button type="button" onClick={() => setAdding(true)}>
                Add user
              </Button>
            </div>
          )
        }
      />
      {isAdmin && pendingCount > 0 && (
        <div className="mb-3 border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning-foreground">
          <strong>{pendingCount}</strong> account{pendingCount > 1 ? "s" : ""} awaiting
          approval. Review and activate them below.
        </div>
      )}
      <Card className={view === "list" ? "py-0" : undefined}>
        <CardContent className={view === "list" ? "p-0" : undefined}>
        <FieldGroup className={`grid gap-2 ${view === "list" ? "p-4" : ""} sm:grid-cols-[minmax(13rem,1fr)_auto_auto_auto] sm:items-end`}>
          <Field>
            <FieldLabel htmlFor="directory-search" className="sr-only">Search</FieldLabel>
            <Input id="directory-search" aria-label="Search by name, email, department…"
              placeholder="Search by name, email, department…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="directory-department-filter" className="sr-only">Department</FieldLabel>
            <Select items={[{ value: null, label: "All departments" }, ...departments.map((d) => ({ value: d as string, label: d }))]} value={deptFilter || null} onValueChange={(value) => setDeptFilter(value ?? "")}>
              <SelectTrigger id="directory-department-filter" aria-label="Department filter"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value={null}>All departments</SelectItem>{departments.map((d) => <SelectItem key={d} value={d as string}>{d}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="directory-status-filter" className="sr-only">Status</FieldLabel>
            <Select items={[{ value: null, label: "All statuses" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "disabled", label: "Disabled" }]} value={statusFilter || null} onValueChange={(value) => setStatusFilter(value ?? "")}>
              <SelectTrigger id="directory-status-filter" aria-label="Status filter"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value={null}>All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <div className="flex">
            <Button type="button" size="icon"
              variant={view === "grid" ? "default" : "outline"}
              onClick={() => setView("grid")}
              title="Grid view"
              aria-label="Grid view"
            >
              <LayoutGrid />
            </Button>
            <Button type="button" size="icon"
              variant={view === "list" ? "default" : "outline"}
              onClick={() => setView("list")}
              title="List view"
              aria-label="List view"
            >
              <List />
            </Button>
          </div>
        </FieldGroup>

        {loading ? (
          <ListSkeleton rows={6} />
        ) : error ? (
          <ErrorBox message={error} />
        ) : filtered.length === 0 ? (
          <Empty
            icon={<Users />}
            message="No employees found"
            hint="Adjust filters, or run a sync to import staff from Azure Entra ID."
          />
        ) : view === "grid" ? (
          <>
            <div className="mb-2 text-xs text-muted-foreground">{filtered.length} people</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
              {filtered.map((u) => (
                  <Card
                    key={u.id}
                    size="sm"
                  >
                    <CardContent className="flex flex-col items-center text-center">
                    <Link
                      to={`/people/${u.id}`}
                      aria-label={u.display_name ?? "View profile"}
                      title={u.display_name ?? "View profile"}
                      className="mt-1.5"
                    >
                      <PersonAvatar u={u} size={68} />
                    </Link>
                    <Link to={`/people/${u.id}`} className="mt-2 font-semibold leading-tight text-foreground hover:text-primary">
                      {u.display_name ?? "—"}
                    </Link>
                    <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {u.job_title ?? "—"}
                      {u.department && <> · {u.department}</>}
                    </div>
                    {(u.status !== "active" || u.role !== "member") && (
                      <div className="mt-2 flex flex-wrap justify-center gap-1">
                        {u.status !== "active" && (
                          <Badge variant={STATUS_BADGE[u.status] ?? "secondary"}>{u.status}</Badge>
                        )}
                        {u.role !== "member" && (
                          <Badge variant={ROLE_BADGE[u.role] ?? "secondary"}>{u.role}</Badge>
                        )}
                      </div>
                    )}
                    {u.email && (
                      <a
                        href={`mailto:${u.email}`}
                        className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
                      >
                        <Mail className="size-3 flex-none" />
                        <span className="truncate">{u.email}</span>
                      </a>
                    )}
                    {isAdmin && (
                      <div className="mt-2.5 flex w-full flex-wrap justify-center gap-1 border-t pt-2.5">
                        {u.status === "pending" && (
                          <Button type="button" size="sm" onClick={() => approve(u)}>Approve</Button>
                        )}
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingAccess(u)}>Access</Button>
                        {(u.email || u.personal_email) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            title="Email them a new temporary password"
                            onClick={() => setResetting(u)}
                          >
                            Reset password
                          </Button>
                        )}
                        {u.role === "manager" && (
                          <Button type="button" variant="outline" size="sm" onClick={() => setManaging(u)}>Companies</Button>
                        )}
                      </div>
                    )}
                    </CardContent>
                  </Card>
              ))}
            </div>
          </>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar u={u} size={32} />
                      <div className="min-w-0">
                        <Link
                          to={`/people/${u.id}`}
                           className="font-semibold text-foreground hover:underline"
                        >
                          {u.display_name ?? "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{u.job_title ?? "—"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{u.department ?? "—"}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_BADGE[u.role] ?? "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[u.status] ?? "secondary"}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {u.status === "pending" && (
                          <Button type="button" size="sm"
                            onClick={() => approve(u)}
                          >
                            Approve
                          </Button>
                        )}
                        {u.role === "manager" && (
                          <Button type="button" variant="outline" size="sm" onClick={() => setManaging(u)}>
                            Brands ({u.managed_company_ids?.length ?? 0})
                          </Button>
                        )}
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingAccess(u)}>
                          Access
                        </Button>
                        {(u.email || u.personal_email) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            title="Email them a new temporary password"
                            onClick={() => setResetting(u)}
                          >
                            Reset password
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

      {managing && (
        <ManageBrandsModal
          u={managing}
          onClose={() => setManaging(null)}
          onSaved={reload}
        />
      )}

      {editingAccess && (
        <AccessModal
          u={editingAccess}
          onClose={() => setEditingAccess(null)}
          onSaved={reload}
        />
      )}

      {adding && (
        <AddUserModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {resetting && (
        <ConfirmDialog
          title="Issue a new temporary password?"
          message={`The current password for ${resetting.display_name ?? resetting.email} will stop working immediately.`}
          confirmLabel="Reset password"
          danger
          onConfirm={() => resetPassword(resetting)}
          onClose={() => setResetting(null)}
        />
      )}

      {resetShown && (
        <Modal title="New temporary password" onClose={() => setResetShown(null)}>
          <Alert>
            <AlertTitle>Email could not be sent</AlertTitle>
            <AlertDescription>
              The password for <strong>{resetShown.who}</strong> was reset, but the email
              could not be sent. Pass it on now — it can't be shown again.
            </AlertDescription>
          </Alert>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="directory-reset-password">Temporary password</FieldLabel>
              <Input id="directory-reset-password" readOnly value={resetShown.password} className="font-mono" />
              <FieldDescription>They must change it at their next sign-in.</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(resetShown.password);
                notify("Password copied.");
              }}
            >
              Copy
            </Button>
            <Button
              type="button"
              onClick={() => setResetShown(null)}
            >
              Done
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    role: "member",
    password: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Shown when the invite email couldn't be delivered and the admin has to
  // pass the password on themselves.
  const [handover, setHandover] = useState<{ email: string; password: string } | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password && form.password.length < 8) {
      notify("Password must be at least 8 characters.", "error");
      return;
    }
    setIsSubmitting(true);
    const email = form.email.trim().toLowerCase();
    try {
      const created = await api<{
        temp_password?: string | null;
        credentials_emailed?: boolean;
      }>("/api/users", {
        method: "POST",
        body: {
          display_name: form.display_name.trim(),
          email: email || null,
          role: form.role,
          status: "active",
          password: form.password || null,
        },
      });
      if (created.credentials_emailed) {
        notify(`User added — sign-in details emailed to ${email}.`);
        onSaved();
      } else if (created.temp_password) {
        // Account exists and works; only the email failed. Keep the modal open
        // so the password isn't lost — it is not recoverable afterwards.
        setHandover({ email, password: created.temp_password });
      } else {
        notify("User added.");
        onSaved();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  if (handover) {
    return (
      <Modal title="User added — send these details" onClose={onSaved}>
        <Alert>
          <AlertTitle>Invite email could not be sent</AlertTitle>
          <AlertDescription>
            The account is ready, but the invite email could not be sent (SMTP may not be
            configured). Pass these on now — the password can't be shown again, though you
            can always issue a new one from the person's profile.
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="directory-handover-email">Email</FieldLabel>
            <Input id="directory-handover-email" readOnly value={handover.email} />
          </Field>
          <Field>
            <FieldLabel htmlFor="directory-handover-password">Temporary password</FieldLabel>
            <Input id="directory-handover-password" readOnly value={handover.password} className="font-mono" />
            <FieldDescription>They'll be required to change it at first sign-in.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(handover.password);
              notify("Password copied.");
            }}
          >
            Copy password
          </Button>
          <Button type="button" onClick={onSaved}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rd-directorypage-631-full-name">Full name *</FieldLabel>
          <Input id="rd-directorypage-631-full-name"
            required
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-directorypage-639-email">Email *</FieldLabel>
          <Input id="rd-directorypage-639-email" aria-label="person@agholding.net"
            type="email"
            required
            placeholder="person@agholding.net"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-directorypage-649-role">Role</FieldLabel>
          <Select items={[{ value: "member", label: "Member" }, { value: "manager", label: "Manager" }, { value: "admin", label: "Admin" }]} value={form.role} onValueChange={(value) => set("role", value ?? "")}>
            <SelectTrigger className="w-full" id="rd-directorypage-649-role"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="member">Member</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-directorypage-657-initial-password">Initial password</FieldLabel>
          <Input id="rd-directorypage-657-initial-password" aria-label="Set a temporary password (optional)"
            type="text"
            placeholder="Leave blank to generate one and email it"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
          <FieldDescription>
            Leave this blank and a temporary password is generated and emailed to the
            person automatically. Set one only if you'd rather hand it over yourself.
            Either way they must change it the first time they sign in.
          </FieldDescription>
        </Field>
        </FieldGroup>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
