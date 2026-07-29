import { useEffect, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import Attachments from "../components/Attachments";
import { Modal, PageHead } from "../components/ui";

type Report = {
  id: string;
  kind: string;
  description: string;
  location: string;
  item_date: string;
  status: string;
  reporter_id: string;
  reporter_name: string;
  claimant_name?: string;
};

export default function LostFoundPage() {
  const { user } = useAuth();
  const rows = useFetch<Report[]>("/api/lost-found");
  const [add, setAdd] = useState(false);
  const [open, setOpen] = useState<Report | null>(null);
  const [params] = useSearchParams();

  useEffect(() => {
    const found = rows.data?.find((report) => report.id === params.get("open"));
    if (found) setOpen(found);
  }, [rows.data, params]);

  async function claim(report: Report) {
    await api(`/api/lost-found/${report.id}/claim`, { method: "POST" });
    rows.reload();
  }

  async function updateStatus(report: Report, status: string) {
    await api(`/api/lost-found/${report.id}/status`, { method: "POST", body: { status } });
    rows.reload();
    setOpen(null);
  }

  return (
    <div>
      <PageHead
        title="Lost & Found"
        subtitle="Report missing or found items and coordinate a safe return."
        action={<Button type="button" onClick={() => setAdd(true)}><Plus data-icon="inline-start" /> Report item</Button>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(rows.data ?? []).map((report) => (
          <Card
            key={report.id}
          >
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="info">{report.kind}</Badge>
                <Badge variant="secondary">{report.status}</Badge>
              </div>
              <CardTitle>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto max-w-full justify-start whitespace-normal p-0 text-left text-sm"
                  aria-label={`Open lost and found report: ${report.description}`}
                  onClick={() => setOpen(report)}
                >
                  {report.description}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-1 text-muted-foreground">
              <MapPin /> {report.location} · {new Date(report.item_date).toLocaleDateString()}
            </CardContent>
            {report.status === "open" && (
              <CardFooter>
                <Button type="button" className="w-full" onClick={(event) => { event.stopPropagation(); void claim(report); }}>
                  Claim this item
                </Button>
              </CardFooter>
            )}
          </Card>
        ))}
      </div>
      {add && <ReportModal onClose={() => setAdd(false)} onSaved={() => { setAdd(false); rows.reload(); }} />}
      {open && (
        <Modal title={open.description} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-4">
            <p><strong>Reported by:</strong> {open.reporter_name}<br /><strong>Location:</strong> {open.location}<br /><strong>Claimant:</strong> {open.claimant_name ?? "—"}</p>
            <Attachments entityType="lost_found" entityId={open.id} />
            {(user?.is_admin || user?.role === "manager" || open.reporter_id === user?.id) && open.status === "claimed" && (
              <Button type="button" onClick={() => void updateStatus(open, "returned")}>Mark returned</Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState("lost");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/lost-found", { method: "POST", body: { kind, description, location, item_date: new Date(date).toISOString() } });
      onSaved();
    } catch {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Report item" onClose={onClose}>
      <form onSubmit={submit} aria-busy={isSubmitting || undefined} className="flex flex-col gap-4">
        <FieldGroup>
          <Field><FieldLabel htmlFor="lost-found-kind">Report type</FieldLabel><Select items={[{ value: "lost", label: "Lost" }, { value: "found", label: "Found" }]} value={kind} onValueChange={(value) => setKind(value ?? "")}><SelectTrigger id="lost-found-kind" aria-label="Report type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="lost">Lost</SelectItem><SelectItem value="found">Found</SelectItem></SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="lost-found-description">Description</FieldLabel><Textarea id="lost-found-description" required value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="lost-found-location">Location</FieldLabel><Input id="lost-found-location" required value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="lost-found-date">Date</FieldLabel><Input id="lost-found-date" required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Publishing…" : "Publish report"}</Button>
      </form>
    </Modal>
  );
}
