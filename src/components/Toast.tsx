"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ToastMessage } from "@/hooks/useErrorHandling";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

interface ToastProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
  duration?: number; // ms
}

const VARIANTS: Record<
  NonNullable<ToastMessage["type"]>,
  { container: string; icon: React.ReactElement; ariaRole: "status" | "alert" }
> = {
  success: {
    container:
      "border-emerald-500/70 bg-emerald-900/70 text-emerald-50 shadow-emerald-500/10",
    icon: <CheckCircle2 className="size-5 text-emerald-400" />,
    ariaRole: "status",
  },
  error: {
    container: "border-red-500/70 bg-red-900/70 text-red-50 shadow-red-500/10",
    icon: <XCircle className="size-5 text-red-400" />,
    ariaRole: "alert",
  },
  warning: {
    container:
      "border-amber-500/70 bg-amber-900/70 text-amber-50 shadow-amber-500/10",
    icon: <AlertTriangle className="size-5 text-amber-400" />,
    ariaRole: "alert",
  },
  info: {
    container:
      "border-blue-500/70 bg-blue-900/70 text-blue-50 shadow-blue-500/10",
    icon: <Info className="size-5 text-blue-400" />,
    ariaRole: "status",
  },
};

function Toast({ toast, onRemove, duration = 5000 }: ToastProps) {
  const variant = VARIANTS[toast.type ?? "info"] ?? VARIANTS.info;
  const [progress, setProgress] = useState(100);

  const startRef = useRef<number | null>(null);
  const remainingRef = useRef(duration);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pausedRef = useRef(false);

  const cleanup = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const remove = useCallback(() => onRemove(toast.id), [onRemove, toast.id]);

  // Auto dismiss timer with pause-on-hover.
  useEffect(() => {
    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const pct = 100 - (elapsed / duration) * 100;
      setProgress(Math.max(0, Math.min(100, pct)));
      if (elapsed < duration && !pausedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    timeoutRef.current = setTimeout(remove, remainingRef.current);
    return cleanup;
  }, [duration, remove]);

  const handleMouseEnter = () => {
    pausedRef.current = true;
    cleanup();
    if (startRef.current) {
      const elapsed = performance.now() - startRef.current;
      remainingRef.current = Math.max(0, duration - elapsed);
    }
  };

  const handleMouseLeave = () => {
    pausedRef.current = false;
    startRef.current = performance.now() - (duration - remainingRef.current);
    timeoutRef.current = setTimeout(remove, remainingRef.current);
    rafRef.current = requestAnimationFrame(function resume(now) {
      tickResume(now);
    });
    function tickResume(now: number) {
      if (pausedRef.current) return; // safety
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const pct = 100 - (elapsed / duration) * 100;
      setProgress(Math.max(0, Math.min(100, pct)));
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tickResume);
      }
    }
  };

  return (
    <div
      role={variant.ariaRole}
      aria-live={variant.ariaRole === "alert" ? "assertive" : "polite"}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`group relative flex w-full items-start gap-3 overflow-hidden rounded-md border px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-black/40 shadow-lg animate-in fade-in slide-in-from-right-5 ${variant.container}`}
    >
      <span className="mt-0.5 shrink-0">{variant.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-none tracking-tight line-clamp-2">
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-1 text-xs/5 text-white/80 dark:text-white/70 line-clamp-4">
            {toast.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={remove}
        aria-label="Dismiss notification"
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-white/60 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white/40 focus-visible:ring-offset-black/20"
      >
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </button>
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-current/30 transition-[width]"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}
