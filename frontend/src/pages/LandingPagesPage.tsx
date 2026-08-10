import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import { useFetch } from "../hooks/useApi";
import type { LandingLead } from "../api/types";
import { Monitor, Plus, Smartphone, Sparkles } from "lucide-react";
import DOMPurify from "dompurify";
import { createBlock, parseBlocks, type Block } from "../landing/blocks";
import { BlockList } from "../landing/BlockRenderer";
import {
  ConfirmDialog,
  Empty,
  ListSkeleton,
  Loading,
  Modal,
  PageHead,
  PromptModal,
  useToast,
} from "../components/ui";
import { useBrand } from "../brand/BrandContext";

function AiPageModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, blocks: Block[]) => Promise<void> }) {
  const { active } = useBrand();
  const { notify } = useToast();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  async function generate() {
    const request = prompt.trim();
    if (request.length < 12) {
      notify("Describe the page in a little more detail.", "error");
      return;
    }
    setIsGenerating(true);
    try {
      const title = request.split(/[.!?\n]/)[0].slice(0, 72) || "AI landing page";
      const hero = createBlock("hero");
      if (hero.type === "hero") {
        hero.heading = title;
        hero.subheading = request;
        hero.bg = active?.primary_color ?? hero.bg;
        hero.buttonText = "Get in touch";
        hero.buttonUrl = "#contact";
      }
      const features = createBlock("features");
      if (features.type === "features") features.heading = `Why choose ${active?.name ?? "us"}`;
      const cta = createBlock("cta");
      if (cta.type === "cta") {
        cta.bg = active?.primary_color ?? cta.bg;
        cta.heading = "Ready to learn more?";
      }
      const form = createBlock("form");
      if (form.type === "form") form.heading = "Talk to our team";
      await onCreate(title, [hero, features, cta, form]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't create the AI starter draft.", "error");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Modal title="Build a landing page with AI" maxWidth={620} onClose={onClose}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ai-page-prompt">Describe the page you want</FieldLabel>
          <Textarea id="ai-page-prompt" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: A landing page for Agiomix's new laboratory service, aimed at clinic managers, with three benefits and a consultation form." />
          <FieldDescription>This preview emulates AI generation with a structured, editable starter page. It does not call an external AI provider yet.</FieldDescription>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={isGenerating} onClick={() => void generate()}><Sparkles data-icon="inline-start" /> {isGenerating ? "Building…" : "Build draft"}</Button>
        </div>
      </FieldGroup>
    </Modal>
  );
}

function LeadsModal({ page, onClose }: { page: LandingPage; onClose: () => void }) {
  const { data, loading } = useFetch<LandingLead[]>(
    `/api/landing-pages/${page.id}/leads`,
  );
  return (
    <Modal title={`Leads — ${page.title}`} maxWidth={720} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty message="No leads captured yet. Add a Lead form block and publish the page." />
      ) : (
         <TableSurface><Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Message</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-semibold">{l.name ?? "—"}</TableCell>
                <TableCell>
                  <div>{l.email}</div>
                  <div className="text-muted-foreground">{l.phone}</div>
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal text-muted-foreground"><p className="line-clamp-3">{l.message ?? "—"}</p></TableCell>
                <TableCell className="text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
         </Table></TableSurface>
      )}
    </Modal>
  );
}

