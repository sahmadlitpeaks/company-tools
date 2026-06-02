import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
