import { Button } from "@/components/ui/button";
import { forwardRef, useEffect, useRef, useState } from "react";
import HTMLFlipBook from "react-pageflip";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize2,
  X,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { apiBlob, downloadFile } from "../api/client";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** A single rasterised PDF page. react-pageflip needs each page to forward a ref. */
const Page = forwardRef<HTMLDivElement, { src: string; number: number }>(
  ({ src, number }, ref) => (
    <div className="overflow-hidden bg-white" ref={ref}>
      <img
        className="block size-full select-none bg-white object-contain [-webkit-user-drag:none]"
        src={src}
        alt="Document page"
        draggable={false}
        data-page={number}
      />
    </div>
  ),
);
Page.displayName = "FlipPage";

export default function FlipbookModal({
  url,
  name,
  onClose,
  auth = true,
  brandName,
  brandLogo,
}: {
  /** Download path of the PDF, e.g. `/api/assets/:id/download`. */
  url: string;
  name: string;
  /** When omitted (e.g. the public viewer page) the close button is hidden. */
  onClose?: () => void;
  /** Send the auth token when fetching the PDF. Set false for public pages. */
  auth?: boolean;
  /** Optional brand identity shown in the header (public viewer). */
  brandName?: string | null;
  brandLogo?: string | null;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [dims, setDims] = useState({ w: 460, h: 620 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await (await apiBlob(url, auth)).arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        setTotal(pdf.numPages);
        const urls: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 1400 / base.width); // crisp but bounded
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          urls.push(canvas.toDataURL("image/jpeg", 0.85));
          if (i === 1) {
            const ar = base.width / base.height;
            const h = Math.min(760, Math.round(window.innerHeight * 0.74));
            setDims({ w: Math.round(h * ar), h });
          }
          setRendered(i);
        }
        if (!cancelled) setPages(urls);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, auth]);

  const flip = (dir: 1 | -1) => {
    const pf = bookRef.current?.pageFlip?.();
    if (!pf) return;
    dir === 1 ? pf.flipNext() : pf.flipPrev();
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") flip(1);
      else if (e.key === "ArrowLeft") flip(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = pages.length > 0 && !error;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="flex min-w-0 items-center gap-2.5">
          {brandLogo ? (
            <img
              src={brandLogo}
              alt="Brand logo"
              className="h-7 w-auto flex-none bg-card/90 p-0.5"
            />
          ) : brandName ? (
            <span className="flex-none text-sm font-semibold text-white/90">
              {brandName}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">{name}</span>
        </span>
        <div className="flex items-center gap-2">
          {ready && (
            <span className="hidden text-xs text-white/70 sm:inline">
              Page {Math.min(current + 1, total)}–{Math.min(current + 2, total)} of {total}
            </span>
          )}
          <Button type="button"
            size="icon-sm"
            variant="secondary"
            title="Download PDF"
            aria-label="Download PDF"
            onClick={() => downloadFile(url, name)}
          >
            <Download />
          </Button>
          <Button type="button"
            size="icon-sm"
            variant="secondary"
            title="Fullscreen"
            aria-label="Toggle fullscreen"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen?.();
            }}
          >
            <Maximize2 />
          </Button>
          {onClose && (
            <Button type="button"
              size="icon-sm"
              variant="secondary"
              title="Close (Esc)"
              aria-label="Close viewer"
              onClick={onClose}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2">
        {error ? (
          <div className="text-center text-white/80">
            <p className="mb-3">{error}</p>
            <Button type="button"
              variant="secondary"
              onClick={() => downloadFile(url, name)}
            >
              Download instead
            </Button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col items-center gap-3 text-white/80">
            <Loader2 className="animate-spin" size={28} />
            <p className="text-sm">
              {total ? `Rendering page ${rendered} of ${total}…` : "Opening document…"}
            </p>
          </div>
        ) : (
          <>
            <Button type="button"
              size="icon-lg"
              variant="secondary"
              className="absolute left-3"
              onClick={() => flip(-1)}
              disabled={current === 0}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            {/* @ts-expect-error react-pageflip's types omit children */}
            <HTMLFlipBook
              ref={bookRef}
              width={dims.w}
              height={dims.h}
              size="fixed"
              minWidth={200}
              maxWidth={1200}
              minHeight={300}
              maxHeight={1400}
              showCover
              maxShadowOpacity={0.5}
              mobileScrollSupport
              className="shadow-2xl"
              onFlip={(e: { data: number }) => setCurrent(e.data)}
            >
              {pages.map((src, i) => (
                <Page key={src} src={src} number={i + 1} />
              ))}
            </HTMLFlipBook>
            <Button type="button"
              size="icon-lg"
              variant="secondary"
              className="absolute right-3"
              onClick={() => flip(1)}
              disabled={current >= total - 1}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
