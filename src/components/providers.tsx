"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { createContext, useContext, useMemo } from "react";
import { ToastContainer } from "./Toast";
import { useToast, ToastMessage } from "@/hooks/useErrorHandling";

const queryClient = new QueryClient();

// Toast context so any component can trigger notifications
export const ToastContext = createContext<{
  toasts: ToastMessage[];
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
} | null>(null);

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastContext not available");
  return ctx;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const { toasts, removeToast, showSuccess, showError, showWarning, showInfo } =
    useToast();

  const value = useMemo(
    () => ({ toasts, showSuccess, showError, showWarning, showInfo }),
    [toasts]
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ borderRadius: "medium" })}>
          <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
          </ToastContext.Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
