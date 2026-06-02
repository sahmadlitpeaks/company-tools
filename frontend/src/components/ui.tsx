import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { apiBlob } from "../api/client";

/* ---------- Toast ---------- */
interface ToastState {
  notify: (msg: string, kind?: "info" | "error") => void;
}
const ToastCtx = createContext<ToastState>({ notify: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);

  const notify = useCallback((msg: string, kind: "info" | "error" = "info") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={{ notify }}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind === "error" ? "error" : ""}`}>
          {toast.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ---------- Modal ---------- */
export function Modal({
  title,
  onClose,
  children,
  maxWidth,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Confirm dialog (replaces window.confirm) ---------- */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="muted" style={{ marginTop: -4, marginBottom: 18 }}>
        {message}
      </div>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
          Cancel
        </button>
        <button
          className={danger ? "btn-danger-solid" : "btn-primary"}
          style={{ flex: "0 0 auto" }}
          disabled={busy}
          onClick={go}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Single-input prompt (replaces window.prompt) ---------- */
export function PromptModal({
  title,
  label,
  placeholder,
  defaultValue = "",
  submitLabel = "Create",
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onSubmit(v);
      onClose();
    } catch {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>{label}</label>
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ flex: "0 0 auto" }}
            disabled={busy || !value.trim()}
          >
            {busy ? "…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Auth-protected image ---------- */
/** Loads an image behind auth (token attached) and renders it as a blob URL. */
export function AuthImage({
  path,
  alt,
  width,
  height,
  style,
}: {
  path: string;
  alt: string;
  width: number;
  height: number;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    apiBlob(path)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <div className="img-fallback" style={{ width, height, ...style }} title="Unavailable">
        ⚠
      </div>
    );
  }
  if (!src) {
    return <div className="img-skeleton" style={{ width, height, ...style }} />;
  }
  return <img src={src} alt={alt} width={width} height={height} style={style} />;
}

/* ---------- Misc ---------- */
export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card" style={{ borderColor: "#fecaca", color: "#b91c1c" }}>
      {message}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
