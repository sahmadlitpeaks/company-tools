import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AtSign,
  ExternalLink,
  Globe2,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useBrand } from "../brand/BrandContext";
import { readableForeground } from "@/lib/color";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, apiUrl } from "../api/client";
import type { Company } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const NEW_COMPANY_COLOR = "#38bdf8";
const HEX_COLOR = /^#[\da-f]{6}$/i;

function configuredPalette(company: Company): string[] {
  let extras: string[] = [];
  try {
    const parsed = JSON.parse(company.palette || "[]") as Array<{ hex?: string }>;
    extras = Array.isArray(parsed) ? parsed.map((color) => color.hex || "").filter(Boolean) : [];
  } catch {
    extras = [];
  }
  return [...new Set([
    company.primary_color,
    company.secondary_color,
    company.accent_color,
    ...extras,
  ].filter((color): color is string => Boolean(color)))];
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function websiteLabel(website: string): string {
  return website.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function CompanyCard({
  company,
  isCurrent,
  onEdit,
  onDelete,
}: {
  company: Company;
  isCurrent: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const foreground = readableForeground(company.primary_color);
  const palette = configuredPalette(company);

  return (
    <Card className="h-full gap-0 py-0 transition-shadow hover:shadow-md">
      <div className="h-2 w-full" style={{ background: company.primary_color }} aria-hidden="true" />
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-3 py-4">
        <div
          className="grid size-12 shrink-0 place-items-center overflow-hidden border border-black/10 text-sm font-bold shadow-sm"
          style={{ background: company.primary_color, color: foreground }}
        >
          {company.logo_url ? (
            <img
              src={apiUrl(company.logo_url)}
              alt=""
              className="size-full object-contain p-2"
            />
          ) : (
            company.name.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0 self-center">
          <CardTitle className="truncate text-base font-semibold">{company.name}</CardTitle>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {isCurrent ? <Badge variant="info">Current workspace</Badge> : null}
            <Badge variant={company.is_active ? "success" : "outline"}>
              {company.is_active ? "Active" : "Inactive"}
            </Badge>
            {company.is_default ? <Badge variant="warning">Default</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 pb-4">
        <p className="min-h-10 text-sm leading-5 text-muted-foreground">
          {company.tagline || "No tagline has been added for this company."}
        </p>

        <div
          className="border p-3"
          style={{ background: `color-mix(in srgb, ${company.primary_color} 10%, transparent)` }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Palette className="size-3.5" aria-hidden="true" /> Workspace palette
            </span>
            <code className="max-w-[60%] truncate text-[10px] text-muted-foreground" title={company.primary_color}>
              {company.primary_color}
            </code>
          </div>
          <div
            className="grid h-7 grid-cols-5 overflow-hidden border border-black/10"
            role="img"
            aria-label={`${company.name} resolved color palette`}
          >
            {palette.map((color, index) => (
              <span
                key={`${color}-${index}`}
                style={{ background: color }}
                title={color}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {company.font_family || "DM Sans"} · {company.base_font_size || 16}px base
          </div>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground">
          {company.email_domain ? (
            <div className="flex min-w-0 items-center gap-2">
              <AtSign className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{company.email_domain}</span>
            </div>
          ) : null}
          {company.website ? (
            <div className="flex min-w-0 items-center gap-2">
              <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
              <a
                href={websiteHref(company.website)}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
              >
                <span className="truncate">{websiteLabel(company.website)}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            </div>
          ) : null}
          {!company.email_domain && !company.website ? (
            <span>No domain or website added.</span>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="mt-auto justify-end gap-2 bg-muted/30 py-3">
        <Link to={`/branding?company=${company.id}`} className={buttonVariants({ size: "sm" })}>
          <Palette data-icon="inline-start" /> Brand center
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Pencil data-icon="inline-start" /> Edit
        </Button>
        {!company.is_default ? (
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export default function CompaniesPage() {
  const { notify } = useToast();
  const companies = useFetch<Company[]>("/api/companies");
  const { active, reload: reloadBrands } = useBrand();
  const [editing, setEditing] = useState<Company | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  async function remove(company: Company) {
    if (company.is_default) {
      notify("The default company can't be deleted.", "error");
      return;
    }
    try {
      await api(`/api/companies/${company.id}`, { method: "DELETE" });
      notify("Company deleted.");
      void companies.reload();
      void reloadBrands();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed", "error");
    }
  }

  function closeModal() {
    setAdding(false);
    setEditing(null);
  }

  function refreshCompanies() {
    closeModal();
    void companies.reload();
    void reloadBrands();
  }

  return (
    <div>
      <PageHead
        title="Companies"
        subtitle="Manage company workspaces, identity colors, and routing details."
        action={
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> New company
          </Button>
        }
      />

      {companies.loading ? (
        <Loading />
      ) : (companies.data?.length ?? 0) === 0 ? (
        <Empty message="No companies yet." />
      ) : (
        <div className="grid items-stretch gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {companies.data!.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              isCurrent={company.id === active?.id}
              onEdit={() => setEditing(company)}
              onDelete={() => setDeleteTarget(company)}
            />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <CompanyModal company={editing} onClose={closeModal} onSaved={refreshCompanies} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete company "${deleteTarget.name}"?`}
          message={`Permanently delete the "${deleteTarget.name}" company?`}
          confirmLabel="Delete company"
          danger
          onConfirm={() => remove(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ColorInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = HEX_COLOR.test(value) ? value : "#000000";

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          aria-label={`${label} picker`}
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
          className="w-12 shrink-0 cursor-pointer p-1"
        />
        <Input
          id={id}
          required
          value={value}
          maxLength={7}
          pattern="#[0-9a-fA-F]{6}"
          placeholder="#38bdf8"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono"
        />
      </div>
      <FieldDescription>Stored as a six-digit hex color.</FieldDescription>
    </Field>
  );
}

function CompanyModal({ company, onClose, onSaved }: { company: Company | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    name: company?.name ?? "",
    tagline: company?.tagline ?? "",
    website: company?.website ?? "",
    email_domain: company?.email_domain ?? "",
    primary_color: company?.primary_color ?? NEW_COMPANY_COLOR,
    accent_color: company?.accent_color ?? NEW_COMPANY_COLOR,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const previewAccent = form.primary_color;
  const previewForeground = readableForeground(previewAccent);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const body = {
        name: form.name.trim(),
        tagline: form.tagline || null,
        website: form.website || null,
        email_domain: form.email_domain || null,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
      };
      const saved = company
        ? await api<Company>(`/api/companies/${company.id}`, { method: "PATCH", body })
        : await api<Company>("/api/companies", { method: "POST", body });
      if (logo) {
        const formData = new FormData();
        formData.append("file", logo);
        await api(`/api/companies/${saved.id}/logo`, { method: "POST", form: formData });
      }
      notify(company ? "Company updated." : "Company created.");
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={company ? `Edit ${company.name}` : "New company"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-5">
        <div className="border bg-muted/25 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold">Color preview</div>
              <div className="text-xs text-muted-foreground">Configured hex values and resolved workspace accent</div>
            </div>
            <div
              className="grid size-10 shrink-0 place-items-center text-xs font-bold shadow-sm"
              style={{ background: previewAccent, color: previewForeground }}
              aria-label={`Workspace accent ${previewAccent}`}
            >
              {(form.name || "NC").slice(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ColorPreview label="Configured primary" color={form.primary_color} />
            <ColorPreview label="Configured accent" color={form.accent_color} />
            <ColorPreview label="Workspace accent" color={previewAccent} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Identity colors are sourced from Brand Center so company cards, switchers, QR codes, and marketing tools stay consistent.
          </p>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="rd-companiespage-name">Name *</FieldLabel>
            <Input id="rd-companiespage-name" required value={form.name} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-companiespage-tagline">Tagline</FieldLabel>
            <Input id="rd-companiespage-tagline" value={form.tagline} onChange={(event) => set("tagline", event.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="rd-companiespage-website">Website</FieldLabel>
              <Input id="rd-companiespage-website" placeholder="https://company.com" value={form.website} onChange={(event) => set("website", event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-companiespage-email-domain">Email domain</FieldLabel>
              <Input id="rd-companiespage-email-domain" placeholder="company.com" value={form.email_domain} onChange={(event) => set("email_domain", event.target.value)} />
            </Field>
          </div>
          {company ? (
            <div className="border bg-muted/25 p-3 text-sm text-muted-foreground">
              Company colors, palette, typography, and logo are managed in Brand Center so every module stays in sync.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorInput id="rd-companiespage-primary-color" label="Primary color" value={form.primary_color} onChange={(value) => set("primary_color", value)} />
              <ColorInput id="rd-companiespage-accent-color" label="Accent color" value={form.accent_color} onChange={(value) => set("accent_color", value)} />
            </div>
          )}
          <Field>
            <FieldLabel htmlFor="rd-companiespage-logo">Logo</FieldLabel>
            <Input id="rd-companiespage-logo" type="file" accept="image/*" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} />
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : company ? "Save changes" : "Create company"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ColorPreview({ label, color }: { label: string; color: string }) {
  const previewColor = HEX_COLOR.test(color) || color.startsWith("oklch(") ? color : "transparent";

  return (
    <div className="flex min-w-0 items-center gap-2 border bg-background p-2">
      <span className="size-6 shrink-0 border border-black/10" style={{ background: previewColor }} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[10px] text-muted-foreground">{label}</span>
        <code className="block truncate text-[10px]" title={color}>{color}</code>
      </span>
    </div>
  );
}
