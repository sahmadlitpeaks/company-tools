import { useEffect, useState } from "react";
import { Database, FlaskConical, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, useToast } from "./ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DemoStatus {
  seeded: boolean;
  records: number;
  allowed: boolean;
  environment: string;
}

/** Admin-only sample-data loader (blocked on production).
 *
 * `variant="banner"` renders the dashed dashboard banner; `variant="card"`
 * renders a settings-page card so the same controls live in both places. */
export default function DemoDataCard({ variant = "banner" }: { variant?: "banner" | "card" }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const [status, setRecordStatus] = useState<DemoStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<"load" | "clear" | null>(null);

  async function load() {
    try {
      setRecordStatus(await api<DemoStatus>("/api/demo/status"));
    } catch {
      setRecordStatus(null);
    }
  }
  useEffect(() => {
    if (!user?.is_admin) return;
    let cancelled = false;
    void api<DemoStatus>("/api/demo/status")
      .then((nextStatus) => {
        if (!cancelled) setRecordStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) setRecordStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.is_admin]);

  // Hidden outright where seeding is blocked (i.e. production) rather than
  // shown as a disabled control — there is nothing an admin can do with it.
  if (!user?.is_admin || !status || !status.allowed) return null;

  async function run(action: "seed" | "clear") {
    setIsSubmitting(true);
    try {
      const r = await api<{ records?: number; removed?: number }>(`/api/demo/${action}`, { method: "POST" });
      notify(action === "seed" ? `Loaded ${r.records} demo records.` : `Removed ${r.removed} demo records.`);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
      setConfirm(null);
    }
  }

  const detail = !status.allowed
    ? `Disabled on this environment (${status.environment}) for safety.`
    : status.seeded
      ? `${status.records} sample records loaded across all modules.`
      : "Populate every screen with realistic sample data to explore the app.";

  const buttons = status.allowed && (
    status.seeded ? (
      <Button type="button" variant="destructive" disabled={isSubmitting} onClick={() => setConfirm("clear")}>
        <Trash2 data-icon="inline-start" /> Remove demo data
      </Button>
    ) : (
      <Button type="button" disabled={isSubmitting} onClick={() => setConfirm("load")}>
        <Database data-icon="inline-start" /> Load demo data
      </Button>
    )
  );

  const modals = (
    <>
      {confirm === "load" && (
        <ConfirmDialog
          title="Load demo data?"
          message="This adds sample users, brands, assets, leads, cards, tickets, onboarding journeys and more across every screen so you can see how it looks. It's clearly tagged and can be removed in one click. Don't use this on production."
          confirmLabel="Load sample data"
          onConfirm={() => run("seed")}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "clear" && (
        <ConfirmDialog
          title="Remove demo data?"
          message="This deletes only the records that were created by the demo loader. Your real data is untouched."
          confirmLabel="Remove"
          danger
          onConfirm={() => run("clear")}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );

  const statusLabel = !status.allowed
    ? "Disabled"
    : status.seeded
      ? "Loaded"
      : "Not loaded";

  if (variant === "card") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical aria-hidden="true" /> Demo / sample data
          </CardTitle>
          <CardDescription>{detail}</CardDescription>
          <CardAction>
            <Badge variant={!status.allowed ? "warning" : status.seeded ? "success" : "secondary"}>
              {statusLabel}
            </Badge>
          </CardAction>
        </CardHeader>
        {(buttons || modals) && <CardContent className="flex flex-wrap gap-2"><p className="sr-only" role="status" aria-live="polite">Demo data status: {statusLabel}. {detail}</p>{buttons}{modals}</CardContent>}
      </Card>
    );
  }

  return (
    <Card size="sm" className="border-dashed">
      <CardHeader className="flex flex-row items-center gap-3">
        <Database className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <CardTitle>Demo / sample data</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </div>
        {buttons && <CardAction className="static self-center">{buttons}</CardAction>}
      </CardHeader>
      <CardContent className="sr-only" role="status" aria-live="polite">Demo data status: {statusLabel}. {detail}</CardContent>
      {modals ? <CardContent className="contents">{modals}</CardContent> : null}
    </Card>
  );
}
