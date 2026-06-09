import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  Plus,
  Search as SearchIcon,
} from "lucide-react";
import { api } from "../api/client";
import type { SearchHit, SearchResults } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface Command {
  id: string;
  label: string;
  hint?: string;
  to: string;
  module?: string;
  create?: boolean;
  adminOrManager?: boolean;
}

const NAV_COMMANDS: Command[] = [
  { id: "go-dash", label: "Dashboard", to: "/", module: "dashboard" },
  { id: "go-dir", label: "Employee Directory", to: "/directory", module: "directory" },
  { id: "go-cards", label: "Digital Cards", to: "/cards", module: "cards" },
  { id: "go-assets", label: "Marketing Assets", to: "/marketing-assets", module: "marketing_assets" },
  { id: "go-brand", label: "Brand Center", to: "/branding", module: "branding" },
  { id: "go-prod", label: "Products & Brochures", to: "/products", module: "products" },
  { id: "go-shared", label: "Shared Links", to: "/shared", module: "shared" },
  { id: "go-crm", label: "Leads (CRM)", to: "/crm", module: "crm" },
  { id: "go-camp", label: "Campaign Studio", to: "/campaigns", module: "campaigns" },
  { id: "go-tracker", label: "Asset Tracker", to: "/asset-tracker", module: "asset_tracker" },
  { id: "go-tasks", label: "Tasks", to: "/tasks", module: "tasks" },
  { id: "go-appr", label: "Approvals", to: "/approvals", module: "approvals" },
  { id: "go-leave", label: "Leave", to: "/leave", module: "approvals" },
  { id: "go-sd", label: "Service Desk", to: "/service-desk", module: "service_desk" },
  { id: "go-kb", label: "Knowledge Base", to: "/knowledge", module: "knowledge" },
  { id: "go-ann", label: "Announcements", to: "/announcements", module: "announcements" },
  { id: "go-qr", label: "QR Codes", to: "/qrcodes", module: "qrcodes" },
  { id: "go-lp", label: "Landing Pages", to: "/landing-pages", module: "landing_pages" },
  { id: "go-sig", label: "Email Signatures", to: "/signatures", module: "signatures" },
  { id: "go-short", label: "URL Shortener", to: "/shortener", module: "shortener" },
  { id: "go-trans", label: "Secure Transfers", to: "/transfers", module: "transfers" },
];

const CREATE_COMMANDS: Command[] = [
  { id: "new-task", label: "New task", to: "/tasks?new=1", module: "tasks", create: true },
  { id: "new-ticket", label: "New ticket", to: "/service-desk?new=1", module: "service_desk", create: true },
  { id: "new-approval", label: "New request (approval)", to: "/approvals?new=1", module: "approvals", create: true },
  { id: "new-ann", label: "New announcement", to: "/announcements?new=1", module: "announcements", create: true, adminOrManager: true },
];

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isManager = user?.is_admin || user?.role === "manager";

  const commands = useMemo(() => {
    const all = [...CREATE_COMMANDS, ...NAV_COMMANDS].filter(
      (c) =>
        (!c.module || can(c.module)) && (!c.adminOrManager || isManager),
    );
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter((c) => c.label.toLowerCase().includes(needle));
  }, [q, can, isManager]);

  // Document search (debounced).
  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [q]);

  // Flatten commands + hits for arrow navigation.
  const rows = useMemo(
    () => [
      ...commands.map((c) => ({ type: "cmd" as const, cmd: c })),
      ...hits.map((h) => ({ type: "hit" as const, hit: h })),
    ],
    [commands, hits],
  );

  function run(i: number) {
    const row = rows[i];
    if (!row) return;
    onClose();
    if (row.type === "cmd") navigate(row.cmd.to);
    else navigate(row.hit.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]"
      style={{ background: "rgba(8,12,22,.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-2xl shadow-pop"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <SearchIcon size={16} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search or jump to… (try 'new task')"
            className="!border-0 !bg-transparent !px-1 !py-3 focus:!shadow-none"
            style={{ outline: "none" }}
          />
          <kbd className="muted hidden text-xs sm:block">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-muted">
              No matches.
            </div>
          )}
          {rows.map((row, i) => {
            const selected = i === active;
            const base =
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm";
            const bg = selected ? { background: "var(--surface-2)" } : undefined;
            if (row.type === "cmd") {
              const Icon = row.cmd.create ? Plus : ArrowRight;
              return (
                <button
                  key={row.cmd.id}
                  className={base}
                  style={bg}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(i)}
                >
                  <span
                    className="grid h-6 w-6 flex-none place-items-center rounded-md"
                    style={{ background: "var(--brand-50)", color: "var(--brand-600)" }}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="flex-1 font-medium">{row.cmd.label}</span>
                  {selected && <CornerDownLeft size={13} className="text-ink-muted" />}
                </button>
              );
            }
            return (
              <button
                key={`hit-${row.hit.kind}-${row.hit.id}`}
                className={base}
                style={bg}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(i)}
              >
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-slate-100 text-ink-muted">
                  <FileText size={13} />
                </span>
                <span className="flex-1 truncate">
                  {row.hit.title}
                  <span className="muted ml-2 text-xs">{row.hit.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
