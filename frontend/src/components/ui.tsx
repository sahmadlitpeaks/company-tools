import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AlertCircle as AlertCircleIcon, InboxIcon, TriangleAlert } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { apiBlob } from "../api/client";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Empty as ShadcnEmpty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import { Toaster } from "./ui/sonner";
import { cn } from "../lib/utils";

/* ---------- Toast ---------- */
interface ToastState {
  notify: (msg: string, kind?: "info" | "error") => void;
}
const ToastCtx = createContext<ToastState>({ notify: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const notify = useCallback((msg: string, kind: "info" | "error" = "info") => {
    if (kind === "error") sonnerToast.error(msg);
    else sonnerToast.success(msg);
  }, []);
  const contextValue = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastCtx.Provider value={contextValue}>
      {children}
      <Toaster closeButton position="bottom-right" />
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ---------- Modal ---------- */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  maxWidth,
  className,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** Actions belong in DialogFooter (shadcn structure). */
  footer?: ReactNode;
  maxWidth?: number;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={cn(
          "flex max-h-[90vh] w-[min(var(--dialog-max-width,32rem),calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0",
          className,
        )}
        style={maxWidth ? ({ "--dialog-max-width": `${maxWidth}px` } as CSSProperties) : undefined}
      >
        <DialogHeader className="gap-1.5 px-4 pt-4 pb-0">
          <DialogTitle>{title || "Dialog"}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Dialog</DialogDescription>
          )}
        </DialogHeader>
        {/*
          Body uses gap-4 so form fields and inline action rows never collapse
          into each other when callers put buttons inside children.
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {children}
        </div>
        {footer ? (
          <DialogFooter className="gap-2 border-t px-4 py-4 sm:justify-end">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Confirm dialog (replaces window.confirm) ---------- */
export function ConfirmDialog({
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  async function go() {
    setIsSubmitting(true);
    setConfirmationError(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setConfirmationError(
        error instanceof Error && error.message
          ? error.message
          : "The operation could not be completed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmationError ? (
          <Alert variant="destructive">
            <AlertCircleIcon data-slot="alert-icon" aria-hidden="true" />
            <AlertTitle>Couldn't complete this action</AlertTitle>
            <AlertDescription>{confirmationError}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? "destructive" : "default"}
            disabled={isSubmitting}
            onClick={go}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------- Single-input prompt (replaces window.prompt) ---------- */
export function PromptModal({
  title,
  label,
  placeholder,
  defaultValue = "",
  submitLabel = "Create",
  onConfirm,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  /** Preferred callback name (avoids treating call sites as bare form actions). */
  onConfirm?: (value: string) => void | Promise<void>;
  /** @deprecated Use onConfirm */
  onSubmit?: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const handleValue = onConfirm ?? onSubmit;
  const [value, setValue] = useState(defaultValue);
  // Use isSubmitting (not isPending) so pending UI does not look like a status announcement.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setIsSubmitting(true);
    try {
      await handleValue?.(v);
      onClose();
    } catch {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="prompt-modal-form"
            disabled={isSubmitting || !value.trim()}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? "Working…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="prompt-modal-form"
        className="flex flex-col gap-4"
        onSubmit={submit}
        aria-busy={isSubmitting || undefined}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="rd-ui-207-field">{label}</FieldLabel>
            <Input
              id="rd-ui-207-field"
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              required={true}
              minLength={1}
              disabled={isSubmitting}
            />
          </Field>
        </FieldGroup>
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
      <div
        className="grid place-items-center border border-border bg-primary/15 text-foreground"
        style={{ width, height, ...style }}
        title="Unavailable"
      >
        <TriangleAlert aria-hidden="true" />
      </div>
    );
  }
  if (!src) {
    return <Skeleton style={{ width, height, ...style }} />;
  }
  // Prefer caller-provided alt; fall back so the attribute is never empty.
  return <img src={src} alt={alt || "Image"} width={width} height={height} style={style} />;
}

/* ---------- Mini bar chart (no deps) ---------- */
export function MiniBars({
  data,
  color = "var(--primary)",
  height = 90,
  label,
}: {
  data: { date: string; count: number }[];
  color?: string;
  height?: number;
  label?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex flex-col items-start gap-1 py-2" style={{ minHeight: height }}>
        <p className="m-0 text-sm font-medium">No data yet</p>
        <p className="m-0 text-xs text-muted-foreground">Activity will show up here once it starts.</p>
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height,
        }}
      >
        {data.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            style={{
              flex: 1,
              height: `${Math.max(3, (d.count / max) * 100)}%`,
              background: color,
              opacity: d.count === 0 ? 0.18 : 1,
              borderRadius: 0,
            }}
          />
        ))}
      </div>
      {label && (
        <div className="text-muted-foreground" style={{ fontSize: 12, marginTop: 8 }}>
          {label} · {total} in {data.length} days
        </div>
      )}
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
    <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0">{title}</h2>
        {subtitle ? (
          <p className="m-0 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{action}</div> : null}
    </div>
  );
}

export type Metric = { value: ReactNode; label: string; sub?: string };

export function MetricCard({
  value,
  label,
  sub,
  icon,
  tone = "default",
}: Metric & {
  icon?: ReactNode;
  tone?: "default" | "destructive";
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader className="flex flex-row items-center gap-3">
        {icon && (
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center [&_svg]:size-4",
              tone === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/15 text-foreground",
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <CardTitle className="truncate text-xl font-semibold leading-none tabular-nums">
            {value}
          </CardTitle>
          <CardDescription className="mt-1">{label}</CardDescription>
        </div>
      </CardHeader>
      {sub && (
        <CardContent className="text-xs text-muted-foreground">
          {sub}
        </CardContent>
      )}
    </Card>
  );
}

/** A single dashboard metric bar: equal columns with hairline dividers that
 * wrap cleanly and never clip the figures (unlike cramped individual cards). */
export function MetricStrip({ items }: { items: Metric[] }) {
  return (
    <Card className="overflow-hidden py-0">
      <CardContent
        className="grid gap-px p-0"
        style={{
          background: "var(--border)",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        {items.map((it) => (
            <div key={it.label} className="flex flex-col gap-1 bg-card px-4 py-3.5">
            <div className="text-xl font-bold leading-none -tracking-[0.02em] [font-variant-numeric:tabular-nums]">
              {it.value}
            </div>
            <div className="text-[12px] font-medium text-muted-foreground">{it.label}</div>
            {it.sub && <div className="text-[11px] text-muted-foreground/80">{it.sub}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function Loading() {
  return (
    <div
      className="flex flex-col gap-3 py-4"
      role="status"
      aria-label="Loading"
      aria-live="polite"
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-4/5" />
    </div>
  );
}

/** A stack of skeleton rows for table/list loading states. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon data-slot="alert-icon" aria-hidden="true" />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Full-panel error state with a retry action. */
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry?: () => void;
}) {
  return (
    <ShadcnEmpty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><AlertCircleIcon /></EmptyMedia>
        <EmptyTitle>Couldn't load this</EmptyTitle>
        {message && <EmptyDescription>{message}</EmptyDescription>}
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onRetry}>Retry</Button>
        </EmptyContent>
      )}
    </ShadcnEmpty>
  );
}

export function Empty({
  message,
  icon,
  hint,
  action,
}: {
  message: string;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <ShadcnEmpty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <InboxIcon />}</EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </ShadcnEmpty>
  );
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
