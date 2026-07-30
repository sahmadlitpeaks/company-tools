import { Button } from "@/components/ui/button";
import { forwardRef, useEffect, useEffectEvent, useId, useRef, useState } from "react";
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
import type { RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { apiUrl, downloadFile } from "../api/client";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** A single rasterised PDF page. react-pageflip needs each page to forward a ref. */
const Page = forwardRef<HTMLDivElement, { src: string; number: number; total: number }>(
  ({ src, number, total }, ref) => (
    <div className="overflow-hidden bg-white" ref={ref}>
      <img
        className="block size-full select-none bg-white object-contain [-webkit-user-drag:none]"
        src={src}
        alt={`Page ${number} of ${total}`}
        draggable={false}
        data-page={number}
      />
    </div>
  ),
);
Page.displayName = "FlipPage";

type FlipbookModalProps = {
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
};

type RenderedPage = {
  number: number;
  src: string;
};

type FlipBookHandle = {
  pageFlip: () => {
    flipNext: () => void;
    flipPrev: () => void;
  };
};

export default function FlipbookModal(props: FlipbookModalProps) {
  const { auth = true, url } = props;

  return <FlipbookViewer key={`${auth ? "auth" : "public"}:${url}`} {...props} />;
}

function FlipbookViewer({
  url,
  name,
  onClose,
  brandName,
  brandLogo,
}: Omit<FlipbookModalProps, "auth">) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [total, setTotal] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [dims, setDims] = useState({ w: 460, h: 620 });
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const handleClose = useEffectEvent(() => onClose?.());
  const bookRef = useRef<FlipBookHandle>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined;
    let renderTask: RenderTask | undefined;

    const abortController = new AbortController();

    (async () => {
      try {
        const response = await fetch(apiUrl(url), {
          credentials: "include",
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(response.statusText || "Could not load PDF");
        const data = await response.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setTotal(pdf.numPages);
        const renderedPages: RenderedPage[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 1400 / base.width); // crisp but bounded
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          const currentRenderTask = page.render({ canvas, canvasContext: ctx, viewport });
          renderTask = currentRenderTask;
          await currentRenderTask.promise;
          if (cancelled) return;
          renderedPages.push({
            number: i,
            src: canvas.toDataURL("image/jpeg", 0.85),
          });
          if (i === 1) {
            const ar = base.width / base.height;
            const h = Math.min(760, Math.round(window.innerHeight * 0.74));
            setDims({ w: Math.round(h * ar), h });
          }
          setRendered(i);
          // react-pageflip updates from appended children and preserves its current page.
          setPages([...renderedPages]);
        }
        await loadingTask.destroy();
        loadingTask = undefined;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [url]);

  const flip = (dir: 1 | -1) => {
    const pf = bookRef.current?.pageFlip?.();
    if (!pf) return;
    dir === 1 ? pf.flipNext() : pf.flipPrev();
  };

  const handleViewerKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "ArrowRight") flip(1);
    else if (event.key === "ArrowLeft") flip(-1);
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      handleViewerKeyDown(event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isModal = onClose !== undefined;

  useEffect(() => {
    if (!isModal) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    function onCancel(event: Event) {
      event.preventDefault();
      handleClose();
    }

    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
    closeRef.current?.focus();

    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isModal]);

  const ready = pages.length > 0 && !error;

  const viewer = (
    <>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
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
          <h1 id={titleId} className="truncate text-sm font-medium">{name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {ready && (
            <span className="hidden text-xs text-white/70 sm:inline">
              Page {Math.min(current + 1, total)}–{Math.min(current + 2, total)} of {total}
            </span>
          )}
          <Button type="button"
            size="sm"
            variant="secondary"
            title={`Download ${name} as PDF`}
            aria-label={`Download ${name} as PDF`}
            onClick={() => downloadFile(url, name)}
          >
            <Download data-icon="inline-start" />
            <span className="hidden sm:inline">Download PDF</span>
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
            <Button ref={closeRef} type="button"
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
              {total
                ? rendered
                  ? `Rendering page ${rendered} of ${total}…`
                  : `Rendering first page of ${total}…`
                : "Opening document…"}
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
              renderOnlyPageLengthChange
              className="shadow-2xl"
              onFlip={(e: { data: number }) => setCurrent(e.data)}
            >
              {pages.map((page) => (
                <Page key={page.number} src={page.src} number={page.number} total={total} />
              ))}
            </HTMLFlipBook>
            <Button type="button"
              size="icon-lg"
              variant="secondary"
              className="absolute right-3"
              onClick={() => flip(1)}
              disabled={current >= pages.length - 1}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </>
  );

  if (!onClose) {
    return (
      <main className="fixed inset-0 z-[70] flex flex-col bg-black/95 backdrop-blur-sm">
        {viewer}
      </main>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 z-[70] m-0 h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-black/95 p-0 backdrop-blur-sm open:flex"
    >
      {viewer}
    </dialog>
  );
}
