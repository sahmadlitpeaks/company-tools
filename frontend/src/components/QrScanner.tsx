import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui";

/**
 * A live camera QR/barcode scanner.
 *
 * Uses the browser's native `BarcodeDetector`, which Chrome/Android and the
 * native shell have — so no scanning library is pulled into the bundle. Where
 * it's missing (notably iOS Safari today), `isScannerSupported()` reports false
 * and callers keep the existing route: scan the label with the phone's own
 * camera app, which follows the `/q/{id}` redirect into the app anyway.
 */
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export function isScannerSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export default function QrScanner({
  onScan,
  onClose,
  title = "Scan a label",
}: {
  onScan: (value: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    async function start() {
      try {
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code", "code_128"] });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped) return;
          try {
            const hits = await detector.detect(video);
            if (hits.length > 0 && hits[0].rawValue) {
              onScan(hits[0].rawValue);
              return; // caller closes; stop scanning immediately
            }
          } catch {
            /* a bad frame is normal — keep going */
          }
          frame = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch {
        setError("Couldn't open the camera. Check permissions and try again.");
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <Modal title={title} onClose={onClose}>
      {error ? (
        <p className="muted">{error}</p>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full rounded-xl"
            style={{ background: "#000", aspectRatio: "3 / 4", objectFit: "cover" }}
          />
          <p className="muted mt-2 text-sm">Point the camera at the asset's QR label.</p>
        </>
      )}
    </Modal>
  );
}
