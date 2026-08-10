import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useId, useState } from "react";
import { Coffee, Plus, ShoppingBag } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { numericInput } from "../utils/numbers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type MenuItem = { id: string; name: string; description?: string; price?: string; available: boolean };
type Order = { id: string; employee_name?: string; item_name: string; quantity: number; notes?: string; status: string; created_at: string };
const FLOW = ["placed", "preparing", "ready", "collected"];

export default function CafePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const menu = useFetch<MenuItem[]>("/api/cafe/menu");
  const orders = useFetch<Order[]>("/api/cafe/orders");
  const manager = user?.is_admin || user?.role === "manager";
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState<MenuItem | null>(null);
  async function status(order: Order, next: string) {
    try {
      await api(`/api/cafe/orders/${order.id}/status`, { method: "POST", body: { status: next } });
      orders.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Order could not be updated.", "error");
    }
  }
  return (
    <div>
      <PageHead
        title="Café"
        subtitle="Order internally from the office café—no payment required."
        action={
          manager ? (
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" /> Menu item
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {menu.loading ? (
          <Loading />
        ) : (
          (menu.data ?? [])
            .filter((item) => item.available)
            .map((item) => (
              <Card key={item.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <CardTitle>{item.name}</CardTitle>
                  {item.price != null && <Badge variant="info">AED {item.price}</Badge>}
                </CardHeader>
                <CardContent className="text-muted-foreground">{item.description || "Available now"}</CardContent>
                <CardFooter>
                  <Button type="button" className="w-full" onClick={() => setOrdering(item)}>
                    <Coffee data-icon="inline-start" /> Order
                  </Button>
                </CardFooter>
              </Card>
            ))
        )}
      </div>
      <h2 className="mt-6">Orders</h2>
      {(orders.data ?? []).length === 0 ? (
        <Empty icon={<Coffee />} message="No café orders yet" />
      ) : (
        <Card className="py-0"><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                {manager && <TableHead>Employee</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders.data ?? []).map((order) => {
                const next = FLOW[FLOW.indexOf(order.status) + 1];
                return (
                  <TableRow key={order.id}>
                    <TableCell className="max-w-[28rem] whitespace-normal">
                      <strong className="block truncate" title={order.item_name}>
                        {order.quantity}× {order.item_name}
                      </strong>
                      {order.notes && <div className="text-xs text-muted-foreground">{order.notes}</div>}
                    </TableCell>
                    {manager && <TableCell>{order.employee_name}</TableCell>}
                    <TableCell><Badge variant={order.status === "collected" ? "success" : order.status === "ready" ? "info" : order.status === "preparing" ? "warning" : "secondary"}>{order.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {manager && next ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => status(order, next)}>
                          Mark {next}
                        </Button>
                      ) : order.status === "placed" ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => status(order, "cancelled")}
                        >
                          Cancel
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
      {ordering && (
        <OrderModal
          item={ordering}
          onClose={() => setOrdering(null)}
          onSaved={() => {
            setOrdering(null);
            orders.reload();
          }}
        />
      )}
      {adding && (
        <MenuModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            menu.reload();
          }}
        />
      )}
    </div>
  );
}

function OrderModal({
  item,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/cafe/orders", {
        method: "POST",
        body: { menu_item_id: item.id, quantity, notes: notes || null },
      });
      onSaved();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Order ${item.name}`}
      description="No payment required — the café will prepare your order."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : <ShoppingBag data-icon="inline-start" />}
            {isSubmitting ? "Placing…" : "Place order"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${formId}-qty`}>Quantity</FieldLabel>
          <Input
            id={`${formId}-qty`}
            type="number"
            min={1}
            max={20}
            value={quantity}
            onChange={(e) => setQuantity(numericInput(e.target.value, 1))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-notes`}>Notes</FieldLabel>
          <Textarea
            id={`${formId}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Extra ice, no sugar…"
          />
        </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function MenuModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/cafe/menu", {
        method: "POST",
        body: {
          name,
          description: description || null,
          price: price || null,
          available: true,
        },
      });
      onSaved();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title="New menu item"
      description="Add something staff can order from the café menu."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting || !name.trim()}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? "Saving…" : "Add item"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${formId}-name`}>Name *</FieldLabel>
          <Input
            id={`${formId}-name`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-desc`}>Description</FieldLabel>
          <Textarea
            id={`${formId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-price`}>Displayed price (optional)</FieldLabel>
          <Input
            id={`${formId}-price`}
            type="number"
            min="0"
            step=".01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}
