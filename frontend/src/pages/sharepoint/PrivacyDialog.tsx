import { useState } from "react";
import { api } from "@/api/client";
import { type PrivacyRules, readableStatus } from "@/api/sharepoint";
import { useFetch } from "@/hooks/useApi";
import { Loading, Modal, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function PrivacyForm({ initial, onSaved }: { initial: PrivacyRules; onSaved: () => void }) {
  const [policy, setPolicy] = useState(initial.policy);
  const [terms, setTerms] = useState(() => initial.terms.map((term) => `${term.kind}: ${term.value}`).join("\n"));
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const parsed = terms.split("\n").filter((line) => line.trim()).map((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) throw new Error("Use TYPE: value on each line.");
        return { kind: line.slice(0, separator).trim().toUpperCase(), value: line.slice(separator + 1).trim() };
      });
      await api("/api/sharepoint/rules", { method: "PUT", body: { policy, terms: parsed } });
      notify("Privacy policy saved. Sync to process documents with the new rules."); onSaved();
    } catch (error) { notify(readableStatus(error instanceof Error ? error.message : "Save failed"), "error"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void save(event)} className="space-y-4">
    <Alert><AlertDescription>Saving clears existing analyses and approvals for this source. A sync will process the documents again.</AlertDescription></Alert>
    <FieldGroup>
      <Field><FieldLabel htmlFor="sharepoint-policy">External AI policy</FieldLabel>
        <Select value={policy} onValueChange={(value) => { if (value) setPolicy(value as PrivacyRules["policy"]); }}>
          <SelectTrigger id="sharepoint-policy"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
            <SelectItem value="auto">Automatic (Sanitize in memory & Instant AI Analysis)</SelectItem>
            <SelectItem value="review">Manual Review (Review every sanitized payload)</SelectItem>
            <SelectItem value="test">Approved synthetic / nonconfidential test corpus</SelectItem>
            <SelectItem value="skip">Prohibit external AI processing</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
      </Field>
      <Field><FieldLabel htmlFor="sharepoint-terms">Additional private names and terms</FieldLabel>
        <Textarea id="sharepoint-terms" value={terms} onChange={(event) => setTerms(event.target.value)} rows={8} placeholder={"PERSON: Example Name\nPROJECT: Internal Project"} />
        <p className="text-xs text-muted-foreground">One TYPE: value per line. Types: PERSON, CLIENT, PROJECT, ORGANIZATION, ADDRESS, VALUE, CONFIDENTIAL. Names are restored only after checking the viewer’s SharePoint access.</p>
      </Field>
    </FieldGroup>
    {policy === "auto" && <Alert><AlertDescription>Automatic Mode: Documents are automatically sanitized by the Local Privacy Shield and immediately analyzed by Luna AI without requiring manual review approval.</AlertDescription></Alert>}
    {policy === "test" && <Alert><AlertDescription>This applies to every file in the configured folder. Use it only when the entire folder contains approved test material suitable for OpenAI after sanitization.</AlertDescription></Alert>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save privacy policy"}</Button>
  </form>;
}

export default function PrivacyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const rules = useFetch<PrivacyRules>("/api/sharepoint/rules");
  return <Modal title="Document privacy policy" onClose={onClose} maxWidth={650}>
    {rules.loading ? <Loading /> : rules.error ? <Alert variant="destructive"><AlertDescription>{readableStatus(rules.error)}</AlertDescription></Alert> : rules.data && <PrivacyForm initial={rules.data} onSaved={onSaved} />}
  </Modal>;
}
