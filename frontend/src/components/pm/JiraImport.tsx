import { useRef, useState, type FormEvent } from "react";
import { FileUp, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import {
  ISSUE_STATUSES, issueLink, labelOf, pmError, ISSUE_TYPES,
  type IssueStatus, type JiraImportResult, type JiraPreview, type PmPerson, type PmProject,
} from "@/api/pm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { useFetch } from "@/hooks/useApi";

const NOBODY = "none";

/** Two-step Jira CSV import: preview and map, then import. */
export function JiraImport({ project, onImported }: { project: PmProject; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<JiraPreview | null>(null);
  const [statuses, setStatuses] = useState<Record<string, IssueStatus>>({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [addMembers, setAddMembers] = useState(true);
  const [result, setResult] = useState<JiraImportResult | null>(null);
  const [state, setState] = useState<{ busy: "" | "preview" | "import"; error: string }>({ busy: "", error: "" });
  const directory = useFetch<PmPerson[]>(preview ? "/api/pm/people" : null);

  function form(extra?: Record<string, string>) {
    const data = new FormData();
    data.append("file", file!);
    for (const [key, value] of Object.entries(extra ?? {})) data.append(key, value);
    return data;
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setState({ busy: "preview", error: "" });
    setResult(null);
    try {
      const found = await api<JiraPreview>(`/api/pm/projects/${project.id}/import/jira/preview`, { method: "POST", form: form() });
      setPreview(found);
      setStatuses(Object.fromEntries(found.statuses.map((s) => [s.name, s.suggested])));
      setPeople(Object.fromEntries(found.people.map((p) => [p.name, p.suggested_user_id ?? NOBODY])));
      setState({ busy: "", error: "" });
    } catch (cause) {
      setPreview(null);
      setState({ busy: "", error: pmError(cause) });
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setState({ busy: "import", error: "" });
    const mapping = {
      statuses,
      people: Object.fromEntries(Object.entries(people).map(([name, id]) => [name, id === NOBODY ? null : id])),
      add_members: addMembers,
    };
    try {
      const done = await api<JiraImportResult>(`/api/pm/projects/${project.id}/import/jira`, { method: "POST", form: form({ mapping: JSON.stringify(mapping) }) });
      setResult(done);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setState({ busy: "", error: "" });
      onImported();
    } catch (cause) {
      setState({ busy: "", error: pmError(cause) });
    }
  }

  const toImport = preview ? preview.total - preview.already_imported : 0;
  const listed = (directory.data ?? []).map((p) => ({ value: p.id, label: p.email ? `${p.name} (${p.email})` : p.name }));
  // Suggested matches always appear by name, even if the people list is cut short.
  const suggested = (preview?.people ?? [])
    .filter((p) => p.suggested_user_id && !listed.some((c) => c.value === p.suggested_user_id))
    .map((p) => ({ value: p.suggested_user_id!, label: p.suggested_name ?? p.name }));
  const choices = [{ value: NOBODY, label: "Don't map (keep their name in the text)" }, ...listed,
    ...suggested.filter((c, i) => suggested.findIndex((other) => other.value === c.value) === i)];

  return <Card>
    <CardHeader>
      <CardTitle>Import from Jira</CardTitle>
      <CardDescription>
        In Jira, open the issues to move (for example a project filter), choose Export, then "CSV (all fields)". Importing the same file again skips issues already imported.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {result && <Alert role="status">
        <AlertTitle>Imported {result.created} {result.created === 1 ? "issue" : "issues"}</AlertTitle>
        <AlertDescription>
          <p>
            {result.skipped > 0 && `${result.skipped} already imported. `}
            {result.comments} comments, {result.links} links{result.sprints_created ? `, ${result.sprints_created} sprints` : ""}
            {result.members_added ? `; ${result.members_added} people added to the project` : ""}.
          </p>
          {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          {result.first_key && <Link to={issueLink(project.key, result.first_key)} className="underline underline-offset-4">Open {result.first_key}</Link>}
        </AlertDescription>
      </Alert>}
      <form onSubmit={(event) => void runPreview(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor="pm-jira-file">Jira CSV export</FieldLabel>
          <Input id="pm-jira-file" ref={fileRef} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} />
        </Field>
        <Button type="submit" variant="outline" disabled={!file || Boolean(state.busy)}>
          {state.busy === "preview" ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}Preview
        </Button>
      </form>

      {preview && <div className="flex flex-col gap-4">
        <p className="text-sm">
          Found <span className="font-semibold">{preview.total}</span> issues ({preview.types.map((t) => `${t.count} ${t.name}`).join(", ")}),
          {" "}{preview.comments} comments and {preview.links} links.
          {preview.already_imported > 0 && ` ${preview.already_imported} were imported before and will be skipped.`}
          {preview.sprints.length > 0 && ` Unfinished work goes into ${preview.sprints.length === 1 ? "sprint" : "sprints"} ${preview.sprints.join(", ")}.`}
        </p>
        {preview.warnings.map((warning) => <Alert key={warning}><AlertDescription>{warning}</AlertDescription></Alert>)}

        <section className="flex flex-col gap-2" aria-labelledby="pm-jira-statuses">
          <h2 id="pm-jira-statuses" className="text-sm font-semibold">Statuses</h2>
          <TableSurface><Table>
            <TableHeader><TableRow><TableHead>Jira status</TableHead><TableHead className="w-20 text-right">Issues</TableHead><TableHead className="w-32 sm:w-48">Becomes</TableHead></TableRow></TableHeader>
            <TableBody>{preview.statuses.map((status) => <TableRow key={status.name}>
              <TableCell className="break-words">{status.name}</TableCell>
              <TableCell className="text-right tabular-nums">{status.count}</TableCell>
              <TableCell>
                <Select items={ISSUE_STATUSES} value={statuses[status.name]} onValueChange={(value) => value && setStatuses((current) => ({ ...current, [status.name]: value as IssueStatus }))}>
                  <SelectTrigger className="w-full" aria-label={`Status for Jira ${status.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{ISSUE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </TableCell>
            </TableRow>)}</TableBody>
          </Table></TableSurface>
        </section>

        {preview.people.length > 0 && <section className="flex flex-col gap-2" aria-labelledby="pm-jira-people">
          <h2 id="pm-jira-people" className="text-sm font-semibold">People</h2>
          <p className="text-xs text-muted-foreground">Mapped people become assignees, reporters and comment authors. Unmapped names are kept in the issue text.</p>
          <TableSurface><Table>
            <TableHeader><TableRow><TableHead>Jira name</TableHead><TableHead className="w-16 text-right sm:w-20">Mentions</TableHead><TableHead className="w-40 sm:w-72">Person here</TableHead></TableRow></TableHeader>
            <TableBody>{preview.people.map((person) => <TableRow key={person.name}>
              <TableCell className="break-words">{person.name}</TableCell>
              <TableCell className="text-right tabular-nums">{person.count}</TableCell>
              <TableCell>
                <Select items={choices} value={people[person.name] ?? NOBODY} disabled={directory.loading} onValueChange={(value) => value && setPeople((current) => ({ ...current, [person.name]: value }))}>
                  <SelectTrigger className="w-full" aria-label={`Person for Jira ${person.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{choices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </TableCell>
            </TableRow>)}</TableBody>
          </Table></TableSurface>
          <Field orientation="horizontal">
            <Switch id="pm-jira-members" checked={addMembers} onCheckedChange={setAddMembers} />
            <FieldContent>
              <FieldLabel htmlFor="pm-jira-members">Add mapped people to this project</FieldLabel>
              <FieldDescription>Assignees join as members and reporters as viewers. Otherwise people who aren't on the project are left unassigned.</FieldDescription>
            </FieldContent>
          </Field>
        </section>}

        <Collapsible>
          <CollapsibleTrigger render={<Button variant="link" size="sm" className="h-auto self-start p-0" />}>First issues in the file</CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {preview.sample.map((issue) => <li key={issue.key}><span className="text-muted-foreground">{issue.key}</span> · {labelOf(ISSUE_TYPES, issue.type)} · {issue.summary} <span className="text-muted-foreground">({issue.status})</span></li>)}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        <Button className="self-start" onClick={() => void runImport()} disabled={Boolean(state.busy) || toImport === 0}>
          {state.busy === "import" ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
          {toImport === 0 ? "Everything is already imported" : `Import ${toImport} ${toImport === 1 ? "issue" : "issues"}`}
        </Button>
      </div>}
    </CardContent>
  </Card>;
}
