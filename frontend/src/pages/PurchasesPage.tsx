import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import { Modal, PageHead } from "../components/ui";

type Purchase = { id: string; item: string; reason: string; vendor?: string; estimated_cost?: string; target_type: string; requester_name: string; approval_status: string; result_id?: string };

export default function PurchasesPage() {
  const { user } = useAuth();
  const rows = useFetch<Purchase[]>("/api/purchases");
  const [add, setAdd] = useState(false);
  const manager = user?.is_admin || user?.role === "manager";

  async function convert(id: string) {
    await api(`/api/purchases/${id}/convert`, { method: "POST", body: {} });
    rows.reload();
  }

  return (
    <div>
      <PageHead title="Purchase Requests" subtitle="Request approval, attach supporting files, and convert approved purchases into records." action={<Button type="button" onClick={() => setAdd(true)}><Plus data-icon="inline-start" /> New request</Button>} />
      <Card className="py-0"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Requester</TableHead><TableHead className="text-right">Estimate</TableHead><TableHead>Approval</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{(rows.data ?? []).map((purchase) => <TableRow key={purchase.id}><TableCell className="max-w-[28rem] whitespace-normal"><strong className="block truncate" title={purchase.item}>{purchase.item}</strong><div className="line-clamp-2 text-xs text-muted-foreground">{purchase.reason}</div></TableCell><TableCell>{purchase.requester_name}</TableCell><TableCell className="text-right tabular-nums">{purchase.estimated_cost ? `AED ${purchase.estimated_cost}` : "—"}</TableCell><TableCell><Badge variant={purchase.approval_status === "approved" ? "success" : purchase.approval_status === "rejected" ? "destructive" : "warning"}>{purchase.approval_status}</Badge></TableCell><TableCell>{purchase.result_id ? <Badge variant="success">Created</Badge> : manager && purchase.approval_status === "approved" ? <Button type="button" size="sm" variant="outline" onClick={() => void convert(purchase.id)}>Mark purchased & create {purchase.target_type}</Button> : "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      {add && <PurchaseModal onClose={() => setAdd(false)} onSaved={() => { setAdd(false); rows.reload(); }} />}
    </div>
  );
}

function PurchaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [item, setItem] = useState("");
  const [reason, setReason] = useState("");
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState("");
  const [type, setType] = useState("asset");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/purchases", { method: "POST", body: { item, reason, vendor: vendor || null, estimated_cost: cost || null, target_type: type } });
      onSaved();
    } catch {
      setIsSubmitting(false);
    }
  }

  return <Modal title="New purchase request" onClose={onClose}><form onSubmit={submit} aria-busy={isSubmitting || undefined} className="flex flex-col gap-4"><FieldGroup><Field><FieldLabel htmlFor="purchase-item">Item *</FieldLabel><Input id="purchase-item" required value={item} onChange={(event) => setItem(event.target.value)} /></Field><Field><FieldLabel htmlFor="purchase-reason">Reason *</FieldLabel><Textarea id="purchase-reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="purchase-vendor">Vendor</FieldLabel><Input id="purchase-vendor" value={vendor} onChange={(event) => setVendor(event.target.value)} /></Field><Field><FieldLabel htmlFor="purchase-cost">Estimated cost</FieldLabel><Input id="purchase-cost" type="number" min="0" value={cost} onChange={(event) => setCost(event.target.value)} /></Field></div><Field><FieldLabel htmlFor="purchase-type">After approval, create</FieldLabel><Select items={[{ value: "asset", label: "Asset" }, { value: "subscription", label: "Subscription" }]} value={type} onValueChange={(value) => setType(value ?? "")}><SelectTrigger id="purchase-type" aria-label="After approval, create" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="asset">Asset</SelectItem><SelectItem value="subscription">Subscription</SelectItem></SelectGroup></SelectContent></Select></Field></FieldGroup><Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit for approval"}</Button></form></Modal>;
}
