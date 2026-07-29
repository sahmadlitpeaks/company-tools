import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import { Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Visitor = {
  id: string;
  visitor_name: string;
  host_name: string;
  office_location: string;
  visit_at: string;
  status: string;
  invitation_url: string;
  token: string;
};

export default function VisitorsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const rows = useFetch<Visitor[]>("/api/visitors");
  const users = useFetch<User[]>("/api/users");
  const [adding, setAdding] = useState(false);
  const manager = user?.is_admin || user?.role === "manager";
  const data = rows.data ?? [];

  async function updateStatus(id: string, status: string) {
    await api(`/api/visitors/${id}/status`, { method: "POST", body: { status } });
    rows.reload();
  }

  return (
    <div>
      <PageHead
        title="Visitors"
        subtitle="Register guests, share secure invitations, and manage arrivals."
        action={
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> Register visitor
          </Button>
        }
      />
      <Card className="py-0">
        <CardContent className="p-0">
          {data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <p className="font-medium">No visitors yet</p>
              <p className="text-sm text-muted-foreground">Register a guest to send a secure invitation.</p>
              <Button type="button" onClick={() => setAdding(true)}>
                <Plus data-icon="inline-start" /> Register visitor
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Visit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invitation</TableHead>
                  {manager ? <TableHead>Queue</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((visitor) => (
                  <TableRow key={visitor.id}>
                    <TableCell className="max-w-[24rem] whitespace-normal">
                      <strong className="block truncate" title={visitor.visitor_name}>{visitor.visitor_name}</strong>
                      <div className="text-xs text-muted-foreground">{visitor.office_location}</div>
                    </TableCell>
                    <TableCell>{visitor.host_name}</TableCell>
                    <TableCell>{new Date(visitor.visit_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={visitor.status === "expected" ? "warning" : visitor.status === "arrived" ? "success" : visitor.status === "checked_out" ? "secondary" : "destructive"}>{visitor.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(`${location.origin}${visitor.invitation_url}`);
                          notify("Invitation copied.");
                        }}
                      >
                        <Copy data-icon="inline-start" /> Copy
                      </Button>
                    </TableCell>
                    {manager ? (
                      <TableCell>
                        {visitor.status === "expected" ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => void updateStatus(visitor.id, "arrived")}>Arrived</Button>
                        ) : visitor.status === "arrived" ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => void updateStatus(visitor.id, "checked_out")}>Check out</Button>
                        ) : "—"}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {adding ? (
        <VisitorModal
          users={users.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            rows.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function VisitorModal({ users, onClose, onSaved }: { users: User[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [at, setAt] = useState("");
  const [host, setHost] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/visitors", {
        method: "POST",
        body: {
          visitor_name: name,
          office_location: location,
          visit_at: new Date(at).toISOString(),
          host_id: host || null,
        },
      });
      onSaved();
    } catch {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Register visitor" onClose={onClose}>
      <form onSubmit={submit} aria-busy={isSubmitting || undefined}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="visitor-name">Visitor name</FieldLabel>
            <Input id="visitor-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visitor-location">Office location</FieldLabel>
            <Input id="visitor-location" required value={location} onChange={(event) => setLocation(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visitor-time">Visit time</FieldLabel>
            <Input id="visitor-time" required type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visitor-host">Host</FieldLabel>
            <Select
              items={[{ value: null, label: "Me" }, ...users.map((user) => ({ value: user.id, label: user.display_name ?? user.email }))]}
              value={host || null}
              onValueChange={(value) => setHost(value ?? "")}
            >
              <SelectTrigger id="visitor-host" aria-label="Host" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>Me</SelectItem>
                {users.map((user) => <SelectItem value={user.id} key={user.id}>{user.display_name ?? user.email}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create invitation"}</Button>
        </FieldGroup>
      </form>
    </Modal>
  );
}
