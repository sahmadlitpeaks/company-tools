import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ChevronDown,
  KeyRound,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { BrandProvider } from "../brand/BrandContext";
import BrandSwitcher from "../brand/BrandSwitcher";
import NotificationBell from "./NotificationBell";
import CommandPalette, { ROUTINE_NAV_ITEMS } from "./CommandPalette";
import { ChangePasswordModal } from "./ChangePassword";
import { ConfirmDialog } from "./ui";
import { useTheme } from "../theme/ThemeContext";
import { AppSidebar } from "./app-sidebar";
import { currentNavSection, currentNavTitle, NAV_GROUPS } from "./navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export const APP_NAME = "AG Holding";

// AppSidebar owns route navigation in the checkpoint layout, so merge the
// manager routes into the shared source it consumes.
const requestsGroup = NAV_GROUPS.find(
  (group) => group.section === "Requests & Support",
);
if (requestsGroup) {
  const knownPaths = new Set(requestsGroup.items.map((item) => item.to));
  const routineItems = ROUTINE_NAV_ITEMS.filter(
    (item) => !knownPaths.has(item.to),
  );
  const approvalsIndex = requestsGroup.items.findIndex(
    (item) => item.to === "/approvals",
  );
  requestsGroup.items.splice(approvalsIndex + 1, 0, ...routineItems);
}

function initials(name?: string | null, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function SidebarRouteCloser({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, pathname, setOpenMobile]);

  return null;
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const theme = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isDark = theme.mode === "dark";

  const title = currentNavTitle(location.pathname);
  const sectionLabel = currentNavSection(location.pathname) ?? APP_NAME;

  useEffect(() => {
    document.title = `${title} — ${APP_NAME}`;
  }, [title]);

  const name = user?.display_name ?? user?.email;
  const role = user?.is_admin ? "Administrator" : user?.job_title ?? "Employee";

  return (
    <BrandProvider>
      <SidebarProvider>
        <SidebarRouteCloser pathname={location.pathname} />
        <AppSidebar isAdmin={!!user?.is_admin} can={can} />

        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" aria-label="Open navigation menu" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink render={<Link to="/" />}>
                    {sectionLabel}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="size-8 justify-start px-2 text-muted-foreground sm:h-8 sm:w-40 lg:w-64"
                aria-label="Search people, tools, and everything"
                onClick={() => window.setTimeout(() => setPaletteOpen(true), 0)}
              >
                <Search data-icon="inline-start" />
                <span className="hidden min-w-0 flex-1 truncate text-left sm:block">
                  Search people, tools…
                </span>
                <kbd className="ml-auto hidden border bg-muted px-1.5 font-mono text-[10px] text-foreground lg:block">
                  Ctrl K
                </kbd>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={isDark ? "Switch to light" : "Switch to dark"}
                aria-label="Toggle dark mode"
                onClick={theme.toggleMode}
              >
                {isDark ? <Sun /> : <Moon />}
              </Button>
              <div className="hidden lg:block">
                <BrandSwitcher />
              </div>
              <Separator
                orientation="vertical"
                className="mx-1 hidden data-vertical:h-7 data-vertical:self-auto lg:block"
              />
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 min-w-0 justify-start px-1.5"
                      aria-label="Account menu"
                    />
                  }
                >
                  <Avatar className="size-8">
                    <AvatarFallback className="text-foreground">
                      {initials(user?.display_name, user?.email ?? undefined)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden min-w-0 flex-col items-start leading-tight md:flex">
                    <span className="max-w-40 truncate text-sm font-medium">{name}</span>
                    <span className="max-w-40 truncate text-xs text-muted-foreground">{role}</span>
                  </span>
                  <ChevronDown data-icon="inline-end" className="hidden md:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      <span className="block truncate font-medium text-foreground">{name}</span>
                      <span className="block truncate">{user?.email}</span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
                      <KeyRound />
                      Change password
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setSignOutOpen(true)}
                    >
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
            <Outlet />
          </main>
        </SidebarInset>

        {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} />}
        {signOutOpen ? (
          <ConfirmDialog
            title="Sign out"
            message="Sign out of the internal platform on this device?"
            confirmLabel="Sign out"
            onConfirm={logout}
            onClose={() => setSignOutOpen(false)}
          />
        ) : null}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </SidebarProvider>
    </BrandProvider>
  );
}
