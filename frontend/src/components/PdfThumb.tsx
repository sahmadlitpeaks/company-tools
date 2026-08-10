import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { apiUrl } from "../api/client";

/** Renders the first page of a PDF as a small cover thumbnail (client-side).
 * pdfjs is imported dynamically so it stays out of the main bundle. */
type PdfThumbProps = {
  url: string;
  size?: number;
  auth?: boolean;
};

export default function PdfThumb({ url, size = 40, auth = true }: PdfThumbProps) {
  return (
    <PdfThumbSource
      key={`${auth ? "auth" : "public"}:${url}`}
      url={url}
      size={size}
    />
  );
}

function PdfThumbSource({
  url,
  size,
}: Required<Pick<PdfThumbProps, "url" | "size">>) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearby, setIsNearby] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (!("IntersectionObserver" in window)) {
      setIsNearby(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNearby(true);
        observer.disconnect();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let renderTask: RenderTask | undefined;

    setFailed(false);
    const existingCanvas = canvasRef.current;
    existingCanvas?.getContext("2d")?.clearRect(0, 0, existingCanvas.width, existingCanvas.height);

    if (!isNearby) return;
    const abortController = new AbortController();

    (async () => {
      try {
        const [pdfjsLib, workerModule] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        if (cancelled) return;
        const workerUrl = workerModule.default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
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
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (size * 2) / base.width; // 2x for crispness
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const currentRenderTask = page.render({ canvas, canvasContext: ctx, viewport });
        renderTask = currentRenderTask;
        await currentRenderTask.promise;
        if (cancelled) return;
        await loadingTask.destroy();
        loadingTask = undefined;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [isNearby, size, url]);

  return (
    <span
      ref={rootRef}
      aria-hidden="true"
      className="grid flex-none place-items-center"
      style={{ width: size, height: size }}
    >
      {failed ? (
        <FileText
          className="size-full bg-primary/15 p-2 text-foreground"
          size={size * 0.5}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="size-full border border-border bg-card object-cover shadow-sm"
        />
      )}
    </span>
  );
}
