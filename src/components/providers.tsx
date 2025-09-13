"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, type State } from "wagmi";
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
  showContractError: (title: string, error: unknown, fallback?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
} | null>(null);

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastContext not available");
  return ctx;
}

export function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: State;
}) {
  const {
    toasts,
    removeToast,
    showSuccess,
    showError,
    showContractError,
    showWarning,
    showInfo,
  } = useToast();

  const value = useMemo(
    () => ({
      toasts,
      showSuccess,
      showError,
      showContractError,
      showWarning,
      showInfo,
    }),
    [toasts, showSuccess, showError, showContractError, showWarning, showInfo]
  );

  return (
    <WagmiProvider config={config} initialState={initialState}>
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
