import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SyncRun } from "../api/types";

const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta (Facebook + Instagram)",
  google_ads: "Google Ads",
  tiktok: "TikTok Ads",
};

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Per-provider outcome of the last pull. Rendered only when a provider has
 *  actually run, so it stays invisible for teams not using the integrations. */
export default function SyncStatusStrip({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-3 p-(--card-spacing) sm:flex-row sm:flex-wrap">
        {runs.map((run) => (
          <div key={run.provider} className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              {run.ok ? (
                <CheckCircle2 className="text-success" aria-hidden="true" />
              ) : (
                <AlertCircle className="text-destructive" aria-hidden="true" />
              )}
              <span className="truncate font-semibold">
                {PROVIDER_LABEL[run.provider] ?? run.provider}
              </span>
              <Badge variant={run.ok ? "success" : "destructive"}>
                {run.ok ? "OK" : "Failed"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Last synced {when(run.started_at)}
              {run.ok && ` · ${run.metrics_upserted} rows`}
            </div>
            {!run.ok && run.error && (
              <div className="text-xs break-words text-destructive">{run.error}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
