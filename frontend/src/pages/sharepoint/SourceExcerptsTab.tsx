import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Coins,
  Copy,
  FileText,
  Filter,
  Layers,
  Lock,
  Mail,
  Phone,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";
import type { Segment } from "@/api/sharepoint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

const PLACEHOLDER_REGEX =
  /(\[(?:PERSON|ORGANIZATION|SECRET|EMAIL|PHONE|VALUE|ADDRESS|CONFIDENTIAL|IDENTIFIER)_[0-9]+\])/g;

interface ChunkItem {
  id: string;
  text: string;
}

function parseChunks(segmentId: string, text: string): ChunkItem[] {
  const parts = text.split(PLACEHOLDER_REGEX);
  let offset = 0;
  return parts.map((part) => {
    const chunkId = `${segmentId}:${offset}:${part.slice(0, 8)}`;
    offset += part.length;
    return { id: chunkId, text: part };
  });
}

function HighlightedText({ text, query, baseId }: { text: string; query: string; baseId: string }) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: Array<{ id: string; content: string; isMatch: boolean }> = [];
  let cur = 0;
  let match = lower.indexOf(query, cur);
  while (match !== -1) {
    if (match > cur) {
      parts.push({ id: `${baseId}-t-${cur}`, content: text.slice(cur, match), isMatch: false });
    }
    parts.push({ id: `${baseId}-m-${match}`, content: text.slice(match, match + query.length), isMatch: true });
    cur = match + query.length;
    match = lower.indexOf(query, cur);
  }
  if (cur < text.length) {
    parts.push({ id: `${baseId}-t-${cur}`, content: text.slice(cur), isMatch: false });
  }
  return (
    <>
      {parts.map((p) =>
        p.isMatch ? (
          <mark key={p.id} className="bg-amber-300/40 dark:bg-amber-500/30 text-foreground font-medium px-0.5 rounded-none">
            {p.content}
          </mark>
        ) : (
          <span key={p.id}>{p.content}</span>
        )
      )}
    </>
  );
}

function renderSegmentContent(segmentId: string, text: string, searchQuery: string) {
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const chunks = parseChunks(segmentId, text);

  return chunks.map((chunk) => {
    const part = chunk.text;
    if (part.startsWith("[") && part.endsWith("]")) {
      if (part.startsWith("[PERSON_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 select-all align-baseline rounded-none"
            title="Redacted Person"
          >
            <User className="size-3" />
            {part}
          </Badge>
        );
      }
      if (part.startsWith("[ORGANIZATION_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30 select-all align-baseline rounded-none"
            title="Redacted Organization"
          >
            <Building2 className="size-3" />
            {part}
          </Badge>
        );
      }
      if (part.startsWith("[EMAIL_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30 select-all align-baseline rounded-none"
            title="Redacted Email"
          >
            <Mail className="size-3" />
            {part}
          </Badge>
        );
      }
      if (part.startsWith("[PHONE_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 select-all align-baseline rounded-none"
            title="Redacted Phone Number"
          >
            <Phone className="size-3" />
            {part}
          </Badge>
        );
      }
      if (part.startsWith("[SECRET_") || part.startsWith("[CONFIDENTIAL_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-destructive/10 text-destructive border-destructive/30 select-all align-baseline rounded-none"
            title="Redacted Secret / Confidential"
          >
            <Lock className="size-3" />
            {part}
          </Badge>
        );
      }
      if (part.startsWith("[VALUE_")) {
        return (
          <Badge
            key={chunk.id}
            variant="outline"
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 select-all align-baseline rounded-none"
            title="Redacted Financial Value"
          >
            <Coins className="size-3" />
            {part}
          </Badge>
        );
      }
      return (
        <Badge
          key={chunk.id}
          variant="outline"
          className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 mx-0.5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 select-all align-baseline rounded-none"
          title="Redacted Identifier"
        >
          <Shield className="size-3" />
          {part}
        </Badge>
      );
    }

    return <HighlightedText key={chunk.id} text={part} query={trimmedQuery} baseId={chunk.id} />;
  });
}

