import { Link } from "react-router-dom";
import { CalendarOff, Cake, PartyPopper, UserPlus } from "lucide-react";
import type { Celebration, HomeFeed as HomeFeedData } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function initials(name?: string | null): string {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}

function Avatar({ name, url, size = 36 }: { name?: string | null; url?: string | null; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center overflow-hidden rounded-full bg-primary/15 font-semibold text-foreground"
      style={{ height: size, width: size, fontSize: size * 0.38 }}
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PartyPopper className="text-primary" /> Celebrations</CardTitle>
        </CardHeader>
        <CardContent>
          {cels.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing coming up.</p>
          ) : (
            <div className="divide-y divide-border">
               {cels.slice(0, 6).map((c: Celebration) => (
                <Link
                  key={c.user_id + c.kind}
                  to={`/people/${c.user_id}`}
                  aria-label={c.name ?? "Person"}
                  title={c.name ?? "Person"}
                   className="flex items-center gap-3 py-2 hover:bg-muted hover:no-underline"
                >
                  <Avatar name={c.name} url={c.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">{kindIcon(c.kind)} {c.detail}</div>
                  </div>
                  <Badge variant="secondary">{c.label}</Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarOff className="text-primary" /> Who's out today</CardTitle>
        </CardHeader>
        <CardContent>
          {out.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <PartyPopper aria-hidden="true" /> Everyone's in.
            </p>
          ) : (
            <div className="divide-y divide-border">
               {out.slice(0, 6).map((o) => (
                <Link
                  key={o.user_id}
                  to={`/people/${o.user_id}`}
                  aria-label={o.name ?? "Person"}
                  title={o.name ?? "Person"}
                   className="flex items-center gap-3 py-2 hover:bg-muted hover:no-underline"
                >
                  <Avatar name={o.name} url={o.avatar_url} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{o.name}</div></div>
                  {o.until && <span className="text-xs text-muted-foreground">until {o.until}</span>}
                 </Link>
               ))}
               {out.length > 6 && (
                 <p className="m-0 pt-3 text-xs text-muted-foreground">+{out.length - 6} more away today</p>
               )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