function PreviewModal({ page, onClose }: { page: LandingPage; onClose: () => void }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const blocks = parseBlocks(page.blocks);
  return (
    <Modal title={`Preview — ${page.title}`} maxWidth={1040} onClose={onClose}>
      <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-xs text-muted-foreground">
          {page.status === "published" ? (
            <>
              Live at <code>/p/{page.slug}</code> ·{" "}
              <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
                open in new tab ↗
              </a>
            </>
          ) : (
            <>Draft preview — not publicly visible until published.</>
          )}
        </div>
        <ToggleGroup value={[device]} onValueChange={(value) => value[0] && setDevice(value[0] as "desktop" | "mobile")} variant="outline" spacing={0}>
          <ToggleGroupItem value="desktop"
            aria-label="Desktop preview"
          >
            <Monitor data-icon="inline-start" /> Desktop
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile"
            aria-label="Mobile preview"
          >
            <Smartphone data-icon="inline-start" /> Mobile
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid max-h-[70vh] place-items-start overflow-auto bg-muted p-3">
        <Card
          className="mx-auto transition-colors"
          style={{ width: device === "mobile" ? 390 : "100%" }}
        >
          <CardContent className="p-0">
          {blocks.length > 0 ? (
            <BlockList blocks={blocks} />
          ) : page.html ? (
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.html) }} />
          ) : (
            <Empty message="This page has no content yet." />
          )}
          </CardContent>
        </Card>
      </div>
    </Modal>
  );
}

export default function LandingPagesPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { data, loading, reload } = useFetch<LandingPage[]>("/api/landing-pages");
  const [creating, setCreating] = useState(false);
  const [creatingWithAi, setCreatingWithAi] = useState(false);
  const [deleting, setDeleting] = useState<LandingPage | null>(null);
  const [previewing, setPreviewing] = useState<LandingPage | null>(null);
  const [leadsFor, setLeadsFor] = useState<LandingPage | null>(null);

  async function create(title: string) {
    const page = await api<LandingPage>("/api/landing-pages", {
      method: "POST",
      body: { title, status: "draft", blocks: "[]" },
    });
    navigate(`/landing-pages/${page.id}/edit`);
  }

  async function createFromAi(title: string, blocks: Block[]) {
    const page = await api<LandingPage>("/api/landing-pages", {
      method: "POST",
      body: { title, status: "draft", blocks: JSON.stringify(blocks) },
    });
    notify("AI starter draft created. Review and edit every section before publishing.");
    setCreatingWithAi(false);
    navigate(`/landing-pages/${page.id}/edit`);
  }

  async function remove(p: LandingPage) {
    await api(`/api/landing-pages/${p.id}`, { method: "DELETE" });
    notify("Deleted.");
    reload();
  }

  return (
    <div>
      <PageHead
        title="Landing Pages"
        subtitle="Build marketing pages with the block editor, published at /p/{slug}."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setCreatingWithAi(true)}><Sparkles data-icon="inline-start" /> Build with AI</Button>
            <Button type="button" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New page</Button>
          </div>
        }
      />
      {loading ? (
        <ListSkeleton rows={4} />
      ) : !data || data.length === 0 ? (
        <Empty
          icon={<Monitor />}
          message="No landing pages yet"
          hint="Create a page to open the block builder."
          action={
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" /> New page
            </Button>
          }
        />
      ) : (
        <Card className="py-0"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Slug</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Views</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-[24rem] whitespace-normal"><div className="truncate font-semibold" title={p.title}>{p.title}</div></TableCell>
                  <TableCell>
                    <code>/p/{p.slug}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === "published" ? "success" : "secondary"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.view_count}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {p.status === "published" && (
                        <a
                          href={`/p/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({ size: "sm" })}
                        >
                          View
                        </a>
                      )}
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => setPreviewing(p)}
                      >
                        Preview
                      </Button>
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => setLeadsFor(p)}
                      >
                        Leads
                      </Button>
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => navigate(`/landing-pages/${p.id}/edit`)}
                      >
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="destructive"
                        onClick={() => setDeleting(p)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {creating && (
        <PromptModal
          title="New landing page"
          label="Page title"
          placeholder="e.g. Summer Promo"
          submitLabel="Create & open editor"
          onConfirm={create}
          onClose={() => setCreating(false)}
        />
      )}
      {creatingWithAi ? <AiPageModal onClose={() => setCreatingWithAi(false)} onCreate={createFromAi} /> : null}
      {leadsFor && <LeadsModal page={leadsFor} onClose={() => setLeadsFor(null)} />}
      {previewing && (
        <PreviewModal page={previewing} onClose={() => setPreviewing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete landing page"
          message={`Delete "${deleting.title}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
