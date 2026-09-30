import { useLocation, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function microsoftConnectHref(returnTo: string) {
  return "/api/sharepoint/connect?" + new URLSearchParams({ return_to: returnTo }).toString();
}
const ERRORS: Record<string, string> = {
  microsoft_connection_failed: "Microsoft connection could not be completed. Start a fresh connection and try again.",
  microsoft_connection_save_failed: "Your Microsoft sign-in succeeded, but the workspace could not save the connection. Try again; if it repeats, ask an administrator to check the backend connection log.",
  microsoft_connection_state_invalid: "This connection attempt expired or belongs to a different workspace session. Start a fresh connection.",
  microsoft_account_mismatch: "Choose the work account linked to your workspace profile and organization. To change an existing document connection, disconnect it in Compliance first.",
  microsoft_consent_required: "Microsoft did not provide the required document access. Ask your Microsoft administrator to approve the SharePoint application.",
};
export function MicrosoftConnectionFeedback() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const error = params.get("microsoft_error");
  if (!error && params.get("connected") !== "1") return null;
  const remaining = new URLSearchParams(params);
  remaining.delete("microsoft_error"); remaining.delete("connected");
  const returnTo = location.pathname + (remaining.size ? "?" + remaining.toString() : "");
  return <Alert role={error ? "alert" : "status"}>
    <AlertDescription className="space-y-2">
      <p>{error ? ERRORS[error] ?? "Microsoft connection could not be completed. Please try again." : "Microsoft connected. Document permissions are being checked."}</p>
      <div className="flex flex-wrap gap-2">
        {error && <Button nativeButton={false} variant="outline" render={<a aria-label="Try Microsoft connection again" href={microsoftConnectHref(returnTo)} />}>Try Microsoft connection again</Button>}
        <Button variant="ghost" onClick={() => setParams(remaining, { replace: true })}>Dismiss</Button>
      </div>
    </AlertDescription>
  </Alert>;
}
