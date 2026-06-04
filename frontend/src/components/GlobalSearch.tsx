import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, FileText, Package, Search } from "lucide-react";
import { api } from "../api/client";
import type { SearchHit, SearchResults } from "../api/types";

const ICON = { brochure: BookOpen, asset: FileText, product: Package } as const;

/** Topbar cross-library search across brochures, assets and products. */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setHits(r.hits);
          setOpen(true);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    navigate(hit.href);
  }

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <Search
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        placeholder="Search documents…"
        className="h-9 w-52 rounded-lg border border-border bg-slate-50 pl-8 pr-3 text-sm focus:w-64 focus:bg-white"
      />
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-80 overflow-auto rounded-xl border border-border bg-white p-1 shadow-pop">
          {hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-ink-muted">
              No matches
            </div>
          ) : (
            hits.map((h) => {
              const Icon = ICON[h.kind];
              return (
                <button
                  key={`${h.kind}-${h.id}`}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
                  onClick={() => go(h)}
                >
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-brand-50 text-brand-600">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {h.title}
                    </span>
                    <span className="block text-xs text-ink-muted">{h.subtitle}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
