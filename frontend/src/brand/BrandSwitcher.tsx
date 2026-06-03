import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBrand } from "./BrandContext";

function Swatch({ color, src }: { color: string; src?: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-5 w-5 flex-none rounded object-contain"
      />
    );
  }
  return (
    <span
      className="h-4 w-4 flex-none rounded-full ring-1 ring-black/10"
      style={{ background: color }}
    />
  );
}

export default function BrandSwitcher() {
  const { brands, active, setActive } = useBrand();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!active) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-1.5 hover:bg-slate-50"
        title="Switch brand"
      >
        <Swatch color={active.primary_color} src={active.logo_url} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold sm:block">
          {active.name}
        </span>
        <span className="text-xs text-ink-muted">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[240px] overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-pop">
          <div className="border-b border-[var(--border)] px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Brand
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setActive(b.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 border-0 px-3.5 py-2.5 text-left ${
                  b.id === active.id ? "bg-brand-50" : "bg-white hover:bg-slate-50"
                }`}
              >
                <Swatch color={b.primary_color} src={b.logo_url} />
                <span className="flex-1 truncate font-medium">{b.name}</span>
                {b.id === active.id && <span className="text-brand-600">✓</span>}
              </button>
            ))}
          </div>
          <Link
            to="/branding"
            onClick={() => setOpen(false)}
            className="block border-t border-[var(--border)] px-3.5 py-2.5 text-sm font-medium hover:bg-slate-50 hover:no-underline"
          >
            🎨 Brand Center
          </Link>
        </div>
      )}
    </div>
  );
}
