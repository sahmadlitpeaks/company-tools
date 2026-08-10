import { useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { api } from "../api/client";
import type { ShortLink } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, ListSkeleton, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ShortenerPage() {
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<ShortLink[]>("/api/short-links");
  const [form, setForm] = useState({ target_url: "", code: "", campaign: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/short-links", {
        method: "POST",
        body: {
          target_url: form.target_url,
          code: form.code || undefined,
          campaign: form.campaign || undefined,
        },
      });
      notify("Short link created.");
      setForm({ target_url: "", code: "", campaign: "" });
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/short-links/${id}`, { method: "DELETE" });
    reload();
  }

  function copy(code: string) {
    // Short links live under the app's own origin (nginx proxies /s/ to the
    // backend), so build the URL from the current location.
    void navigator.clipboard.writeText(`${window.location.origin}/s/${code}`);
    notify("Short link copied.");
  }

  return (
    <div>
      <PageHead
        title="URL Shortener"
        subtitle="Branded short links with click tracking for campaigns."
      />
      <Card className="mb-5">
        <CardContent>
        <form onSubmit={create}>
          <FieldGroup className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor="short-destination">Destination URL *</FieldLabel>
              <Input id="short-destination"
                required
                placeholder="https://agholding.net/landing"
                value={form.target_url}
                onChange={(e) => set("target_url", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="short-code">Custom code</FieldLabel>
              <Input id="short-code"
                placeholder="optional"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="short-campaign">Campaign</FieldLabel>
              <Input id="short-campaign"
                placeholder="optional"
                value={form.campaign}
                onChange={(e) => set("campaign", e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Shorten"}
            </Button>
          </FieldGroup>
        </form>
        </CardContent>
      </Card>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : !data || data.length === 0 ? (
        <Empty icon={<LinkIcon />} message="No short links yet" hint="Shorten a destination URL above to start tracking clicks." />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
                <TableHead>Short link</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <code>/s/{l.code}</code>
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal break-all text-muted-foreground">
                    {l.target_url}
                  </TableCell>
                  <TableCell>{l.campaign ? <Badge variant="secondary">{l.campaign}</Badge> : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.click_count}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => copy(l.code)}
                      >
                        Copy
                      </Button>
                      <Button type="button" variant="destructive" size="sm"
                        onClick={() => remove(l.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