export function SourceExcerptsTab({
  segments,
  activeSegmentId,
  onClearActiveSegment,
}: {
  segments?: Segment[];
  activeSegmentId?: string | null;
  onClearActiveSegment?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Extract unique locations for filtering
  const locations = useMemo(() => {
    if (!segments) return [];
    const set = new Set<string>();
    for (const seg of segments) {
      if (seg.location) {
        const topLoc = seg.location.split(",")[0].trim();
        if (topLoc) set.add(topLoc);
      }
    }
    return Array.from(set).sort();
  }, [segments]);

  // Filter segments
  const filteredSegments = useMemo(() => {
    if (!segments) return [];
    const q = search.trim().toLowerCase();
    return segments.filter((seg) => {
      // Location filter
      if (locationFilter !== "all" && !seg.location.toLowerCase().includes(locationFilter.toLowerCase())) {
        return false;
      }
      // Text query
      if (q) {
        const matchText = seg.text.toLowerCase().includes(q);
        const matchId = seg.id.toLowerCase().includes(q);
        const matchLoc = seg.location.toLowerCase().includes(q);
        if (!matchText && !matchId && !matchLoc) return false;
      }
      return true;
    });
  }, [segments, search, locationFilter]);

  // Smooth scroll to active segment when set
  useEffect(() => {
    if (!activeSegmentId) return;
    const target = document.getElementById(`segment-card-${activeSegmentId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeSegmentId]);

  const totalWords = useMemo(() => {
    if (!segments) return 0;
    return segments.reduce((sum, s) => sum + (s.text ? s.text.trim().split(/\s+/).length : 0), 0);
  }, [segments]);

  async function copyExcerpt(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  async function copyAll() {
    if (!segments?.length) return;
    try {
      const fullText = segments.map((s) => `--- [${s.id}] ${s.location} ---\n${s.text}`).join("\n\n");
      await navigator.clipboard.writeText(fullText);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  if (!segments || segments.length === 0) {
    return (
      <div className="py-12 text-center border border-dashed border-border p-6 space-y-2">
        <Layers className="size-8 mx-auto text-muted-foreground opacity-50" />
        <h4 className="text-sm font-semibold">No extracted text segments</h4>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          No text chunks have been indexed for this document yet. Text will appear here after parsing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Active Jump Banner */}
      {activeSegmentId && (
        <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/30 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-primary">Focused on citation:</span>
            <Badge variant="outline" className="font-mono text-xs bg-background rounded-none font-bold">
              #{activeSegmentId}
            </Badge>
          </div>
          {onClearActiveSegment && (
            <Button variant="ghost" size="xs" onClick={onClearActiveSegment} className="h-7 text-xs gap-1.5 font-medium">
              <X className="size-3.5" />
              Clear highlight
            </Button>
          )}
        </div>
      )}

      {/* Toolbar: Search, Filters & Actions */}
      <div className="space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="flex-1 max-w-md">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Search className="size-4 text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search across all excerpts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 text-xs sm:text-sm"
              />
              {search && (
                <InputGroupButton onClick={() => setSearch("")} title="Clear search">
                  <X className="size-3.5" />
                </InputGroupButton>
              )}
            </InputGroup>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyAll}
              disabled={allCopied}
              className="text-xs sm:text-sm h-9 gap-2 font-medium"
              title="Copy entire document text to clipboard"
            >
              {allCopied ? (
                <>
                  <Check data-icon="inline-start" className="size-3.5 text-emerald-600" />
                  Copied All!
                </>
              ) : (
                <>
                  <Copy data-icon="inline-start" className="size-3.5" />
                  Copy All Text
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Location Chips & Meta Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-border/60 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 mr-1 text-xs font-semibold">
              <Filter className="size-3.5" /> Section:
            </span>
            <Button
              variant={locationFilter === "all" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setLocationFilter("all")}
              className="h-7 px-2.5 text-xs font-medium"
            >
              All ({segments.length})
            </Button>
            {locations.slice(0, 5).map((loc) => (
              <Button
                key={loc}
                variant={locationFilter === loc ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setLocationFilter(loc)}
                className="h-7 px-2.5 text-xs font-medium"
              >
                {loc}
              </Button>
            ))}
          </div>

          <div className="text-xs text-muted-foreground font-mono">
            Showing {filteredSegments.length} of {segments.length} segments · ~{totalWords.toLocaleString()} words
          </div>
        </div>
      </div>

      {/* Excerpts List */}
      <div ref={listRef} className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
        {filteredSegments.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-border p-5 space-y-1.5">
            <p className="text-sm font-semibold text-foreground">No matching excerpts found</p>
            <p className="text-xs text-muted-foreground">
              Try adjusting your search query or clearing the active filters.
            </p>
          </div>
        ) : (
          filteredSegments.map((segment) => {
            const isFocused = activeSegmentId === segment.id;
            const wordCount = segment.text.trim().split(/\s+/).length;
            const isCopied = copiedId === segment.id;

            return (
              <Card
                id={`segment-card-${segment.id}`}
                key={segment.id}
                className={cn(
                  "transition-all duration-200 border",
                  isFocused
                    ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                    : "border-border hover:border-border/80 bg-card"
                )}
              >
                <div className="flex items-center justify-between px-3.5 py-2 bg-muted/40 border-b border-border/80 text-xs sm:text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={isFocused ? "default" : "outline"}
                      className="font-mono text-xs shrink-0 font-bold rounded-none px-2 py-0.5"
                    >
                      #{segment.id}
                    </Badge>
                    <span className="text-muted-foreground flex items-center gap-1.5 truncate text-xs font-medium">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={segment.location}>
                        {segment.location}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-xs text-muted-foreground font-mono">
                      {wordCount} words
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => void copyExcerpt(segment.id, segment.text)}
                      className="h-7 px-2 text-xs gap-1.5 font-medium"
                      title="Copy excerpt text"
                    >
                      {isCopied ? (
                        <>
                          <Check className="size-3.5 text-emerald-600" />
                          <span className="text-emerald-600 font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <CardContent className="p-3.5">
                  <div
                    dir="auto"
                    className="whitespace-pre-wrap break-words text-sm leading-relaxed font-normal text-foreground select-text"
                  >
                    {renderSegmentContent(segment.id, segment.text, search)}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
