import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
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
import { Loading, useToast } from "../components/ui";

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

  const [page, setPage] = useState<LandingPage | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    api<LandingPage>(`/api/landing-pages/${id}`).then((p) => {
      setPage(p);
      setTitle(p.title);
      setStatus(p.status);
      setBlocks(parseBlocks(p.blocks));
    });
  }, [id]);

  const selected = useMemo(
    () => blocks.find((b) => b.id === selectedId) ?? null,
    [blocks, selectedId],
  );

  function addBlock(type: BlockType) {
    const block = createBlock(type);
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
      setStatus(nextStatus);
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
      <div className="page-head">
        <div className="row" style={{ gap: 10, justifyContent: "flex-start" }}>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => navigate("/landing-pages")}>
            ← Back
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontWeight: 600, maxWidth: 360 }}
          />
          <span className={`badge ${status === "published" ? "green" : ""}`}>{status}</span>
        </div>
        <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
          {status === "published" && (
            <a className="btn btn-sm" href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
              View live
            </a>
          )}
          <button className="btn" style={{ flex: "0 0 auto" }} disabled={saving} onClick={() => save(false)}>
            Save draft
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={saving} onClick={() => save(true)}>
            Publish
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr_280px]">
        {/* ---- Left: block list + palette ---- */}
        <div className="card self-start lg:sticky lg:top-[84px]">
          <h4 style={{ margin: "0 0 10px" }}>Blocks</h4>
          {blocks.length === 0 && (
            <div className="muted" style={{ fontSize: 13 }}>
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
              onClick={() => setSelectedId(b.id)}
              className={selectedId === b.id ? "btn-primary" : "btn"}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                marginBottom: 6,
                cursor: "grab",
              }}
            >
              <span>⠿ {BLOCK_LABELS[b.type]}</span>
              <span style={{ display: "flex", gap: 4 }}>
                <span
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateBlock(b.id);
                  }}
                >
                  ⧉
                </span>
                <span
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlock(b.id);
                  }}
                >
                  ✕
                </span>
              </span>
            </div>
          ))}
          <h4 style={{ margin: "16px 0 8px" }}>Add block</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PALETTE.map((t) => (
              <button key={t} className="btn btn-sm" onClick={() => addBlock(t)}>
                + {BLOCK_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Middle: live preview ---- */}
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-slate-100 p-3 shadow-card">
          <div className="min-h-[420px] overflow-hidden rounded-lg bg-white shadow-soft">
          {blocks.length === 0 ? (
            <div className="empty">
              <div className="text-4xl opacity-70">🧱</div>
              <div className="mt-2 font-semibold text-ink">Your page preview appears here</div>
              <div className="text-sm text-ink-muted">Add a block from the panel on the left.</div>
            </div>
          ) : (
            blocks.map((b) => (
              <div
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                style={{
                  outline:
                    selectedId === b.id ? "2px solid var(--brand)" : "none",
                  outlineOffset: -2,
                  cursor: "pointer",
                }}
              >
                <BlockView block={b} />
              </div>
            ))
          )}
          </div>
        </div>

        {/* ---- Right: inspector ---- */}
        <div className="card self-start lg:sticky lg:top-[84px]">
          <h4 style={{ margin: "0 0 10px" }}>
            {selected ? `Edit: ${BLOCK_LABELS[selected.type]}` : "Inspector"}
          </h4>
          {!selected ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Select a block to edit its content.
            </div>
          ) : (
            <BlockEditor block={selected} patch={patchSelected} />
          )}
        </div>
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
  return (
    <div className="field">
      <label>{label}</label>
      {area ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
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
  return (
    <div className="field">
      <label>{label}</label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
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
          <div className="field">
            <label>Alignment</label>
            <select
              value={block.align}
              onChange={(e) => patch({ align: e.target.value as "left" | "center" })}
            >
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </div>
        </>
      );
    case "heading":
    case "text":
      return (
        <>
          <Text label="Content" area value={block.text} onChange={(v) => patch({ text: v })} />
          <div className="field">
            <label>Alignment</label>
            <select
              value={block.align}
              onChange={(e) => patch({ align: e.target.value as "left" | "center" })}
            >
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </div>
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
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Feature {i + 1}
              </div>
              <input
                placeholder="Icon"
                value={it.icon}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, icon: e.target.value };
                  patch({ items });
                }}
                style={{ marginBottom: 6 }}
              />
              <input
                placeholder="Title"
                value={it.title}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, title: e.target.value };
                  patch({ items });
                }}
                style={{ marginBottom: 6 }}
              />
              <textarea
                rows={2}
                placeholder="Body"
                value={it.body}
                onChange={(e) => {
                  const items = [...block.items];
                  items[i] = { ...it, body: e.target.value };
                  patch({ items });
                }}
              />
              <button
                className="btn-sm btn-danger"
                style={{ marginTop: 6 }}
                onClick={() => patch({ items: block.items.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() =>
              patch({
                items: [...block.items, { icon: "★", title: "New feature", body: "Describe it." }],
              })
            }
          >
            + Add feature
          </button>
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
          <div className="field">
            <label>Fields to collect</label>
            {LEAD_FIELDS.map((f) => (
              <label
                key={f}
                style={{ display: "flex", gap: 8, fontWeight: 400, textTransform: "capitalize" }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={block.fields.includes(f)}
                  onChange={(e) =>
                    patch({
                      fields: e.target.checked
                        ? [...block.fields, f]
                        : block.fields.filter((x) => x !== f),
                    })
                  }
                />
                {f}
              </label>
            ))}
          </div>
          <Text
            label="Button text"
            value={block.buttonText}
            onChange={(v) => patch({ buttonText: v })}
          />
          <Text
            label="Success message"
            area
            value={block.successMessage}
            onChange={(v) => patch({ successMessage: v })}
          />
          <Color label="Background" value={block.bg} onChange={(v) => patch({ bg: v })} />
        </>
      );
    case "spacer":
      return (
        <div className="field">
          <label>Height: {block.size}px</label>
          <input
            type="range"
            min={8}
            max={160}
            value={block.size}
            onChange={(e) => patch({ size: Number(e.target.value) })}
          />
        </div>
      );
  }
}
