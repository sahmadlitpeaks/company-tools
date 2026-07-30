import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { Modal } from "./ui";

/** Longest edge of a captured photo. A 4-8 MB phone shot becomes ~200 KB. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/** True when the browser can open a live camera stream at all.
 *
 * `navigator.mediaDevices` only exists in a secure context, so this is false
 * over plain http from anything other than localhost. Callers fall back to a
 * `capture="environment"` file input, which still opens the camera app on a
 * phone. */
export function canUseLiveCamera(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Full-screen viewfinder: take a photo, review it, keep or retake. */
export default function CameraCapture({
  onCapture,
  onClose,
  title = "Take a photo",
}: {
  /** Receives the downscaled JPEG. Resolve to close, throw to stay open. */
  onCapture: (file: File) => Promise<void> | void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped by Retake to re-run the effect and reopen the stream.
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Open the rear camera; fall back to whatever camera exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser's site settings, or attach a photo from a file instead."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : "Couldn't start the camera. Attach a photo from a file instead.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop, attempt]);

  // Revoke the preview URL when it is replaced or the modal goes away.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  function takeShot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const file = new File([blob], `photo-${stamp}.jpg`, { type: "image/jpeg" });
        setShot({ url: URL.createObjectURL(blob), file });
        stop(); // freeze the camera while the shot is being reviewed
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }

  async function keep() {
    if (!shot) return;
    setBusy(true);
    try {
      await onCapture(shot.file);
      onClose();
    } catch {
      // The caller reported the failure; let them retake.
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} maxWidth={620}>
      {error ? (
        <p className="text-sm">{error}</p>
      ) : (
        <>
          <div
            className="relative mb-3 overflow-hidden rounded-xl"
            style={{ background: "#000", aspectRatio: "4 / 3" }}
          >
            {/* Kept mounted so the stream has somewhere to attach. */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
              style={{ display: shot ? "none" : "block" }}
            />
            {shot && <img src={shot.url} alt="Captured photo" className="h-full w-full object-cover" />}
            {!ready && !shot && (
              <span className="muted absolute inset-0 grid place-items-center text-sm">
                Starting camera…
              </span>
            )}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            {shot ? (
              <>
                <button
                  className="btn inline-flex items-center gap-1.5"
                  style={{ flex: "0 0 auto" }}
                  disabled={busy}
                  onClick={() => {
                    setShot(null);
                    setReady(false);
                    setAttempt((n) => n + 1); // reopens the stream
                  }}
                >
                  <RefreshCw size={15} /> Retake
                </button>
                <button
                  className="btn-primary"
                  style={{ flex: "0 0 auto" }}
                  disabled={busy}
                  onClick={keep}
                >
                  {busy ? "Uploading…" : "Use this photo"}
                </button>
              </>
            ) : (
              <button
                className="btn-primary inline-flex items-center gap-1.5"
                style={{ flex: "0 0 auto" }}
                disabled={!ready}
                onClick={takeShot}
              >
                <Camera size={15} /> Capture
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
