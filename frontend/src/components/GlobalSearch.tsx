import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckSquare,
  FileText,
  Headphones,
  Package,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api/client";
import type { SearchHit, SearchResults } from "../api/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  brochure: BookOpen,
  asset: FileText,
  product: Package,
  person: Users,
  task: CheckSquare,
  ticket: Headphones,
  knowledge: BookOpen,
  document: FileText,
  idea: BookOpen,
  lost_found: FileText,
};

const GROUP_LABEL: Record<string, string> = {
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

/** Topbar search — results render in a portaled popover (above page content). */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      setSearched(false);
      setOpen(false);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setHits(r.hits);
          setSearched(true);
          setOpen(true);
        })
        .catch(() => {
          setHits([]);
          setSearched(true);
          setOpen(true);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    setSearched(false);
    navigate(hit.href);
  }

  const groups = hits.reduce<Record<string, SearchHit[]>>((all, hit) => {
    const group = GROUP_LABEL[hit.kind] ?? "Other";
    (all[group] ??= []).push(hit);
    return all;
  }, {});

  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next) => {
        // Controlled by search; only allow close from outside click / Esc.
        if (!next) setOpen(false);
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={<div className="relative hidden md:block" />}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search the platform"
          aria-controls={listId}
          aria-expanded={open}
          role="combobox"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (searched && q.trim()) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search people, work, files…"
          className="h-9 w-52 pl-9 pr-3 text-sm transition-[width] focus:w-72 md:text-sm"
        />
      </PopoverTrigger>
      <PopoverContent
        id={listId}
        align="end"
        side="bottom"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        className="w-96 gap-0 p-0"
      >
        <div className="max-h-96 overflow-y-auto p-2">
          {!searched ? null : hits.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.entries(groups).map(([group, groupHits]) => (
                <div key={group} className="flex flex-col gap-1">
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {group}
                  </div>
                  <div className="flex flex-col gap-1">
                    {groupHits.map((h) => {
                      const Icon = ICON[h.kind] ?? FileText;
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={`${h.kind}-${h.id}`}
                          className={cn(
                            "h-auto w-full items-start justify-start gap-3 px-2 py-2.5 text-left whitespace-normal",
                            "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                          )}
                          onClick={() => go(h)}
                        >
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center bg-primary/15 text-foreground">
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {h.title}
                            </span>
                            {h.subtitle ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {h.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
