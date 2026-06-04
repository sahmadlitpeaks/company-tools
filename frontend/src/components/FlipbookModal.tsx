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
    <div className="fb-page" ref={ref}>
      <img src={src} alt={`Page ${number}`} draggable={false} />
    </div>
  ),
);
Page.displayName = "FlipPage";

export default function FlipbookModal({
  url,
  name,
  onClose,
  auth = true,
}: {
  /** Download path of the PDF, e.g. `/api/assets/:id/download`. */
  url: string;
  name: string;
  /** When omitted (e.g. the public viewer page) the close button is hidden. */
  onClose?: () => void;
  /** Send the auth token when fetching the PDF. Set false for public pages. */
  auth?: boolean;
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
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-900/95 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="truncate text-sm font-medium">{name}</span>
        <div className="flex items-center gap-2">
          {ready && (
            <span className="hidden text-xs text-white/70 sm:inline">
              Page {Math.min(current + 1, total)}–{Math.min(current + 2, total)} of {total}
            </span>
          )}
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-white/10 text-white hover:bg-white/20"
            title="Download PDF"
            aria-label="Download PDF"
            onClick={() => downloadFile(url, name)}
          >
            <Download size={17} />
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-white/10 text-white hover:bg-white/20"
            title="Fullscreen"
            aria-label="Toggle fullscreen"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen?.();
            }}
          >
            <Maximize2 size={17} />
          </button>
          {onClose && (
            <button
              className="grid h-9 w-9 place-items-center rounded-lg border-0 bg-white/10 text-white hover:bg-white/20"
              title="Close (Esc)"
              aria-label="Close viewer"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2">
        {error ? (
          <div className="text-center text-white/80">
            <p className="mb-3">{error}</p>
            <button
              className="btn"
              onClick={() => downloadFile(url, name)}
            >
              Download instead
            </button>
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
            <button
              className="absolute left-3 z-10 grid h-11 w-11 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/25 disabled:opacity-30"
              onClick={() => flip(-1)}
              disabled={current === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={22} />
            </button>
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
              className="flipbook"
              onFlip={(e: { data: number }) => setCurrent(e.data)}
            >
              {pages.map((src, i) => (
                <Page key={i} src={src} number={i + 1} />
              ))}
            </HTMLFlipBook>
            <button
              className="absolute right-3 z-10 grid h-11 w-11 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/25 disabled:opacity-30"
              onClick={() => flip(1)}
              disabled={current >= total - 1}
              aria-label="Next page"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
