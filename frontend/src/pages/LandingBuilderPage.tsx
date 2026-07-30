import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { Blocks, Copy, GripVertical, X } from "lucide-react";
import { api } from "../api/client";
import type { LandingPage } from "../api/types";
import {
  BLOCK_LABELS,
  type Block,
  type BlockType,
  createBlock,
  parseBlocks,
} from "../landing/blocks";
import { BlockList, BlockView } from "../landing/BlockRenderer";
import { Empty, Loading, useToast } from "../components/ui";
import { useBrand } from "../brand/BrandContext";

const PALETTE: BlockType[] = [
  "hero",
  "heading",
  "text",
  "image",
  "features",
  "cta",
  "form",
  "spacer",
];

const LEAD_FIELDS = ["name", "email", "phone", "message"] as const;

/** Wrap rendered blocks in a minimal HTML document for the public route. */
function exportHtml(title: string, blocks: Block[]): string {
  const body = renderToStaticMarkup(<BlockList blocks={blocks} />);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title><style>body{margin:0}</style></head>
<body>${body}</body></html>`;
}

export default function LandingBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const { active } = useBrand();

  const [page, setPage] = useState<LandingPage | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setRecordStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    api<LandingPage>(`/api/landing-pages/${id}`).then((p) => {
      setPage(p);
      setTitle(p.title);
      setRecordStatus(p.status);
      setBlocks(parseBlocks(p.blocks));
    });
  }, [id]);

  const selected = useMemo(
    () => blocks.find((b) => b.id === selectedId) ?? null,
    [blocks, selectedId],
  );

  function addBlock(type: BlockType) {
    const block = createBlock(type);
    // Seed new hero/CTA blocks with the active brand's colour.
    if (active && (block.type === "hero" || block.type === "cta")) {
      block.bg = active.primary_color;
    }
    setBlocks((b) => [...b, block]);
    setSelectedId(block.id);
  }
  function patchSelected(patch: Partial<Block>) {
    setBlocks((bs) =>
      bs.map((b) => (b.id === selectedId ? ({ ...b, ...patch } as Block) : b)),
    );
  }
  function removeBlock(bid: string) {
    setBlocks((b) => b.filter((x) => x.id !== bid));
    if (selectedId === bid) setSelectedId(null);
  }
  function duplicateBlock(bid: string) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === bid);
      if (i < 0) return bs;
      const copy = { ...bs[i], id: createBlock(bs[i].type).id } as Block;
      return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)];
    });
  }
  function onDrop(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    setBlocks((bs) => {
      const next = [...bs];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  async function save(publish?: boolean) {
    if (!page) return;
    setSaving(true);
    const nextStatus = publish ? "published" : status;
    try {
      await api(`/api/landing-pages/${page.id}`, {
        method: "PATCH",
        body: {
          title,
          status: nextStatus,
          blocks: JSON.stringify(blocks),
          html: exportHtml(title, blocks),
        },
      });
      setRecordStatus(nextStatus);
      notify(publish ? "Page published." : "Draft saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!page) return <Loading />;

  return (
    <div>
      <div className="mb-4 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => navigate("/landing-pages")}>
            ← Back
          </Button>
          <Input aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="max-w-sm font-semibold"
          />
          <Badge variant={status === "published" ? "success" : "secondary"}>{status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "published" && (
            <a
              href={`/p/${page.slug}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View live
            </a>
          )}
          <Button type="button" variant="outline" disabled={saving} onClick={() => save(false)}>
            Save draft
          </Button>
          <Button type="button" disabled={saving} onClick={() => save(true)}>
            Publish
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr_280px]">
        {/* ---- Left: block list + palette ---- */}
        <Card className="self-start lg:sticky lg:top-[84px]">
          <CardHeader><CardTitle>Blocks</CardTitle></CardHeader><CardContent>
          {blocks.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Add blocks below to start building.
            </div>
          )}
          {blocks.map((b, i) => (
            <div
              key={b.id}
              draggable
              onDragStart={() => (dragIndex.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              className={`mb-1.5 flex w-full cursor-grab items-center justify-between border p-1 ${selectedId === b.id ? "border-primary bg-primary/10" : "border-border"}`}
            >
              <Button type="button" variant="ghost" className="flex-1 justify-start" onClick={() => setSelectedId(b.id)}>
                 <GripVertical data-icon="inline-start" aria-hidden="true" /> {BLOCK_LABELS[b.type]}
              </Button>
              <span className="flex gap-1">
                <Button type="button" size="icon-xs" variant="ghost"
                  aria-label="Duplicate"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateBlock(b.id);
                  }}
                >
                   <Copy data-icon="inline-start" />
                </Button>
                <Button type="button" size="icon-xs" variant="destructive"
                  aria-label="Delete"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlock(b.id);
                  }}
                >
                   <X data-icon="inline-start" />
                </Button>
              </span>
            </div>
          ))}
          <h4 className="mb-2 mt-4 font-medium">Add block</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {PALETTE.map((t) => (
              <Button type="button" key={t} size="sm" variant="outline" onClick={() => addBlock(t)}>
                + {BLOCK_LABELS[t]}
              </Button>
            ))}
          </div>
          </CardContent></Card>

        {/* ---- Middle: live preview ---- */}
        <div className="bg-muted p-3">
          <Card className="min-h-[420px] shadow-none">
          <CardContent className="p-0">
          {blocks.length === 0 ? (
            <Empty
              icon={<Blocks />}
              message="Your page preview appears here"
              hint="Add a block from the panel on the left."
            />
          ) : (
            blocks.map((b) => (
              <div
                key={b.id}
                style={{
                  outline:
                    selectedId === b.id ? "2px solid var(--primary)" : "none",
                  outlineOffset: -2,
                  cursor: "pointer",
                }}
              >
                <Button type="button" size="sm" variant="outline" className="m-1" onClick={() => setSelectedId(b.id)}>
                  Edit {BLOCK_LABELS[b.type]}
                </Button>
                <BlockView block={b} />
              </div>
            ))
          )}
          </CardContent>
          </Card>
        </div>

        {/* ---- Right: inspector ---- */}
        <Card className="self-start lg:sticky lg:top-[84px]">
          <CardHeader><CardTitle>
            {selected ? `Edit: ${BLOCK_LABELS[selected.type]}` : "Inspector"}
          </CardTitle></CardHeader><CardContent>
          {!selected ? (
            <div className="text-xs text-muted-foreground">
              Select a block to edit its content.
            </div>
          ) : (
            <FieldGroup><BlockEditor block={selected} patch={patchSelected} /></FieldGroup>
          )}
          </CardContent></Card>
      </div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  area,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {area ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
  );
}

