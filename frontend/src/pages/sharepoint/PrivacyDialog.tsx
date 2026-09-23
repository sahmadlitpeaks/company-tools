import { useState } from "react";
import { api } from "@/api/client";
import { type PrivacyRules, readableStatus } from "@/api/sharepoint";
import { useFetch } from "@/hooks/useApi";
import { Loading, Modal, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function PrivacyForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: PrivacyRules;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [policy, setPolicy] = useState(initial.policy);
  const [terms, setTerms] = useState(() =>
    initial.terms.map((term) => `${term.kind}: ${term.value}`).join("\n")
  );
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const parsed = terms
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const separator = line.indexOf(":");
          if (separator < 0) throw new Error("Use TYPE: value on each line (e.g. PERSON: John Doe).");
          return {
            kind: line.slice(0, separator).trim().toUpperCase(),
            value: line.slice(separator + 1).trim(),
          };
        });
      const result = await api<{ changed: boolean }>("/api/sharepoint/rules", { method: "PUT", body: { policy, terms: parsed } });
      notify(result.changed ? "Privacy policy saved. Document processing queued." : "Privacy policy is already up to date.");
      onSaved();
    } catch (error) {
      notify(readableStatus(error instanceof Error ? error.message : "Save failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4 p-4">
      <Alert className="border-border bg-muted/40">
        <AlertDescription className="text-xs sm:text-sm text-foreground">
          Changing these rules clears existing analyses and approvals, then queues document processing. Saving without changes keeps processed documents intact.
        </AlertDescription>
      </Alert>

      <FieldGroup className="space-y-4">
        <Field className="space-y-1.5">
          <FieldLabel htmlFor="sharepoint-policy" className="text-sm font-semibold text-foreground">
            AI Privacy Mode
          </FieldLabel>
          <Select
            value={policy}
            onValueChange={(value) => {
              if (value) setPolicy(value as PrivacyRules["policy"]);
            }}
          >
            <SelectTrigger id="sharepoint-policy" className="h-10 text-xs sm:text-sm w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="auto" className="text-xs sm:text-sm py-2">
                  Automatic (Clean private data locally & analyze immediately)
                </SelectItem>
                <SelectItem value="review" className="text-xs sm:text-sm py-2">
                  Manual Review (Review redacted text before AI analysis)
                </SelectItem>
                <SelectItem value="test" className="text-xs sm:text-sm py-2">
                  Approved Test Corpus (Non-confidential test material)
                </SelectItem>
                <SelectItem value="skip" className="text-xs sm:text-sm py-2">
                  Disable AI Processing (Do not analyze with external AI)
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="sharepoint-terms" className="text-sm font-semibold text-foreground">
            Additional private names and terms
          </FieldLabel>
          <Textarea
            id="sharepoint-terms"
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            rows={7}
            placeholder={"PERSON: Example Name\nPROJECT: Internal Project Name\nORGANIZATION: Partner Corp"}
            className="text-xs sm:text-sm font-mono leading-relaxed"
          />
          <p className="text-xs text-muted-foreground leading-relaxed">
            One <strong>TYPE: value</strong> per line. Supported types: <code>PERSON</code>, <code>CLIENT</code>, <code>PROJECT</code>, <code>ORGANIZATION</code>, <code>ADDRESS</code>, <code>VALUE</code>, <code>CONFIDENTIAL</code>.
          </p>
        </Field>
      </FieldGroup>

      {policy === "auto" && (
        <Alert className="border-sky-500/30 bg-sky-500/10">
          <AlertDescription className="text-xs sm:text-sm text-foreground">
            <strong>Automatic Mode:</strong> Sensitive names, emails, and financial figures are automatically redacted locally before sending text to the AI document assistant.
          </AlertDescription>
        </Alert>
      )}

      {policy === "test" && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <AlertDescription className="text-xs sm:text-sm text-foreground">
            This applies to every file in the configured folder. Use only when the folder contains non-confidential material.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
          className="h-10 px-4 text-xs sm:text-sm"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="h-10 px-5 text-xs sm:text-sm font-semibold"
        >
          {busy ? "Saving…" : "Save Privacy Policy"}
        </Button>
      </div>
    </form>
  );
}

export default function PrivacyDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const rules = useFetch<PrivacyRules>("/api/sharepoint/rules");

  return (
    <Modal
      title="Document Privacy Policy"
      description="Configure local data sanitization and external AI processing rules."
      onClose={onClose}
      maxWidth={650}
    >
      {rules.loading ? (
        <div className="p-6">
          <Loading />
        </div>
      ) : rules.error ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertDescription className="text-xs sm:text-sm">{readableStatus(rules.error)}</AlertDescription>
          </Alert>
        </div>
      ) : rules.data ? (
        <PrivacyForm initial={rules.data} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Modal>
  );
}
