import { useMemo, useState } from "react";
import {
  Bot,
  Clock,
  FileText,
  Folder,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { SharePointDocument } from "@/api/sharepoint";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSurface,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export interface MyDocumentsTabProps {
  documents: SharePointDocument[];
  totalCount?: number;
  nextCursor?: string | null;
  isLoading?: boolean;
  updatingDocId?: string | null;
  error?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  categoryFilter: string;
  onCategoryFilterChange: (category: string) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  hasPrevPage?: boolean;
  hasNextPage?: boolean;
  onOpenDoc: (docId: string) => void;
  onAskAboutDoc: (doc: SharePointDocument) => void;
  onRefresh?: () => void;
}

const CATEGORY_OPTIONS = [
  { value: "All types", label: "All types" },
  { value: "Legal", label: "Legal" },
  { value: "Contracts", label: "Contracts" },
  { value: "Commercial", label: "Commercial" },
  { value: "Insurance", label: "Insurance" },
  { value: "General", label: "General" },
] as const;

export const SORT_OPTIONS = [
  { value: "recently_modified", label: "Recently modified" },
  { value: "oldest_modified", label: "Oldest modified" },
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "attention_first", label: "Needs attention first" },
] as const;

export function getDocumentStatusBadge(doc: SharePointDocument): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
  isSpinning?: boolean;
} {
  if (doc.requires_attention || doc.status === "failed") {
    return {
      label: "Needs attention",
      variant: "destructive",
      className:
        "rounded-none bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 font-semibold text-xs",
    };
  }

  if (doc.status === "ready") {
    return {
      label: "Ready",
      variant: "default",
      className:
        "rounded-none bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold text-xs",
    };
  }

  if (doc.status === "awaiting_approval" || doc.status === "queued") {
    return {
      label: "Being prepared",
      variant: "secondary",
      className: "rounded-none font-semibold text-xs inline-flex items-center gap-1",
      isSpinning: true,
    };
  }

  if (
    doc.status === "processing" ||
    doc.status === "document_changed_sync_required"
  ) {
    return {
      label: "Refreshing",
      variant: "outline",
      className:
        "rounded-none bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 font-semibold text-xs inline-flex items-center gap-1",
      isSpinning: true,
    };
  }

  return {
    label: doc.status.replace(/_/g, " "),
    variant: "outline",
    className: "rounded-none font-semibold text-xs",
  };
}

