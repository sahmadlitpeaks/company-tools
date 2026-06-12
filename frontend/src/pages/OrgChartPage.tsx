import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Network,
  List as ListIcon,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { OrgNode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead } from "../components/ui";

const AVATAR_COLORS = [
  "#0ea5e9", "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name?: string | null): string {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}

function countNodes(nodes: OrgNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.reports), 0);
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export default function OrgChartPage() {
  const { data, loading } = useFetch<OrgNode[]>("/api/people/org-chart");
  const roots = data ?? [];
  const single = roots.length === 1 ? roots[0] : null;
  // Depth to which nodes start expanded; bumping `treeKey` remounts the tree
  // so Expand/Collapse-all resets every node's local toggle state.
  const [openDepth, setOpenDepth] = useState(2);
  const [treeKey, setTreeKey] = useState(0);
  // Default to the indented list: it shows a clean top-down hierarchy with no
  // wide gaps. The visual tree is one click away for those who prefer it.
  const [layout, setLayout] = useState<"tree" | "list">("list");
  const [zoom, setZoom] = useState(1);
  const total = useMemo(() => countNodes(roots), [roots]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  // Click-and-drag panning of the canvas. `moved` lets us cancel an accidental
  // card-click when the gesture was actually a drag.
  const pan = useRef({ active: false, moved: false, x: 0, y: 0, left: 0, top: 0 });
  const [grabbing, setGrabbing] = useState(false);

  function onPanStart(e: React.MouseEvent) {
    if (e.button !== 0) return; // left button only
    const c = scrollRef.current;
    if (!c) return;
    pan.current = {
      active: true,
      moved: false,
      x: e.clientX,
      y: e.clientY,
      left: c.scrollLeft,
      top: c.scrollTop,
    };
  }
  function onPanMove(e: React.MouseEvent) {
    const p = pan.current;
    const c = scrollRef.current;
    if (!p.active || !c) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return; // ignore tiny jitters
    p.moved = true;
    setGrabbing(true);
    c.scrollLeft = p.left - dx;
    c.scrollTop = p.top - dy;
  }
  function onPanEnd() {
    pan.current.active = false;
    setGrabbing(false);
  }
  // If the gesture was a drag, swallow the click so it doesn't open a profile.
  function onPanClickCapture(e: React.MouseEvent) {
    if (pan.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      pan.current.moved = false;
    }
  }

  function setAll(depth: number) {
    setOpenDepth(depth);
    setTreeKey((k) => k + 1);
  }

  /** Scale the tree so its full width fits the visible area. */
  function fitToWidth() {
    const c = scrollRef.current;
    const t = treeRef.current;
    if (!c || !t) return;
    const natural = t.scrollWidth / zoom; // de-scale the current measurement
    if (!natural) return;
    const target = (c.clientWidth - 32) / natural;
    setZoom(clampZoom(Math.min(1, target)));
    c.scrollLeft = 0;
  }

  // Ctrl/⌘ + wheel to zoom the tree, like a design canvas.
  function onWheel(e: React.WheelEvent) {
    if (layout !== "tree" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)));
  }

  return (
    <div>
      <PageHead
        title="Org Chart"
        subtitle="Reporting lines across the company."
        action={
          roots.length > 0 ? (
            <span className="badge inline-flex flex-none items-center gap-1.5">
              <Users size={12} /> {total} people
            </span>
          ) : undefined
        }
      />
      {loading ? (
        <Loading />
      ) : roots.length === 0 ? (
        <Empty
          icon="🌳"
          message="No reporting lines yet"
          hint="Set a manager on people's profiles to build the tree."
        />
      ) : (
        <div className="card !p-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
            {/* Layout switch */}
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]">
              <ToolbarToggle active={layout === "tree"} onClick={() => setLayout("tree")}>
                <Network size={14} /> Tree
              </ToolbarToggle>
              <ToolbarToggle active={layout === "list"} onClick={() => setLayout("list")}>
                <ListIcon size={14} /> List
              </ToolbarToggle>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-sm inline-flex items-center gap-1.5" onClick={() => setAll(99)}>
                <ChevronsUpDown size={14} /> Expand all
              </button>
              <button className="btn btn-sm inline-flex items-center gap-1.5" onClick={() => setAll(1)}>
                <ChevronsDownUp size={14} /> Collapse all
              </button>

              {/* Zoom controls — only meaningful for the tree layout */}
              {layout === "tree" && (
                <div className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--border)]">
                  <ToolbarBtn title="Zoom out" onClick={() => setZoom((z) => clampZoom(z - 0.1))}>
                    <ZoomOut size={15} />
                  </ToolbarBtn>
                  <button
                    className="!rounded-none !border-0 !bg-transparent px-2 py-1.5 text-xs font-semibold tabular-nums"
                    style={{
                      minWidth: 48,
                      borderLeft: "1px solid var(--border)",
                      borderRight: "1px solid var(--border)",
                    }}
                    onClick={() => setZoom(1)}
                    title="Reset to 100%"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <ToolbarBtn title="Zoom in" onClick={() => setZoom((z) => clampZoom(z + 0.1))}>
                    <ZoomIn size={15} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Fit to width" onClick={fitToWidth}>
                    <Maximize2 size={15} />
                  </ToolbarBtn>
                </div>
              )}
            </div>
          </div>

          {layout === "tree" ? (
            <div
              ref={scrollRef}
              className="org-scroll"
              onWheel={onWheel}
              onMouseDown={onPanStart}
              onMouseMove={onPanMove}
              onMouseUp={onPanEnd}
              onMouseLeave={onPanEnd}
              onClickCapture={onPanClickCapture}
              style={{ cursor: grabbing ? "grabbing" : "grab", userSelect: grabbing ? "none" : undefined }}
            >
              <ul
                ref={treeRef}
                className="org-tree"
                key={treeKey}
                style={{ zoom, transition: "zoom 0.1s ease" }}
              >
                {single ? (
                  <Node node={single} depth={0} openDepth={openDepth} />
                ) : (
                  roots.map((n) => (
                    <Node key={n.id} node={n} depth={0} openDepth={openDepth} />
                  ))
                )}
              </ul>
            </div>
          ) : (
            <div className="p-2" key={treeKey}>
              {(single ? [single] : roots).map((n) => (
                <ListNode key={n.id} node={n} depth={0} openDepth={openDepth} />
              ))}
            </div>
          )}
        </div>
      )}
      {layout === "tree" && roots.length > 0 && (
        <p className="muted mt-2 text-xs">
          Tip: click and drag anywhere to pan. Hold <kbd>Ctrl</kbd> (or <kbd>⌘</kbd>) and scroll to zoom.
        </p>
      )}
    </div>
  );
}

function ToolbarToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 !rounded-none !border-0 px-3 py-1.5 text-sm font-medium ${
        active ? "!bg-brand-600 !text-white" : "!bg-transparent text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid !rounded-none !border-0 !bg-transparent place-items-center px-2 py-1.5 text-ink-muted hover:!bg-[var(--surface-2)]"
    >
      {children}
    </button>
  );
}

function Node({
  node,
  depth,
  openDepth,
}: {
  node: OrgNode;
  depth: number;
  openDepth: number;
}) {
  const [open, setOpen] = useState(depth < openDepth);
  const hasReports = node.reports.length > 0;
  const seed = useMemo(() => node.name ?? node.id, [node]);
  const color = colorFor(seed);

  return (
    <li>
      <div className="relative inline-block">
        <Link to={`/people/${node.id}`} className="org-card" style={{ borderTopColor: color }}>
          <span
            className="org-avatar"
            style={{ background: color, boxShadow: "0 0 0 3px var(--surface), 0 0 0 4px var(--border)" }}
          >
            {node.avatar_url ? (
              <img src={node.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(node.name)
            )}
          </span>
          <span className="text-sm font-semibold leading-tight text-ink">{node.name ?? "—"}</span>
          {node.job_title && (
            <span className="muted text-xs leading-tight">{node.job_title}</span>
          )}
          {node.department_name && <span className="badge mt-0.5">{node.department_name}</span>}
          {hasReports && (
            <span
              className="mt-0.5 rounded-full px-2 py-px text-[11px] font-medium"
              style={{
                background: "color-mix(in srgb, var(--accent) 10%, var(--surface))",
                color: "var(--brand-600)",
              }}
            >
              {node.report_count} report{node.report_count > 1 ? "s" : ""}
            </span>
          )}
        </Link>
        {hasReports && (
          <button className="org-toggle" onClick={() => setOpen((v) => !v)} title={open ? "Collapse" : "Expand"}>
            {open ? "−" : "+"}
          </button>
        )}
      </div>
      {hasReports && open && (
        <ul>
          {node.reports.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} openDepth={openDepth} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Vertical, indented layout — fits the page width and scrolls vertically. */
function ListNode({
  node,
  depth,
  openDepth,
}: {
  node: OrgNode;
  depth: number;
  openDepth: number;
}) {
  const [open, setOpen] = useState(depth < openDepth);
  const hasReports = node.reports.length > 0;
  const seed = node.name ?? node.id;
  const color = colorFor(seed);

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg py-1.5 pl-1 pr-2 hover:bg-[var(--surface-2)]">
        <button
          className="grid h-5 w-5 flex-none place-items-center !rounded !border-0 !bg-transparent !p-0 text-ink-muted"
          onClick={() => hasReports && setOpen((v) => !v)}
          style={{ visibility: hasReports ? "visible" : "hidden" }}
          title={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Link
          to={`/people/${node.id}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 hover:no-underline"
        >
          <span
            className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full text-[11px] font-bold text-white"
            style={{ background: color }}
          >
            {node.avatar_url ? (
              <img src={node.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(node.name)
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{node.name ?? "—"}</span>
            {(node.job_title || node.department_name) && (
              <span className="block truncate text-xs text-ink-muted">
                {node.job_title}
                {node.job_title && node.department_name ? " · " : ""}
                {node.department_name}
              </span>
            )}
          </span>
        </Link>
        {hasReports && (
          <span className="badge flex-none">
            {node.report_count} report{node.report_count > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {hasReports && open && (
        <div className="ml-[18px] border-l border-[var(--border)] pl-2">
          {node.reports.map((c) => (
            <ListNode key={c.id} node={c} depth={depth + 1} openDepth={openDepth} />
          ))}
        </div>
      )}
    </div>
  );
}
