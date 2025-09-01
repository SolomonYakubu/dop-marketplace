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

    // Auto remove after 5 seconds
    setTimeout(() => {
      removeToast(id);
    }, 5000);
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
    showWarning,
    showInfo,
  };
}

// Error handling utility
export function handleContractError(error: any): string {
  if (error?.message) {
    // Extract meaningful error messages from common Web3 errors
    const message = error.message;

    if (message.includes("user rejected transaction")) {
      return "Transaction was cancelled by user";
    }

    if (message.includes("insufficient funds")) {
      return "Insufficient funds to complete transaction";
    }

    if (message.includes("gas required exceeds allowance")) {
      return "Transaction requires too much gas";
    }

    if (message.includes("nonce too low")) {
      return "Please try again - transaction nonce issue";
    }

    if (message.includes("already known")) {
      return "Transaction already pending";
    }

    // Try to extract revert reason
    const revertMatch = message.match(/revert ([^"']+)/i);
    if (revertMatch) {
      return `Contract error: ${revertMatch[1]}`;
    }

    // Return first line of error message
    const firstLine = message.split("\n")[0];
    return firstLine.length > 100
      ? firstLine.substring(0, 100) + "..."
      : firstLine;
  }

  return "An unexpected error occurred";
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
    } catch (err: any) {
      const errorMessage = handleContractError(err);
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