function BlockEditor({
  block,
  patch,
}: {
  block: Block;
  patch: (p: Partial<Block>) => void;
}) {
  switch (block.type) {
    case "hero":
      return (
        <>
          <Text label="Heading" value={block.heading} onChange={(v) => patch({ heading: v })} />
          <Text label="Subheading" area value={block.subheading} onChange={(v) => patch({ subheading: v })} />
          <Text label="Button text" value={block.buttonText} onChange={(v) => patch({ buttonText: v })} />
          <Text label="Button URL" value={block.buttonUrl} onChange={(v) => patch({ buttonUrl: v })} />
          <Color label="Background" value={block.bg} onChange={(v) => patch({ bg: v })} />
          <Color label="Text colour" value={block.color} onChange={(v) => patch({ color: v })} />
          <Field><FieldLabel htmlFor="builder-hero-alignment">Alignment</FieldLabel>
            <Select items={[{ value: "center", label: "Center" }, { value: "left", label: "Left" }]}
              value={block.align}
              onValueChange={(value) => value !== null && patch({ align: value as "left" | "center" })}
            >
              <SelectTrigger id="builder-hero-alignment" aria-label="Alignment" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="center">Center</SelectItem><SelectItem value="left">Left</SelectItem></SelectGroup></SelectContent>
            </Select></Field>
        </>
      );
    case "heading":
    case "text":
      return (
        <>
          <Text label="Content" area value={block.text} onChange={(v) => patch({ text: v })} />
          <Field><FieldLabel htmlFor="builder-text-alignment">Alignment</FieldLabel>
            <Select items={[{ value: "center", label: "Center" }, { value: "left", label: "Left" }]}
              value={block.align}
              onValueChange={(value) => value !== null && patch({ align: value as "left" | "center" })}
            >
              <SelectTrigger id="builder-text-alignment" aria-label="Alignment" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="center">Center</SelectItem><SelectItem value="left">Left</SelectItem></SelectGroup></SelectContent>
            </Select></Field>
        </>
      );
    case "image":
      return (
        <>
          <Text label="Image URL" value={block.url} onChange={(v) => patch({ url: v })} />
          <Text label="Alt text" value={block.alt} onChange={(v) => patch({ alt: v })} />
          <Text label="Caption" value={block.caption} onChange={(v) => patch({ caption: v })} />
        </>
      );
    case "cta":
      return (
        <>
          <Text label="Heading" value={block.heading} onChange={(v) => patch({ heading: v })} />
          <Text label="Subheading" value={block.subheading} onChange={(v) => patch({ subheading: v })} />
          <Text label="Button text" value={block.buttonText} onChange={(v) => patch({ buttonText: v })} />
          <Text label="Button URL" value={block.buttonUrl} onChange={(v) => patch({ buttonUrl: v })} />
          <Color label="Background" value={block.bg} onChange={(v) => patch({ bg: v })} />
        </>
      );
    case "features":
      return (
        <>
          <Text label="Heading" value={block.heading} onChange={(v) => patch({ heading: v })} />
          {block.items.map((it, i) => (
            <Card key={it.id} size="sm"><CardHeader><CardTitle>
                Feature {i + 1}
              </CardTitle></CardHeader><CardContent className="flex flex-col gap-2"><Input aria-label="Feature icon"
                placeholder="Icon"
                value={it.icon}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, icon: e.target.value };
                  patch({ items });
                }}
              />
              <Input aria-label="Title"
                placeholder="Title"
                value={it.title}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, title: e.target.value };
                  patch({ items });
                }}
              />
              <Textarea aria-label="Body"
                rows={2}
                placeholder="Body"
                value={it.body}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, body: e.target.value };
                  patch({ items });
                }}
              />
              <Button type="button" size="sm" variant="destructive"
                onClick={() => patch({ items: block.items.filter((_, j) => j !== i) })}
              >
                Remove
              </Button></CardContent>
            </Card>
          ))}
          <Button type="button" size="sm" variant="outline"
            onClick={() =>
              patch({
                items: [...block.items, { id: crypto.randomUUID(), icon: "sparkles", title: "New feature", body: "Describe it." }],
              })
            }
          >
            + Add feature
          </Button>
        </>
      );
    case "form":
      return (
        <>
          <Text label="Heading" value={block.heading} onChange={(v) => patch({ heading: v })} />
          <Text
            label="Subheading"
            area
            value={block.subheading}
            onChange={(v) => patch({ subheading: v })}
          />
          <FieldSet><FieldLegend>Fields to collect</FieldLegend>
            {LEAD_FIELDS.map((f) => (
              <Field key={f} orientation="horizontal"><Checkbox id={`builder-field-${f}`}
                  checked={block.fields.includes(f)}
                  onCheckedChange={(checked) =>
                    patch({
                      fields: checked
                        ? [...block.fields, f]
                        : block.fields.filter((x) => x !== f),
                    })
                  }
                />
                <FieldLabel htmlFor={`builder-field-${f}`} className="capitalize">{f}</FieldLabel></Field>
            ))}
          </FieldSet>
          <Text
            label="Button text"
            value={block.buttonText}
            onChange={(v) => patch({ buttonText: v })}
          />
          <Text
            label="Success message"
            area
            value={block.successCopy}
            onChange={(v) => patch({ successCopy: v })}
          />
          <Color label="Background" value={block.bg} onChange={(v) => patch({ bg: v })} />
        </>
      );
    case "spacer":
      return (
        <Field><FieldLabel htmlFor="builder-spacer-height">Height: {block.size}px</FieldLabel>
          <Input id="builder-spacer-height" aria-label="range"
            type="range"
            min={8}
            max={160}
            value={block.size}
            onChange={(e) => patch({ size: Number(e.target.value) })}
          /></Field>
      );
  }
}
