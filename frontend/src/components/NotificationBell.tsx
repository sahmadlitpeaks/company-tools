import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AppNotification } from "../api/types";

const ICON: Record<string, string> = {
  asset: "🏷",
  warranty: "⏰",
  info: "🔔",
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
  const ref = useRef<HTMLDivElement>(null);

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
      setItems(await api<AppNotification[]>("/api/notifications"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadCount();
    const t = window.setInterval(loadCount, 60000);
    return () => window.clearInterval(t);
  }, [loadCount]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void loadItems();
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
    <div className="bell" ref={ref}>
      <button className="bell-btn" onClick={toggle} title="Notifications">
        🔔
        {count > 0 && <span className="bell-badge">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <div className="bell-menu">
          <div className="bell-head spread">
            <strong>Notifications</strong>
            {count > 0 && (
              <button className="btn-sm" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <div className="bell-list">
            {items.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                You're all caught up. 🎉
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  className={`bell-item ${n.is_read ? "" : "unread"}`}
                  onClick={() => openItem(n)}
                >
                  <span className="bell-icon">{ICON[n.category] ?? "🔔"}</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={{ fontWeight: 600, display: "block" }}>{n.title}</span>
                    {n.body && (
                      <span className="muted" style={{ fontSize: 13 }}>{n.body}</span>
                    )}
                    <span className="muted" style={{ fontSize: 11, display: "block" }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
