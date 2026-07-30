import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMemo, useState } from "react";
import { CalendarPlus, DoorOpen, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../hooks/useApi";
import { Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";

type Space = {
  id: string;
  name: string;
  location: string;
  capacity: number;
  equipment: string[];
  type: string;
};

type Booking = {
  id: string;
  space_name: string;
  purpose: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

function localInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function initialRange(): { starts: string; ends: string } {
  const starts = new Date();
  starts.setSeconds(0, 0);
  starts.setMinutes(Math.ceil(starts.getMinutes() / 30) * 30);
  if (starts.getTime() <= Date.now()) starts.setMinutes(starts.getMinutes() + 30);
  const ends = new Date(starts.getTime() + 60 * 60_000);
  return { starts: localInputValue(starts), ends: localInputValue(ends) };
}

export default function BookingsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const spaces = useFetch<Space[]>("/api/bookings/spaces");
  const bookings = useFetch<Booking[]>("/api/bookings");
  const [space, setSpace] = useState<Space | null>(null);
  const [adding, setAdding] = useState(false);
  const manager = user?.is_admin || user?.role === "manager";
  const spaceItems = spaces.data ?? [];
  const bookingItems = bookings.data ?? [];

  async function cancel(id: string) {
    try {
      await api(`/api/bookings/${id}/cancel`, { method: "POST" });
      notify("Booking cancelled.");
      bookings.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Booking could not be cancelled.", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Room & Desk Booking"
        subtitle="Find an available workspace and reserve it in your local time."
        action={manager ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> Add space
          </Button>
        ) : undefined}
      />

      {spaces.loading ? (
        <Loading />
      ) : spaces.error ? (
        <ErrorState message={spaces.error} onRetry={spaces.reload} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {spaceItems.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{item.name}</CardTitle>
                  <Badge variant="info">{item.type}</Badge>
                </div>
                <CardDescription>
                  {item.location} · capacity {item.capacity}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1">
                {item.equipment.map((equipment) => (
                  <Badge variant="secondary" key={equipment}>{equipment}</Badge>
                ))}
              </CardContent>
              <CardFooter>
                <Button type="button" className="w-full" onClick={() => setSpace(item)}>
                  <CalendarPlus data-icon="inline-start" /> Book
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-6">My Bookings</h2>
      {bookings.loading ? (
        <Loading />
      ) : bookings.error ? (
        <ErrorState message={bookings.error} onRetry={bookings.reload} />
      ) : bookingItems.length === 0 ? (
        <Empty icon={<CalendarPlus />} message="No bookings yet" />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Space</TableHead><TableHead>Purpose</TableHead><TableHead>Time</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {bookingItems.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell><strong>{booking.space_name}</strong></TableCell>
                  <TableCell className="max-w-[28rem] whitespace-normal"><span className="line-clamp-2">{booking.purpose}</span></TableCell>
                  <TableCell>
                    {new Date(booking.starts_at).toLocaleString()} –{" "}
                    {new Date(booking.ends_at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell>
                    {booking.status === "confirmed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void cancel(booking.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </CardContent>
        </Card>
      )}

      {space && (
        <BookModal
          space={space}
          onClose={() => setSpace(null)}
          onSaved={() => {
            setSpace(null);
            bookings.reload();
            notify("Booking confirmed.");
          }}
        />
      )}
      {adding && (
        <SpaceModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            spaces.reload();
            notify("Space added.");
          }}
        />
      )}
    </div>
  );
}

function BookModal({
  space,
  onClose,
  onSaved,
}: {
  space: Space;
  onClose: () => void;
  onSaved: () => void;
}) {
  const range = useMemo(initialRange, []);
  const [purpose, setPurpose] = useState("");
  const [start, setStart] = useState(range.starts);
  const [end, setEnd] = useState(range.ends);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minDateTime = useMemo(() => localInputValue(new Date()), []);

  function updateStart(value: string) {
    setStart(value);
    const startDate = new Date(value);
    const endDate = new Date(end);
    if (!Number.isNaN(startDate.getTime()) && (Number.isNaN(endDate.getTime()) || endDate <= startDate)) {
      setEnd(localInputValue(new Date(startDate.getTime() + 60 * 60_000)));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const startsAt = new Date(start);
    const endsAt = new Date(end);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setError("Choose a valid start and end time.");
      return;
    }
    if (endsAt <= startsAt) {
      setError("End time must be after start time.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api("/api/bookings", {
        method: "POST",
        body: {
          space_id: space.id,
          purpose: purpose.trim(),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Dubai",
        },
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Booking could not be confirmed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Book ${space.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="booking-purpose">Purpose</FieldLabel>
          <Input
            id="booking-purpose"
            required
            autoFocus
            maxLength={500}
            placeholder="What is this booking for?"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="booking-start">Starts</FieldLabel>
            <Input
              id="booking-start"
              required
              type="datetime-local"
              min={minDateTime}
              value={start}
              onChange={(event) => updateStart(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="booking-end">Ends</FieldLabel>
            <Input
              id="booking-end"
              required
              type="datetime-local"
              min={start || minDateTime}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </Field>
        </div>
        </FieldGroup>
        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting || !purpose.trim()}>
          {isSubmitting ? "Confirming…" : "Confirm booking"}
        </Button>
      </form>
    </Modal>
  );
}

function SpaceModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("room");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/bookings/spaces", {
        method: "POST",
        body: { name: name.trim(), location: location.trim(), type, capacity: 1, equipment: [], active: true },
      });
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Space could not be added.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add space" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="space-name">Name</FieldLabel>
          <Input id="space-name" required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="space-location">Location</FieldLabel>
          <Input id="space-location" required value={location} onChange={(event) => setLocation(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="space-type">Type</FieldLabel>
          <Select
            items={[
              { value: "room", label: "Meeting room" },
              { value: "desk", label: "Desk" },
            ]}
            value={type}
            onValueChange={(value) => setType(value ?? "")}
          >
            <SelectTrigger className="w-full" id="space-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="room">Meeting room</SelectItem>
                <SelectItem value="desk">Desk</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        </FieldGroup>
        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting || !name.trim() || !location.trim()}
          aria-label={isSubmitting ? "Adding space" : "Add space"}
        >
          <DoorOpen data-icon="inline-start" /> {isSubmitting ? "Adding…" : "Add space"}
        </Button>
      </form>
    </Modal>
  );
}
