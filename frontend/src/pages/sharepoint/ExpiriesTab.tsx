import { useMemo } from "react";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Clock,
  DollarSign,
  FileCode,
  Mail,
  User,
} from "lucide-react";
import type { AnalysisSection, Evidence, SharePointReminder } from "@/api/sharepoint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function ExpirySourceQuotes({
  entries,
  onViewSource,
}: {
  entries: Evidence[];
  onViewSource: (segmentId: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <div className="space-y-1 pt-1.5 border-t border-border/50 text-[11px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground text-[10px] uppercase font-semibold">Sources:</span>
        {entries.map((e) => (
          <Button
            key={`${e.segment_id}:${e.quote.slice(0, 20)}`}
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onViewSource(e.segment_id)}
            className="h-4 px-1 text-[10px] font-mono text-primary hover:bg-primary/10 rounded-none gap-0.5"
            title={`"${e.quote}"`}
          >
            <FileCode className="size-2.5" />
            #{e.segment_id}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ExpiriesTab({
  sections,
  reminders,
  onViewSource,
}: {
  sections: AnalysisSection[];
  reminders: SharePointReminder[];
  onViewSource: (segmentId: string) => void;
}) {
  const expiries = useMemo(() => sections.flatMap((s) => s.expiries || []), [sections]);
  const commercials = useMemo(() => sections.flatMap((s) => s.commercials || []), [sections]);

  // Compute KPI Metrics
  const stats = useMemo(() => {
    let overdueCount = 0;
    let urgentCount = 0;
    const now = Date.now();

    for (const exp of expiries) {
      const days = Math.ceil((new Date(exp.date).getTime() - now) / (1000 * 60 * 60 * 24));
      if (days < 0) overdueCount++;
      else if (days <= 30) urgentCount++;
    }

    // Sum commercial values
    let totalValue = 0;
    let primaryCurrency = "USD";
    for (const com of commercials) {
      if (typeof com.amount === "number") {
        totalValue += com.amount;
        if (com.currency) primaryCurrency = com.currency;
      }
    }

    return {
      totalExpiries: expiries.length,
      overdueCount,
      urgentCount,
      totalCommercialValue: totalValue,
      primaryCurrency,
      totalReminders: reminders.length,
    };
  }, [expiries, commercials, reminders]);

  return (
    <div className="space-y-6">
      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-3 border border-border bg-card space-y-1">
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Calendar className="size-3 text-primary" /> Tracked Expirations
          </span>
          <div className="text-lg font-bold font-mono">{stats.totalExpiries}</div>
          <span className="text-[10px] text-muted-foreground block">Critical dates & renewals</span>
        </div>

        <div className="p-3 border border-border bg-card space-y-1">
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <AlertTriangle className="size-3 text-amber-500" /> Urgent / Overdue
          </span>
          <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
            {stats.overdueCount + stats.urgentCount}
          </div>
          <span className="text-[10px] text-muted-foreground block">
            {stats.overdueCount} overdue · {stats.urgentCount} &le;30 days
          </span>
        </div>

        <div className="p-3 border border-border bg-card space-y-1">
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <DollarSign className="size-3 text-emerald-600" /> Tracked Pricing
          </span>
          <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 truncate">
            {stats.totalCommercialValue > 0
              ? `${stats.totalCommercialValue.toLocaleString()} ${stats.primaryCurrency}`
              : "Not stated"}
          </div>
          <span className="text-[10px] text-muted-foreground block">
            {commercials.length} fee & pricing terms
          </span>
        </div>

        <div className="p-3 border border-border bg-card space-y-1">
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Bell className="size-3 text-sky-600" /> Active Reminders
          </span>
          <div className="text-lg font-bold font-mono">{stats.totalReminders}</div>
          <span className="text-[10px] text-muted-foreground block">Email & Teams dispatches</span>
        </div>
      </div>

      {/* Expiries & Renewals */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
            <Calendar className="size-3.5 text-primary" />
            Document Expirations & Milestones ({expiries.length})
          </h3>
        </div>

        {expiries.length === 0 ? (
          <div className="border border-dashed border-border p-6 text-center space-y-1 text-xs">
            <Clock className="size-6 mx-auto text-muted-foreground opacity-40" />
            <p className="font-medium">No document expiration or renewal dates found</p>
            <p className="text-[11px] text-muted-foreground">
              When documents contain expiration clauses, warranty periods, or renewal terms, they will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {expiries.map((exp) => {
              const daysLeft = Math.ceil((new Date(exp.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const isOverdue = daysLeft < 0;
              const isUrgent = daysLeft <= 30 && daysLeft >= 0;

              return (
                <Card
                  key={`${exp.title}:${exp.date}:${exp.category}`}
                  className="border-border hover:border-border/80 transition-colors"
                >
                  <CardHeader className="p-3 pb-2 border-b border-border/50 bg-muted/20">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle dir="auto" className="text-xs font-semibold leading-snug break-words">
                        {exp.title}
                      </CardTitle>
                      <Badge
                        variant={isOverdue ? "destructive" : isUrgent ? "outline" : "secondary"}
                        className={
                          isUrgent
                            ? "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 rounded-none shrink-0"
                            : "rounded-none shrink-0"
                        }
                      >
                        {isOverdue ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d remaining`}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground flex items-center gap-1 font-mono">
                        <Calendar className="size-3 text-muted-foreground" />
                        Target: <strong className="text-foreground">{exp.date}</strong>
                      </span>
                      <Badge variant="outline" className="uppercase text-[9px] font-mono rounded-none">
                        {exp.category.replace("_", " ")}
                      </Badge>
                    </div>

                    {exp.responsible && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <User className="size-3 shrink-0" />
                        <span>Contact: </span>
                        <span className="text-foreground font-medium" dir="auto">
                          {exp.responsible}
                        </span>
                      </div>
                    )}

                    <ExpirySourceQuotes entries={exp.evidence} onViewSource={onViewSource} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Commercial Terms & Pricing */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
            <DollarSign className="size-3.5 text-emerald-600" />
            Pricing & Commercial Schedules ({commercials.length})
          </h3>
        </div>

        {commercials.length === 0 ? (
          <div className="border border-dashed border-border p-6 text-center space-y-1 text-xs">
            <DollarSign className="size-6 mx-auto text-muted-foreground opacity-40" />
            <p className="font-medium">No pricing or commercial terms detected</p>
            <p className="text-[11px] text-muted-foreground">
              Contract fees, payment milestones, and retainer amounts will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {commercials.map((com) => (
              <Card
                key={`${com.description}:${com.amount ?? "na"}:${com.currency ?? "usd"}`}
                className="border-border hover:border-border/80 transition-colors"
              >
                <CardHeader className="p-3 pb-2 border-b border-border/50 bg-muted/20">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle dir="auto" className="text-xs font-semibold leading-snug break-words">
                      {com.description}
                    </CardTitle>
                    {com.amount !== null && (
                      <Badge
                        variant="outline"
                        className="font-mono text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs py-0.5 rounded-none shrink-0 font-bold"
                      >
                        {com.amount.toLocaleString()} {com.currency || "USD"}
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-3 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    {com.payment_terms && (
                      <div>
                        <span className="block text-[10px] uppercase font-semibold">Terms</span>
                        <span className="text-foreground" dir="auto">
                          {com.payment_terms}
                        </span>
                      </div>
                    )}
                    {com.billing_frequency && com.billing_frequency !== "unknown" && (
                      <div>
                        <span className="block text-[10px] uppercase font-semibold">Frequency</span>
                        <span className="text-foreground capitalize">
                          {com.billing_frequency.replace("_", " ")}
                        </span>
                      </div>
                    )}
                  </div>

                  <ExpirySourceQuotes entries={com.evidence} onViewSource={onViewSource} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Scheduled Reminders */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
            <Bell className="size-3.5 text-sky-600" />
            Scheduled Email & Teams Reminders ({reminders.length})
          </h3>
        </div>

        {reminders.length === 0 ? (
          <div className="border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No automated alerts generated for this document yet. Alerts are scheduled automatically when expirations are indexed.
          </div>
        ) : (
          <div className="border border-border divide-y divide-border text-xs">
            {reminders.map((rem) => (
              <div key={rem.id} className="p-3 flex items-center justify-between gap-3 bg-muted/10 hover:bg-muted/20 transition-colors">
                <div className="space-y-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{rem.title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> Fires {rem.lead_days}d prior ({rem.reminder_date})
                    </span>
                    <span>&middot;</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" /> Due: {rem.target_date}
                    </span>
                    <span>&middot;</span>
                    <span className="flex items-center gap-1 text-foreground">
                      <Mail className="size-3 text-muted-foreground" /> {rem.recipient_email || "Company Admin"}
                    </span>
                  </div>
                </div>

                <Badge
                  variant={rem.status === "sent" ? "default" : rem.status === "dismissed" ? "outline" : "secondary"}
                  className="shrink-0 capitalize font-mono text-[11px] rounded-none"
                >
                  {rem.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