function DocumentPathBreadcrumbs({ doc }: { doc: SharePointDocument }) {
  const parts = useMemo(() => {
    if (!doc.path) return ["General"];
    const segments = doc.path.replace(/^\/+|\/+$/g, "").split("/");
    if (
      segments.length > 1 &&
      segments[segments.length - 1].toLowerCase() === doc.name.toLowerCase()
    ) {
      segments.pop();
    }
    return segments.length > 0 ? segments : ["General"];
  }, [doc.path, doc.name]);

  return (
    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
      <Folder className="size-3 text-muted-foreground/70 shrink-0" aria-hidden="true" />
      {parts.map((p, i) => {
        const pathKey = `${doc.id}-${parts.slice(0, i + 1).join("/")}`;
        return (
          <span key={pathKey} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/40 select-none">/</span>}
            <span className="truncate max-w-[140px]" title={p}>
              {p}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function formatRelativeDate(iso?: string | null): string {
  if (!iso) {
    return "—";
  }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      return "—";
    }
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "—";
  }
}

const SKELETON_ROW_KEYS = [
  "sk-row-1",
  "sk-row-2",
  "sk-row-3",
  "sk-row-4",
  "sk-row-5",
] as const;

const SKELETON_CARD_KEYS = [
  "sk-card-1",
  "sk-card-2",
  "sk-card-3",
  "sk-card-4",
  "sk-card-5",
  "sk-card-6",
] as const;

function TableCellsSkeleton() {
  return (
    <TableSurface className="border border-border">
      <Table className="w-full min-w-[720px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b">
            <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[280px]">
              Document
            </TableHead>
            <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[140px]">
              Status
            </TableHead>
            <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[120px]">
              Modified
            </TableHead>
            <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase text-end min-w-[220px]">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SKELETON_ROW_KEYS.map((key) => (
            <TableRow key={key}>
              <TableCell className="py-3 px-3.5 align-middle">
                <div className="flex items-start gap-2.5">
                  <Skeleton className="size-4 shrink-0 rounded-none mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-44 sm:w-60 rounded-none" />
                    <Skeleton className="h-3 w-24 sm:w-32 rounded-none" />
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap">
                <Skeleton className="h-5 w-24 rounded-none" />
              </TableCell>
              <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap">
                <Skeleton className="h-4 w-16 rounded-none" />
              </TableCell>
              <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap text-end">
                <div className="flex items-center justify-end gap-1.5">
                  <Skeleton className="h-8 w-24 rounded-none" />
                  <Skeleton className="h-8 w-24 rounded-none" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableSurface>
  );
}

function CardsCellsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {SKELETON_CARD_KEYS.map((key) => (
        <Card key={key} className="rounded-none border-border bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Skeleton className="size-5 shrink-0 rounded-none mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-44 rounded-none" />
                <Skeleton className="h-3 w-24 rounded-none" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
              <Skeleton className="h-5 w-20 rounded-none" />
              <Skeleton className="h-4 w-16 rounded-none" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Skeleton className="h-8 w-24 rounded-none" />
              <Skeleton className="h-8 w-24 rounded-none" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MyDocumentsTab({
  documents,
  totalCount: _totalCount,
  nextCursor,
  isLoading = false,
  updatingDocId = null,
  error = null,
  search,
  onSearchChange,
  onSearchSubmit,
  categoryFilter,
  onCategoryFilterChange,
  onPrevPage,
  onNextPage,
  hasPrevPage,
  hasNextPage,
  onOpenDoc,
  onAskAboutDoc,
  onRefresh,
}: MyDocumentsTabProps) {
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return "cards";
    }
    return "table";
  });

  const [sortBy, setSortBy] = useState<string>("recently_modified");

  const sortedDocuments = useMemo(() => {
    const list = [...documents];
    switch (sortBy) {
      case "oldest_modified":
        return list.sort((a, b) => {
          const tA = new Date(a.modified_at || a.processed_at || 0).getTime();
          const tB = new Date(b.modified_at || b.processed_at || 0).getTime();
          return tA - tB;
        });
      case "name_asc":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "name_desc":
        return list.sort((a, b) => b.name.localeCompare(a.name));
      case "attention_first":
        return list.sort((a, b) => {
          const aAttn = a.requires_attention || a.status === "failed" ? 1 : 0;
          const bAttn = b.requires_attention || b.status === "failed" ? 1 : 0;
          if (aAttn !== bAttn) return bAttn - aAttn;
          return (
            new Date(b.modified_at || b.processed_at || 0).getTime() -
            new Date(a.modified_at || a.processed_at || 0).getTime()
          );
        });
      case "recently_modified":
      default:
        return list.sort((a, b) => {
          const tA = new Date(a.modified_at || a.processed_at || 0).getTime();
          const tB = new Date(b.modified_at || b.processed_at || 0).getTime();
          return tB - tA;
        });
    }
  }, [documents, sortBy]);

  const selectedCategoryValue = useMemo(() => {
    if (
      !categoryFilter ||
      categoryFilter.toLowerCase() === "all" ||
      categoryFilter === "All types"
    ) {
      return "All types";
    }
    const match = CATEGORY_OPTIONS.find(
      (c) => c.value.toLowerCase() === categoryFilter.toLowerCase()
    );
    return match ? match.value : categoryFilter;
  }, [categoryFilter]);

  const handleCategoryChange = (val: string | null) => {
    const next = val ?? "All types";
    if (next === "All types" && categoryFilter === "") {
      onCategoryFilterChange("");
    } else {
      onCategoryFilterChange(next);
    }
  };

  const isPrevDisabled = hasPrevPage !== undefined ? !hasPrevPage : !onPrevPage;
  const isNextDisabled =
    hasNextPage !== undefined
      ? !hasNextPage
      : nextCursor !== undefined
        ? !nextCursor
        : !onNextPage;

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            My documents
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {documents.length} documents you have access to in SharePoint.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center text-xs text-muted-foreground">
          <Clock className="size-3.5 text-muted-foreground shrink-0" />
          <span>Updated recently</span>
          {onRefresh && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh documents"
              className="rounded-none h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Refresh documents"
            >
              <RefreshCw
                data-icon="inline-start"
                className={isLoading ? "animate-spin" : undefined}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1"
        >
          <div className="w-full sm:w-80 md:w-96">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Search className="size-4 text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                id="sharepoint-search"
                aria-label="Search by name or what's inside…"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                maxLength={200}
                placeholder="Search by name or what's inside…"
                className="text-xs h-9"
              />
              {search ? (
                <InputGroupButton
                  type="button"
                  onClick={() => {
                    onSearchChange("");
                  }}
                  title="Clear search"
                >
                  <X className="size-3.5" />
                </InputGroupButton>
              ) : null}
            </InputGroup>
          </div>

          <div className="w-full sm:w-44">
            <Select
              items={CATEGORY_OPTIONS}
              value={selectedCategoryValue}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger
                id="category-filter"
                aria-label="Filter by category"
                className="w-full h-9 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-44">
            <Select
              items={SORT_OPTIONS}
              value={sortBy}
              onValueChange={(val) => setSortBy(val ?? "recently_modified")}
            >
              <SelectTrigger
                id="sort-selector"
                aria-label="Sort documents"
                className="w-full h-9 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            size="sm"
            disabled={isLoading && documents.length === 0}
            className="rounded-none text-xs font-semibold h-9 px-4"
          >
            Search
          </Button>
        </form>

        {/* View mode switcher */}
        <div className="flex items-center self-end sm:self-auto shrink-0">
          <ToggleGroup
            value={[viewMode]}
            onValueChange={(value) => {
              if (value[0] === "table" || value[0] === "cards") {
                setViewMode(value[0]);
              }
            }}
            variant="outline"
            spacing={0}
            aria-label="View mode"
          >
            <ToggleGroupItem
              value="table"
              aria-label="Table view"
              className="h-9 px-3 text-xs font-semibold gap-1.5"
            >
              <LayoutList data-icon="inline-start" />
              Table
            </ToggleGroupItem>
            <ToggleGroupItem
              value="cards"
              aria-label="Cards view"
              className="h-9 px-3 text-xs font-semibold gap-1.5"
            >
              <LayoutGrid data-icon="inline-start" />
              Cards
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading state when no documents yet: Cell-level skeletons */}
      {isLoading && documents.length === 0 && (
        viewMode === "table" ? <TableCellsSkeleton /> : <CardsCellsSkeleton />
      )}

      {/* Empty state */}
      {!isLoading && !error && documents.length === 0 && (
        <Empty className="border border-dashed border-border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No documents found</EmptyTitle>
            <EmptyDescription>
              {search ||
              (categoryFilter &&
                categoryFilter !== "All types" &&
                categoryFilter !== "all")
                ? "No documents match your search or filter criteria."
                : "No documents have been indexed yet in SharePoint."}
            </EmptyDescription>
          </EmptyHeader>
          {(search ||
            (categoryFilter &&
              categoryFilter !== "All types" &&
              categoryFilter !== "all")) && (
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-none text-xs"
                onClick={() => {
                  onSearchChange("");
                  onCategoryFilterChange(categoryFilter === "" ? "" : "All types");
                }}
              >
                Clear search & filters
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      {/* Document List: Table or Cards */}
      {documents.length > 0 && (
        <div>
          {viewMode === "table" ? (
            <TableSurface className="border border-border">
              <Table className="w-full min-w-[720px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b">
                    <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[280px]">
                      Document
                    </TableHead>
                    <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[140px]">
                      Status
                    </TableHead>
                    <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase min-w-[120px]">
                      Modified
                    </TableHead>
                    <TableHead className="py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase text-end min-w-[220px]">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDocuments.map((doc) => {
                    const badge = getDocumentStatusBadge(doc);
                    const relativeDate = formatRelativeDate(doc.modified_at);
                    const isDocUpdating =
                      doc.status === "processing" ||
                      doc.status === "document_changed_sync_required" ||
                      doc.status === "queued" ||
                      doc.status === "awaiting_approval" ||
                      (updatingDocId != null && doc.id === updatingDocId);
                    const isAskDisabled = doc.status !== "ready" || isDocUpdating;

                    return (
                      <TableRow
                        key={doc.id}
                        className={cn(
                          "group/row transition-colors",
                          isDocUpdating && "bg-muted/20"
                        )}
                      >
                        <TableCell className="py-3 px-3.5 align-middle">
                          <div className="flex items-start gap-2.5">
                            <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => onOpenDoc(doc.id)}
                                className="text-left font-bold text-sm text-foreground hover:underline cursor-pointer block break-words"
                                dir="auto"
                              >
                                {doc.name}
                              </button>
                              <DocumentPathBreadcrumbs doc={doc} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap">
                          <Badge
                            variant={badge.variant}
                            className={cn(badge.className, "rounded-none")}
                          >
                            {badge.isSpinning && <Spinner data-icon="inline-start" className="size-3" />}
                            <span>{badge.label}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap text-xs text-muted-foreground">
                          {relativeDate}
                        </TableCell>
                        <TableCell className="py-3 px-3.5 align-middle whitespace-nowrap text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isAskDisabled}
                              onClick={() => onAskAboutDoc(doc)}
                              className="rounded-none h-8 text-xs font-semibold"
                              title={
                                isAskDisabled
                                  ? "Document must be ready to ask questions"
                                  : "Ask questions about this document"
                              }
                            >
                              <Bot data-icon="inline-start" />
                              Ask about this
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onOpenDoc(doc.id)}
                              aria-label={`View document ${doc.name}`}
                              className="rounded-none h-8 text-xs font-semibold"
                            >
                              View document
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableSurface>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sortedDocuments.map((doc) => {
                const badge = getDocumentStatusBadge(doc);
                const relativeDate = formatRelativeDate(doc.modified_at);
                const isDocUpdating =
                  doc.status === "processing" ||
                  doc.status === "document_changed_sync_required" ||
                  doc.status === "queued" ||
                  doc.status === "awaiting_approval" ||
                  (updatingDocId != null && doc.id === updatingDocId);
                const isAskDisabled = doc.status !== "ready" || isDocUpdating;

                return (
                  <Card
                    key={doc.id}
                    className={cn(
                      "rounded-none border-border bg-card transition-colors",
                      isDocUpdating && "border-primary/40 bg-muted/20"
                    )}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <FileText className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onOpenDoc(doc.id)}
                            className="text-left font-bold text-sm text-foreground hover:underline cursor-pointer block break-words"
                            dir="auto"
                          >
                            {doc.name}
                          </button>
                          <DocumentPathBreadcrumbs doc={doc} />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50 text-xs">
                        <Badge
                          variant={badge.variant}
                          className={cn(badge.className, "rounded-none")}
                        >
                          {badge.isSpinning && <Spinner data-icon="inline-start" className="size-3" />}
                          <span>{badge.label}</span>
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {relativeDate}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isAskDisabled}
                          onClick={() => onAskAboutDoc(doc)}
                          className="rounded-none h-8 text-xs font-semibold"
                          title={
                            isAskDisabled
                              ? "Document must be ready to ask questions"
                              : "Ask questions about this document"
                          }
                        >
                          <Bot data-icon="inline-start" />
                          Ask about this
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenDoc(doc.id)}
                          aria-label={`View document ${doc.name}`}
                          className="rounded-none h-8 text-xs font-semibold"
                        >
                          View document
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {documents.length > 0 && (
        <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Showing <strong>{documents.length}</strong>{" "}
            {documents.length === 1 ? "document" : "documents"} (Max 20 per
            page)
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={isPrevDisabled}
                  onClick={() => onPrevPage?.()}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  disabled={isNextDisabled}
                  onClick={() => onNextPage?.()}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

export default MyDocumentsTab;
