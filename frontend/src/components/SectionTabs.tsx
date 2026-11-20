import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { findNavItem, sectionTabs, visibleNavGroups } from "./navigation";

/**
 * Tabs across related pages that share one sidebar entry, such as QR codes and
 * short links under "Links & QR" (BRD 9C, NAV-03). Each tab is its own URL, so
 * old links and bookmarks keep working.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const { user, can, hasPermission } = useAuth();
  const tabs = sectionTabs(pathname, visibleNavGroups(Boolean(user?.is_admin), can, user?.role === "manager", hasPermission));
  if (!tabs.length) return null;
  const current = findNavItem(pathname)?.to;
  return <nav aria-label={`${tabs[0].merge?.label ?? "Section"} pages`} className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2">
    {tabs.map((tab) => <Button key={tab.to} role="link" size="sm" variant={tab.to === current ? "secondary" : "ghost"} nativeButton={false}
      render={<Link to={tab.to} aria-current={tab.to === current ? "page" : undefined} />}>
      <tab.icon data-icon="inline-start" aria-hidden="true" />{tab.label}
    </Button>)}
  </nav>;
}
