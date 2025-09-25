import { extractTxHash, getExplorerTxUrl } from "@/lib/utils";

export type ToastExtras = {
  txHash?: string;
  explorerUrl?: string;
};

export type ToastLike = {
  showSuccess: (title: string, message?: string, extras?: ToastExtras) => void;
};

type ChainExplorerLike = {
  id?: number;
  blockExplorers?: {
    default?: { url?: string | null };
    etherscan?: { url?: string | null };
    [key: string]: { url?: string | null } | undefined;
  };
};

type ChainContext = {
  chainId?: number;
  chain?: ChainExplorerLike | null;
};

function resolveChainId(ctx?: ChainContext) {
  if (!ctx) return undefined;
  if (typeof ctx.chainId === "number") return ctx.chainId;
  if (ctx.chain && typeof ctx.chain.id === "number") return ctx.chain.id;
  return undefined;
}

function buildExtras(
  receipt: unknown,
  ctx?: ChainContext
): ToastExtras | undefined {
  const txHash = extractTxHash(receipt);
  if (!txHash) return undefined;
  const chainId = resolveChainId(ctx);
  const explorerUrl =
    getExplorerTxUrl(txHash, {
      chainId,
      chain: ctx?.chain ?? undefined,
    }) || undefined;
  return { txHash, explorerUrl };
}

export function notifyWithReceipt(
  toast: ToastLike | undefined,
  ctx: ChainContext | undefined,
  title: string,
  message?: string,
  receipt?: unknown
) {
  if (!toast) return;
  if (!receipt) {
    toast.showSuccess(title, message);
    return;
  }
  const extras = buildExtras(receipt, ctx);
  toast.showSuccess(title, message, extras);
}

export function createReceiptNotifier(
  toast: ToastLike | undefined,
  ctx?: ChainContext
) {
  return (title: string, message?: string, receipt?: unknown) =>
    notifyWithReceipt(toast, ctx, title, message, receipt);
}

export function receiptExtras(
  receipt: unknown,
  ctx?: ChainContext
): ToastExtras | undefined {
  return buildExtras(receipt, ctx);
}
