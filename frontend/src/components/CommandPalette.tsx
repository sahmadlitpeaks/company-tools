import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Headphones,
  Package,
  Plus,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api/client";
import type { SearchHit, SearchResults } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { visibleNavGroups, type NavItem } from "./navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

interface NavCommand {
  id: string;
  label: string;
  to: string;
  module?: string;
  create?: boolean;
  adminOrManager?: boolean;
}

const CREATE_COMMANDS: NavCommand[] = [
  { id: "new-task", label: "New task", to: "/tasks?new=1", module: "tasks", create: true },
  { id: "new-ticket", label: "New ticket", to: "/service-desk?new=1", module: "service_desk", create: true },
  { id: "new-approval", label: "New request (approval)", to: "/approvals?new=1", module: "approvals", create: true },
  { id: "new-ann", label: "New announcement", to: "/announcements?new=1", module: "announcements", create: true, adminOrManager: true },
];

export const ROUTINE_NAV_ITEMS: NavItem[] = [
  {
    to: "/routine-checks",
    label: "Routine Checks",
    icon: ClipboardCheck,
    module: "routine_checks",
    keywords: ["rounds", "recurring", "inspections"],
  },
  {
    to: "/checklists",
    label: "Checklists",
    icon: ClipboardList,
    module: "routine_checks",
    keywords: ["templates", "routine checks", "recurring"],
  },
];

const RESULT_GROUP: Record<string, string> = {
  person: "People",
  task: "Projects & tasks",
  ticket: "Tickets",
  knowledge: "Knowledge",
  document: "Documents",
  asset: "Marketing assets",
  brochure: "Products & brochures",
  product: "Products & brochures",
  idea: "Feedback & ideas",
  lost_found: "Lost & found",
};

const RESULT_ICON: Record<string, LucideIcon> = {
  person: Users,
  task: CheckSquare,
  ticket: Headphones,
  knowledge: BookOpen,
  document: FileText,
  asset: FileText,
  brochure: Package,
  product: Package,
  idea: BookOpen,
  lost_found: Search,
};

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const isManager = user?.is_admin || user?.role === "manager";
  // Ignore the same click that opened the palette (Base UI outsidePress).
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  function handleOpenChange(
    next: boolean,
    details?: { reason?: string },
  ) {
    // Same click that opened the dialog is often reported as outsidePress /
    // focusOut and would close it immediately (common when opening from the
    // expanded sidebar search control).
    const reason = details?.reason;
    if (
      !next &&
      (reason === "outsidePress" || reason === "focusOut") &&
      openedAtRef.current &&
      Date.now() - openedAtRef.current < 400
    ) {
      return;
    }
    onOpenChange(next);
  }

  const createCommands = useMemo(
    () =>
      CREATE_COMMANDS.filter(
        (c) => (!c.module || can(c.module)) && (!c.adminOrManager || isManager)
      ),
    [can, isManager]
  );

  const navGroups = useMemo(() => {
    const groups = visibleNavGroups(!!user?.is_admin, can);
    const knownPaths = new Set(
      groups.flatMap((group) => group.items.map((item) => item.to)),
    );
    const routineItems = ROUTINE_NAV_ITEMS.filter(
      (item) =>
        !knownPaths.has(item.to) && (!item.module || can(item.module)),
    );
    if (routineItems.length > 0) {
      const requestsIndex = groups.findIndex(
        (group) => group.section === "Requests & Support",
      );
      const routineGroup = { section: "Routine Operations", items: routineItems };
      groups.splice(
        requestsIndex >= 0 ? requestsIndex + 1 : groups.length,
        0,
        routineGroup,
      );
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          [item.label, group.section, ...(item.keywords ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [q, user?.is_admin, can]);

  const navCount = navGroups.reduce((total, group) => total + group.items.length, 0);

  const filteredCreate = useMemo(() => {
    if (!q.trim()) return createCommands;
    const needle = q.toLowerCase();
    return createCommands.filter((c) => c.label.toLowerCase().includes(needle));
  }, [q, createCommands]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function run(to: string) {
    openedAtRef.current = 0;
    onOpenChange(false);
    navigate(to);
  }

  const hitGroups = hits.reduce<Record<string, SearchHit[]>>((all, hit) => {
    const group = RESULT_GROUP[hit.kind] ?? "Other";
    (all[group] ??= []).push(hit);
    return all;
  }, {});

  const hasAny =
    filteredCreate.length > 0 || navCount > 0 || hits.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} className="sm:max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search people, tools, tasks, tickets and files…"
          value={q}
          onValueChange={setQ}
        />
        <CommandList className="max-h-80 p-1">
          {!hasAny && <CommandEmpty>No matches.</CommandEmpty>}
          {filteredCreate.length > 0 && (
            <CommandGroup heading="Create">
              {filteredCreate.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`create-${c.id}-${c.label}`}
                  onSelect={() => run(c.to)}
                >
                  <Plus />
                  <span>{c.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {filteredCreate.length > 0 && navCount > 0 && <CommandSeparator />}
          {navGroups.map((group) => (
            <CommandGroup key={group.section} heading={group.section}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`nav-${group.section}-${item.label}-${(item.keywords ?? []).join("-")}`}
                  onSelect={() => run(item.to)}
                >
                  <item.icon strokeWidth={1.5} />
                  <span>{item.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Tool</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {hits.length > 0 && (
            <>
              {(filteredCreate.length > 0 || navCount > 0) && (
                <CommandSeparator />
              )}
              {Object.entries(hitGroups).map(([group, groupHits]) => (
                <CommandGroup key={group} heading={group}>
                  {groupHits.map((h) => {
                    const Icon = RESULT_ICON[h.kind] ?? FileText;
                    return (
                      <CommandItem
                        key={`${h.kind}-${h.id}`}
                        value={`hit-${h.kind}-${h.id}-${h.title}`}
                        onSelect={() => run(h.href)}
                      >
                        <Icon />
                        <span className="min-w-0 truncate">
                          {h.title}
                          {h.subtitle ? (
                            <span className="ml-2 text-foreground/75">{h.subtitle}</span>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
