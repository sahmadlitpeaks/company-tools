import { Link } from "react-router-dom";
import { CalendarOff, Cake, PartyPopper, UserPlus } from "lucide-react";
import type { Celebration, HomeFeed as HomeFeedData } from "../api/types";
import { useFetch } from "../hooks/useApi";

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

function Avatar({ name, url, size = 36 }: { name?: string | null; url?: string | null; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{ height: size, width: size, background: colorFor(name ?? "?"), fontSize: size * 0.38 }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

function kindIcon(k: string) {
  if (k === "birthday") return <Cake size={14} className="text-pink-500" />;
  if (k === "anniversary") return <PartyPopper size={14} className="text-amber-500" />;
  return <UserPlus size={14} className="text-emerald-500" />;
}

export default function HomeFeed() {
  const { data } = useFetch<HomeFeedData>("/api/me/home");
  if (!data) return null;
  const cels = data.celebrations ?? [];
  const out = data.whos_out ?? [];
  if (cels.length === 0 && out.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h3 className="mt-0 inline-flex items-center gap-2"><PartyPopper size={18} className="text-brand-600" /> Celebrations</h3>
        {cels.length === 0 ? (
          <p className="muted text-sm">Nothing coming up.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {cels.slice(0, 8).map((c: Celebration) => (
              <Link key={c.user_id + c.kind} to={`/people/${c.user_id}`} className="flex items-center gap-3 py-2 hover:bg-slate-50">
                <Avatar name={c.name} url={c.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="muted inline-flex items-center gap-1 text-xs">{kindIcon(c.kind)} {c.detail}</div>
                </div>
                <span className="badge">{c.label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mt-0 inline-flex items-center gap-2"><CalendarOff size={18} className="text-brand-600" /> Who's out today</h3>
        {out.length === 0 ? (
          <p className="muted text-sm">Everyone's in. 🎉</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {out.map((o) => (
              <Link key={o.user_id} to={`/people/${o.user_id}`} className="flex items-center gap-3 py-2 hover:bg-slate-50">
                <Avatar name={o.name} url={o.avatar_url} />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{o.name}</div></div>
                {o.until && <span className="muted text-xs">until {o.until}</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
