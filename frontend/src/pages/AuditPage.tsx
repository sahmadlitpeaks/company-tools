import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AuditEntry, AuditPage as AuditPageData } from "../api/types";
import { Loading, PageHead } from "../components/ui";

const ACTION_BADGE: Record<string, "success" | "info" | "destructive" | "warning"> = {
  created: "success",
  published: "success",
  updated: "info",
  shared: "info",
  deleted: "destructive",
  unshared: "warning",
  maintenance: "warning",
};

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [data, setData] = useState<AuditPageData | null>(null);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load(reset: boolean) {
    setLoading(true);
    try {
    const off = reset ? 0 : offset;
    const params = new URLSearchParams({ limit: "50", offset: String(off) });
    if (q) params.set("q", q);
    if (action) params.set("action", action);
    if (entityType) params.set("entity_type", entityType);
    const res = await api<AuditPageData>(`/api/audit?${params}`);
    setData(res);
    setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    setOffset(off + res.items.length);
    } finally {
      setLoading(false);
    }
  }

  // Reload on filter change (debounced for search).
  useEffect(() => {
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, action, entityType]);

  return (
    <div>
      <PageHead
        title="Audit Log"
        subtitle="Every action recorded across the platform."
      />

      <Card className="mb-4">
        <CardContent className="grid items-end gap-4 sm:grid-cols-5">
          <Field className="sm:col-span-3">
            <FieldLabel htmlFor="rd-auditpage-56-search">Search</FieldLabel>
            <Input id="rd-auditpage-56-search" aria-label="Search descriptions…" placeholder="Search descriptions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-auditpage-60-action">Action</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...(data?.actions ?? []).map((a) => ({ value: a, label: a }))]}
              value={action || null}
              onValueChange={(value) => setAction(value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-auditpage-60-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>All</SelectItem>
                  {(data?.actions ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-auditpage-71-entity">Entity</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...(data?.entity_types ?? []).map((e) => ({ value: e, label: e }))]}
              value={entityType || null}
              onValueChange={(value) => setEntityType(value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-auditpage-71-entity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>All</SelectItem>
                  {(data?.entity_types ?? []).map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card className="py-0">
        {loading && items.length === 0 ? (
          <CardContent><Loading /></CardContent>
        ) : (
          <>
            <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? <TableEmptyRow colSpan={5}>No matching activity.</TableEmptyRow> : items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{e.actor_name ?? "System"}</TableCell>
                    <TableCell><Badge variant={ACTION_BADGE[e.action] ?? "secondary"}>{e.action}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{e.entity_type}</Badge></TableCell>
                    <TableCell className="max-w-[32rem] whitespace-normal"><span className="line-clamp-2">{e.summary}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.has_more && (
              <div className="p-4 text-center">
                <Button type="button" variant="outline" onClick={() => load(false)} disabled={loading}>
                  {loading ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
