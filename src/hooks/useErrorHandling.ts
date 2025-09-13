import { useState } from "react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

// Simple toast hook for notifications
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, "id">) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showSuccess = (title: string, message?: string) => {
    addToast({ type: "success", title, message });
  };

  const showError = (title: string, message?: string) => {
    addToast({ type: "error", title, message });
  };

  // Convenience: format and show a smart contract / RPC error
  const showContractError = (
    title: string,
    error: unknown,
    fallback?: string
  ) => {
    const msg = handleContractError(error) || fallback || "Transaction failed";
    addToast({ type: "error", title, message: msg });
  };

  const showWarning = (title: string, message?: string) => {
    addToast({ type: "warning", title, message });
  };

  const showInfo = (title: string, message?: string) => {
    addToast({ type: "info", title, message });
  };

  return {
    toasts,
    addToast,
    removeToast,
    showSuccess,
    showError,
    showContractError,
    showWarning,
    showInfo,
  };
}

// Error handling utility
export function handleContractError(error: unknown): string {
  // Normalize to a human-readable string from various error shapes (ethers/viem/wagmi/RPC)
  type ErrorLike = {
    message?: string;
    shortMessage?: string;
    reason?: string;
    error?: { message?: string };
    info?: { error?: { message?: string } };
    data?: { message?: string };
    body?: string;
    cause?: unknown;
  };

  const extractRaw = (err: unknown): string | undefined => {
    if (!err) return undefined;
    if (typeof err === "string") return err;
    const e = err as ErrorLike;
    // Common fields
    if (typeof e.shortMessage === "string") return e.shortMessage;
    if (typeof e.reason === "string") return e.reason;
    if (typeof e.message === "string") return e.message;
    if (typeof e?.error?.message === "string") return e.error.message;
    if (typeof e?.info?.error?.message === "string")
      return e.info.error.message;
    if (typeof e?.data?.message === "string") return e.data.message;
    if (typeof e?.body === "string") return e.body;
    return undefined;
  };

  const raw = extractRaw(error);
  if (!raw) return "An unexpected error occurred";

  // Use lowercased copy for detection but keep original for display
  const lc = raw.toLowerCase();

  // Friendly mappings
  if (
    lc.includes("user rejected") ||
    lc.includes("user denied") ||
    lc.includes("rejected the request")
  ) {
    return "Transaction was cancelled by user";
  }
  if (lc.includes("insufficient funds")) {
    return "Insufficient funds to complete transaction";
  }
  if (
    lc.includes("gas required exceeds allowance") ||
    lc.includes("intrinsic gas too low")
  ) {
    return "Transaction requires too much gas";
  }
  if (lc.includes("nonce too low")) {
    return "Please try again - transaction nonce issue";
  }
  if (lc.includes("already known")) {
    return "Transaction already pending";
  }

  // Extract revert reason when present
  const revertRegex =
    /revert(?:ed)?(?::|\swith\sreason\sstring)?\s*[:\s]*["']?([^"'\n]+)["']?/i;
  const m1 = raw.match(revertRegex);
  if (m1?.[1]) return m1[1];

  // Viem-style cause
  const cause = (error as ErrorLike)?.cause;
  const causeMsg = extractRaw(cause);
  if (causeMsg) {
    const m2 = causeMsg.match(revertRegex);
    if (m2?.[1]) return m2[1];
  }

  // Fallback: first line, trimmed
  const firstLine = raw.split("\n")[0].trim();
  return firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine;
}

// Loading state hook
export function useAsyncOperation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = async <T>(operation: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);

    try {
      const result = await operation();
      return result;
    } catch (err: { message: string } | unknown) {
      const errorMessage = handleContractError(err as { message: string });
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setLoading(false);
    setError(null);
  };

  return { loading, error, execute, reset };
}
