import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmClock, Bell, PartyPopper, Settings2, Tag, type LucideIcon } from "lucide-react";
import { api } from "../api/client";
import type { AppNotification } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Cap list length; older items stay on /inbox if needed later. */
const MAX_ITEMS = 12;
/** Max rows visible before the list scrolls (each row sizes to its content). */
const VISIBLE_ROWS = 6;

const ICON: Record<string, LucideIcon> = {
  asset: Tag,
  warranty: AlarmClock,
  info: Bell,
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<{ categories: string[]; muted: string[] } | null>(null);

  async function loadPrefs() {
    try {
      setPrefs(await api<{ categories: string[]; muted: string[] }>("/api/notifications/preferences"));
    } catch {
      /* ignore */
    }
  }

  async function toggleMute(cat: string) {
    if (!prefs) return;
    const muted = prefs.muted.includes(cat)
      ? prefs.muted.filter((c) => c !== cat)
      : [...prefs.muted, cat];
    setPrefs({ ...prefs, muted });
    try {
      await api("/api/notifications/preferences", { method: "PUT", body: { muted } });
    } catch {
      /* ignore */
    }
  }

  const loadCount = useCallback(async () => {
    try {
      const r = await api<{ count: number }>("/api/notifications/unread-count");
      setCount(r.count);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const list = await api<AppNotification[]>("/api/notifications");
      setItems(list.slice(0, MAX_ITEMS));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadCount();
    const t = window.setInterval(loadCount, 60000);
    return () => window.clearInterval(t);
  }, [loadCount]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadItems();
    if (!next) setShowPrefs(false);
  }

  async function openItem(n: AppNotification) {
    if (!n.is_read) {
      try {
        await api(`/api/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        /* ignore */
      }
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
    } catch {
      /* ignore */
    }
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
    setCount(0);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
            title="Notifications"
          />
        }
      >
        <Bell data-icon="inline-start" />
        {count > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 size-4 min-w-4 justify-center p-0 text-[10px]"
          >
            {count > 9 ? "9+" : count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
      >
        <PopoverHeader className="flex flex-row items-start justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <PopoverTitle className="text-base">Notifications</PopoverTitle>
            <PopoverDescription>
              {count > 0 ? `${count} unread` : "You're up to date"}
            </PopoverDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Preferences"
              aria-label="Notification preferences"
              onClick={() => {
                setShowPrefs((v) => !v);
                if (!prefs) void loadPrefs();
              }}
            >
              <Settings2 />
            </Button>
            {count > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()}>
                Mark all read
              </Button>
            )}
          </div>
        </PopoverHeader>
        <Separator />
        {showPrefs && prefs && (
          <>
            <div className="flex flex-col gap-3 p-4">
              <p className="text-xs text-muted-foreground">
                Mute email/Slack/Teams for (in-app stays on):
              </p>
              <div className="flex flex-wrap gap-2">
                {prefs.categories.map((c) => {
                  const muted = prefs.muted.includes(c);
                  return (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={muted ? "outline" : "secondary"}
                      className="capitalize"
                      title={muted ? "Muted — click to enable" : "On — click to mute"}
                      onClick={() => void toggleMute(c)}
                    >
                      {muted ? `Muted · ${c}` : c}
                    </Button>
                  );
                })}
              </div>
            </div>
            <Separator />
          </>
        )}
        {/*
          max-height ≈ VISIBLE_ROWS × ~4.5rem so ~6 items show; each row
          keeps natural height (title + body + time) and longer lists scroll.
        */}
        <div
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight: `calc(${VISIBLE_ROWS} * 4.5rem)` }}
        >
          {items.length === 0 ? (
            <Empty className="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PartyPopper />
                </EmptyMedia>
                <EmptyTitle>You're all caught up</EmptyTitle>
                <EmptyDescription>No new notifications right now.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex list-none flex-col gap-0 p-0 m-0">
              {items.map((n, i) => {
                const CategoryIcon = ICON[n.category] ?? Bell;
                return <li key={n.id} className="m-0 p-0">
                  {i > 0 ? <Separator /> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void openItem(n)}
                    className={cn(
                      "h-auto w-full items-start justify-start gap-3 px-4 py-3 text-left whitespace-normal",
                      "hover:bg-muted/80 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30",
                      !n.is_read && "bg-primary/5"
                    )}
                  >
                    <span
                      className="mt-0.5 grid size-9 shrink-0 place-items-center bg-primary/15 text-base text-foreground leading-none"
                      aria-hidden
                    >
                       <CategoryIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-foreground">
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="mt-1 block text-xs leading-relaxed whitespace-normal text-muted-foreground">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                    {!n.is_read ? (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    ) : null}
                  </Button>
                </li>;
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
