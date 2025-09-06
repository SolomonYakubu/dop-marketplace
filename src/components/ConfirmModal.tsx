"use client";

import React from "react";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message?: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative z-[1001] w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 p-5 shadow-xl">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        {message && (
          <div className="text-sm text-gray-300 mb-4 leading-relaxed">
            {message}
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              "rounded-md px-4 py-2 text-sm font-medium " +
              (danger
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white")
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
