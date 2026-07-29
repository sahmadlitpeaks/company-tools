import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  compareAsc,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import {
  ArrowUpRight,
  CalendarDays,
  Clock3,
  List,
  MapPin,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DayButtonProps } from "react-day-picker";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Modal, PageHead } from "../components/ui";
import { useFetch } from "../hooks/useApi";

export type CalEvent = {
  id: string;
  kind: string;
  title: string;
  start: string;
  end?: string;
  subtitle?: string;
  location?: string;
  href?: string;
};

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const AGENDA_LIMIT = 8;
const MONTH_LIST_LIMIT = 14;
const UPCOMING_LIMIT = 6;

const KIND_LABELS: Record<string, string> = {
  anniversary: "Anniversary",
  birthday: "Birthday",
  campaign: "Campaign",
  company: "Company event",
  holiday: "Holiday",
  interview: "Interview",
  leave: "Leave",
  training: "Training",
};

function apiDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function eventStart(event: CalEvent) {
  return parseISO(event.start);
}

function eventEnd(event: CalEvent) {
  return parseISO(event.end ?? event.start);
}

function eventOccursOn(event: CalEvent, date: Date) {
  return !isAfter(eventStart(event), endOfDay(date)) && !isBefore(eventEnd(event), startOfDay(date));
}

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function kindVariant(kind: string): "default" | "secondary" | "destructive" | "success" | "info" | "outline" {
  if (kind === "holiday" || kind === "campaign") return "destructive";
  if (kind === "anniversary" || kind === "training") return "success";
  if (kind === "birthday") return "secondary";
  if (kind === "leave" || kind === "interview") return "info";
  if (kind === "company") return "default";
  return "outline";
}

function eventTime(event: CalEvent) {
  const start = eventStart(event);
  const end = event.end ? eventEnd(event) : null;
  if (DAY_ONLY.test(event.start)) {
    return end && !isSameDay(start, end) ? `All day, through ${format(end, "MMM d")}` : "All day";
  }
  if (!end) return format(start, "p");
  if (isSameDay(start, end)) return `${format(start, "p")} - ${format(end, "p")}`;
  return `${format(start, "MMM d, p")} - ${format(end, "MMM d, p")}`;
}

