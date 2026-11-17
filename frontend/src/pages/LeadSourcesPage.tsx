import { Link } from "react-router-dom";
import { SOURCE_LABELS } from "@/components/crm/crm";
import { Empty, ErrorState, Loading, PageHead } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { useAuth } from "@/auth/AuthContext";
import { useFetch } from "@/hooks/useApi";

type SourceRow = { source: string; source_detail: string | null; submissions: number; leads: number; last_at: string | null };

function sourceName(row: SourceRow) {
  const label = SOURCE_LABELS[row.source] ?? row.source;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ago(iso: string | null) {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

/** Where leads come from, so a source that stopped sending stands out (BRD LHB-04). */
export default function LeadSourcesPage() {
  const { can } = useAuth();
  const sources = useFetch<SourceRow[]>("/api/crm/sources");
  const rows = sources.data ?? [];

  return <div className="flex flex-col gap-6">
    <PageHead headingLevel={1} title="Lead sources"
      subtitle="Every website form, download, card and import that sends leads to the CRM, with its latest submission. A person who comes in several times is one lead."
      action={can("crm.web_inbox") ? <Button variant="outline" nativeButton={false} render={<Link to="/inbox" />}>Connect a website</Button> : undefined} />
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
        <CardDescription>Most recent first. Submissions count every time someone came in; leads count people.</CardDescription>
      </CardHeader>
      <CardContent>
        {sources.error ? <ErrorState message={sources.error} onRetry={sources.reload} /> : sources.loading ? <Loading /> : !rows.length
          ? <Empty message="No leads yet" hint="Leads from website forms, downloads and digital cards will appear here." />
          : <>
            <ul className="flex flex-col divide-y divide-border md:hidden">
              {rows.map((row) => <li key={`${row.source}-${row.source_detail}`} className="flex flex-col gap-1 py-3">
                <p className="font-medium">{sourceName(row)}{row.source_detail ? ` · ${row.source_detail}` : ""}</p>
                <p className="text-sm text-muted-foreground">{row.leads} lead{row.leads === 1 ? "" : "s"} · {row.submissions} submission{row.submissions === 1 ? "" : "s"} · last {ago(row.last_at).toLowerCase()}</p>
              </li>)}
            </ul>
            <TableSurface className="hidden md:block">
              <Table>
                <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>From</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Submissions</TableHead><TableHead>Last submission</TableHead></TableRow></TableHeader>
                <TableBody>{rows.map((row) => <TableRow key={`${row.source}-${row.source_detail}`}>
                  <TableCell className="font-medium">{sourceName(row)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{row.source_detail ?? "—"}</TableCell>
                  <TableCell className="text-right">{row.leads}</TableCell>
                  <TableCell className="text-right">{row.submissions}</TableCell>
                  <TableCell>{ago(row.last_at)}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </TableSurface>
          </>}
      </CardContent>
    </Card>
  </div>;
}
