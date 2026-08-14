import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useToast } from "./ui";

interface FxRates {
  base: string;
  rates: Record<string, string>;
}

// The currencies AG's ad accounts realistically bill in. Others appear once a
// rate exists for them; the backend validates the code format.
const COMMON = ["USD", "EUR", "GBP", "SAR"];

/** Exchange rates used to convert ad spend into the reporting currency. A
 *  currency with no rate fails its provider's sync rather than importing a
 *  wrong number. */
export default function FxRatesSettings() {
  const { notify } = useToast();
  const [base, setBase] = useState("AED");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<FxRates>("/api/settings/fx-rates")
      .then((data) => {
        setBase(data.base);
        const next: Record<string, string> = {};
        for (const code of COMMON) next[code] = data.rates[code] ?? "";
        for (const [code, value] of Object.entries(data.rates)) next[code] = value;
        setDrafts(next);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/fx-rates", { method: "PUT", body: { rates: drafts } });
      notify("Exchange rates saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins aria-hidden="true" /> Exchange rates
        </CardTitle>
        <CardDescription>
          How much 1 unit of each currency is worth in {base}. Ad spend is converted
          on sync. A currency with no rate here will stop that account syncing rather
          than import an unconverted figure.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FieldGroup className="grid gap-2 sm:grid-cols-2">
          {Object.keys(drafts).sort().map((code) => (
            <Field key={code}>
              <FieldLabel htmlFor={`fx-${code}`}>{`1 ${code} = ? ${base}`}</FieldLabel>
              <Input id={`fx-${code}`} inputMode="decimal" placeholder="0.0000"
                value={drafts[code] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [code]: e.target.value }))}
              />
            </Field>
          ))}
        </FieldGroup>
        <Button type="button" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save rates"}
        </Button>
      </CardContent>
    </Card>
  );
}