function EventDayButton({ children, modifiers, ...props }: DayButtonProps) {
  return (
    <CalendarDayButton modifiers={modifiers} {...props}>
      {children}
      {modifiers.hasEvents ? (
        <span className="absolute bottom-1 size-1 bg-current opacity-60" aria-hidden="true" />
      ) : null}
    </CalendarDayButton>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<"month" | "list">("month");
  const [add, setAdd] = useState(false);
  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);
  const events = useFetch<CalEvent[]>(
    `/api/calendar?start=${apiDate(monthStart)}&end=${apiDate(monthEnd)}`,
  );
  const canCreate = Boolean(user?.is_admin || user?.role === "manager");
  const sortedEvents = [...(events.data ?? [])].sort((a, b) => compareAsc(eventStart(a), eventStart(b)));
  const selectedEvents = sortedEvents.filter((event) => eventOccursOn(event, selectedDate));
  const datesWithEvents = eachDayOfInterval({ start: monthStart, end: monthEnd }).filter((date) =>
    sortedEvents.some((event) => eventOccursOn(event, date)),
  );
  const eventCountByDate = new Map(
    datesWithEvents.map((date) => [
      apiDate(date),
      sortedEvents.filter((event) => eventOccursOn(event, date)).length,
    ]),
  );
  const today = startOfDay(new Date());
  const upcomingStart = isSameMonth(today, visibleMonth)
    ? today
    : isAfter(monthStart, today)
      ? monthStart
      : null;
  const upcomingEvents = upcomingStart
    ? sortedEvents.filter((event) => !isBefore(eventEnd(event), upcomingStart))
    : [];

  function changeMonth(month: Date) {
    const nextMonth = startOfMonth(month);
    setVisibleMonth(nextMonth);
    if (!isSameMonth(selectedDate, nextMonth)) setSelectedDate(nextMonth);
  }

  function selectToday() {
    const nextToday = startOfDay(new Date());
    setSelectedDate(nextToday);
    setVisibleMonth(startOfMonth(nextToday));
  }

  return (
    <div>
      <PageHead
        title="Company Calendar"
        subtitle="Plan the day around company events, leave, people moments, training, and interviews."
        action={
          <>
            <ToggleGroup
              value={[view]}
              onValueChange={(value) => value[0] && setView(value[0] as "month" | "list")}
              variant="outline"
              spacing={0}
              size="sm"
              aria-label="Calendar view"
            >
              <ToggleGroupItem value="month" aria-label="Month planner">
                <CalendarDays data-icon="inline-start" /> Month
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="Month list">
                <List data-icon="inline-start" /> List
              </ToggleGroupItem>
            </ToggleGroup>
            {canCreate ? (
              <Button type="button" onClick={() => setAdd(true)}>
                <Plus data-icon="inline-start" /> New event
              </Button>
            ) : null}
          </>
        }
      />

      <section className="grid items-start gap-4 lg:grid-cols-12" aria-label="Daily company planner">
        <Card className="lg:col-span-5">
          <CardHeader className="border-b">
            <CardTitle>Choose a date</CardTitle>
            <CardDescription>Dates with a dot have something scheduled.</CardDescription>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              month={visibleMonth}
              onMonthChange={changeMonth}
              selected={selectedDate}
              onSelect={(date) => {
                if (!date) return;
                setSelectedDate(date);
                if (!isSameMonth(date, visibleMonth)) setVisibleMonth(startOfMonth(date));
              }}
              modifiers={{ hasEvents: datesWithEvents }}
              components={{ DayButton: EventDayButton }}
              labels={{
                labelDayButton: (date, modifiers) => {
                  const count = eventCountByDate.get(apiDate(date)) ?? 0;
                  return `${format(date, "EEEE, MMMM d, yyyy")}${modifiers.today ? ", today" : ""}${
                    count ? `, ${count} ${count === 1 ? "event" : "events"}` : ""
                  }`;
                },
              }}
              className="w-full p-0 [--cell-size:--spacing(9)] sm:[--cell-size:--spacing(10)]"
              classNames={{ root: "w-full", month_grid: "w-full border-collapse" }}
              aria-label="Company calendar date picker"
            />
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 bg-foreground/60" aria-hidden="true" /> Event scheduled
            </div>
            <Button type="button" variant="outline" size="sm" onClick={selectToday}>
              Today
            </Button>
          </CardFooter>
        </Card>

        <Card className="min-h-[24rem] lg:col-span-7">
          <CardHeader className="border-b">
            <CardTitle>
              {view === "month" ? format(selectedDate, "EEEE, MMMM d") : format(visibleMonth, "MMMM yyyy")}
            </CardTitle>
            <CardDescription>
              {view === "month"
                ? selectedEvents.length
                  ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "event" : "events"} on the agenda`
                  : "Selected-day agenda"
                : `${sortedEvents.length} ${sortedEvents.length === 1 ? "event" : "events"} this month`}
            </CardDescription>
            <CardAction>
              <span className="font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {view === "month" ? format(selectedDate, "EEE") : "Schedule"}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            {events.loading ? (
              <AgendaLoading />
            ) : events.error ? (
              <LoadError onRetry={events.reload} />
            ) : view === "month" ? (
              selectedEvents.length ? (
                <EventList events={selectedEvents.slice(0, AGENDA_LIMIT)} showDate={false} />
              ) : (
                <EmptyAgenda
                  title="The day is clear"
                  description="Select a marked date or use the open time for focused work."
                />
              )
            ) : sortedEvents.length ? (
              <EventList events={sortedEvents.slice(0, MONTH_LIST_LIMIT)} showDate />
            ) : (
              <EmptyAgenda
                title="No events this month"
                description="Use the month controls to look ahead or return to today."
              />
            )}
          </CardContent>
          {!events.loading && !events.error && view === "month" && selectedEvents.length > AGENDA_LIMIT ? (
            <CardFooter className="text-muted-foreground">
              Showing {AGENDA_LIMIT} of {selectedEvents.length} events for this day.
            </CardFooter>
          ) : null}
          {!events.loading && !events.error && view === "list" && sortedEvents.length > MONTH_LIST_LIMIT ? (
            <CardFooter className="text-muted-foreground">
              Showing the first {MONTH_LIST_LIMIT} of {sortedEvents.length} events this month.
            </CardFooter>
          ) : null}
        </Card>
      </section>

      <Card className="mt-4">
        <CardHeader className="border-b">
          <CardTitle>Upcoming</CardTitle>
          <CardDescription>
            {upcomingStart ? `Next on the company calendar in ${format(visibleMonth, "MMMM")}.` : "This month has passed."}
          </CardDescription>
          <CardAction>
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {events.loading ? (
            <AgendaLoading rows={3} />
          ) : events.error ? (
            <LoadError onRetry={events.reload} compact />
          ) : upcomingEvents.length ? (
            <EventList events={upcomingEvents.slice(0, UPCOMING_LIMIT)} showDate />
          ) : (
            <EmptyAgenda
              title="Nothing else coming up"
              description={upcomingStart ? "There are no later events in this month." : "Choose this month or a future month to look ahead."}
            />
          )}
        </CardContent>
        {!events.loading && !events.error && upcomingEvents.length > UPCOMING_LIMIT ? (
          <CardFooter className="text-muted-foreground">
            Showing the next {UPCOMING_LIMIT} of {upcomingEvents.length} events.
          </CardFooter>
        ) : null}
      </Card>

      {add ? (
        <EventModal
          defaultDate={selectedDate}
          onClose={() => setAdd(false)}
          onSaved={() => {
            setAdd(false);
            void events.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function EventList({ events, showDate }: { events: CalEvent[]; showDate: boolean }) {
  return (
    <ol className="divide-y" aria-label={showDate ? "Calendar events" : "Events for selected date"}>
      {events.map((event) => (
        <li className="grid gap-3 px-4 py-4 sm:grid-cols-[6rem_1fr] sm:px-5" key={`${event.kind}-${event.id}`}>
          {showDate ? (
            <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0">
              <span className="font-heading text-2xl font-semibold leading-none tabular-nums">
                {format(eventStart(event), "dd")}
              </span>
              <span className="font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {format(eventStart(event), "EEE, MMM")}
              </span>
            </div>
          ) : (
            <div className="pt-0.5">
              <Badge variant={kindVariant(event.kind)}>{kindLabel(event.kind)}</Badge>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {showDate ? <Badge variant={kindVariant(event.kind)}>{kindLabel(event.kind)}</Badge> : null}
              {event.href ? (
                <Link
                  to={event.href}
                  className="inline-flex min-w-0 items-center gap-1 font-heading text-sm font-semibold underline-offset-4 hover:underline"
                >
                  <span className="truncate">{event.title}</span>
                  <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                </Link>
              ) : (
                <span className="font-heading text-sm font-semibold">{event.title}</span>
              )}
            </div>
            <EventMeta event={event} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function EventMeta({ event }: { event: CalEvent }) {
  const location = event.location ?? (event.kind === "company" ? event.subtitle : undefined);
  const subtitle = location === event.subtitle ? undefined : event.subtitle;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="size-3.5" aria-hidden="true" /> {eventTime(event)}
      </span>
      {location ? (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" aria-hidden="true" /> {location}
        </span>
      ) : null}
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  );
}

function AgendaLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y" role="status" aria-label="Loading calendar events">
      {Array.from({ length: rows }, (_, index) => (
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[6rem_1fr] sm:px-5" key={index}>
          <Skeleton className="h-8 w-16" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadError({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center justify-between gap-4 px-4 py-5" : "grid min-h-64 place-items-center p-6"}>
      <div className={compact ? "flex-1" : "max-w-sm text-center"}>
        <p className="font-heading text-sm font-semibold">Calendar events could not be loaded</p>
        <p className="mt-1 text-xs text-muted-foreground">Check your connection and try this month again.</p>
        {!compact ? (
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" /> Try again
          </Button>
        ) : null}
      </div>
      {compact ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

function EmptyAgenda({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-48 place-items-center p-6 text-center">
      <div className="max-w-sm">
        <CalendarDays className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 font-heading text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function EventModal({
  defaultDate,
  onClose,
  onSaved,
}: {
  defaultDate: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultDay = apiDate(defaultDate);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(`${defaultDay}T09:00`);
  const [end, setEnd] = useState(`${defaultDay}T10:00`);
  const [location, setLocation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await api("/api/calendar/events", {
        method: "POST",
        body: {
          title,
          starts_at: new Date(start).toISOString(),
          ends_at: end ? new Date(end).toISOString() : null,
          location: location || null,
        },
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The event could not be created.");
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New company event" onClose={onClose}>
      <form onSubmit={submit} aria-busy={isSubmitting || undefined} className="flex flex-col gap-5">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="rd-calendarpage-title">Title</FieldLabel>
            <Input
              id="rd-calendarpage-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="rd-calendarpage-starts">Starts</FieldLabel>
              <Input
                id="rd-calendarpage-starts"
                required
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                disabled={isSubmitting}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-calendarpage-ends">Ends</FieldLabel>
              <Input
                id="rd-calendarpage-ends"
                type="datetime-local"
                value={end}
                min={start || undefined}
                onChange={(event) => setEnd(event.target.value)}
                disabled={isSubmitting}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="rd-calendarpage-location">Location</FieldLabel>
            <Input
              id="rd-calendarpage-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={isSubmitting}
              placeholder="Office, room, or video link"
            />
          </Field>
        </FieldGroup>
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create event"}
        </Button>
      </form>
    </Modal>
  );
}
