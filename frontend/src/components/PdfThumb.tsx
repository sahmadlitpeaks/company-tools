import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { apiBlob } from "../api/client";

/** Renders the first page of a PDF as a small cover thumbnail (client-side).
 * pdfjs is imported dynamically so it stays out of the main bundle. */
export default function PdfThumb({
  url,
  size = 40,
  auth = true,
}: {
  url: string;
  size?: number;
  auth?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        const workerUrl = (
          await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        const data = await (await apiBlob(url, auth)).arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = (size * 2) / base.width; // 2x for crispness
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, size, auth]);

  if (failed)
    return (
      <span
        className="grid flex-none place-items-center rounded-lg bg-slate-100 text-ink-muted"
        style={{ width: size, height: size }}
      >
        <FileText size={size * 0.5} />
      </span>
    );

  return (
    <canvas
      ref={canvasRef}
      className="flex-none rounded-lg border border-border bg-white object-cover shadow-sm"
      style={{ width: size, height: size }}
    />
  );
}
