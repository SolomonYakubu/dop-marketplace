"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { useToastContext } from "@/components/providers";
import Link from "next/link";
import { ConfirmModal } from "@/components/ConfirmModal";
import { toGatewayUrl, fetchIpfsJson } from "@/lib/utils";
import Image from "next/image";

function Address({ value }: { value?: string }) {
  if (!value) return <span className="text-gray-400">-</span>;
  const short = value.slice(0, 6) + "…" + value.slice(-4);
  return (
    <span className="font-mono" title={value}>
      {short}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-lg">{value}</div>
    </div>
  );
}

// Dispute payload shape (uploaded JSON to IPFS)
type DisputePayload = {
  type?: string;
  offerId?: string | number;
  listingId?: string | number;
  author?: string;
  role?: string; // "client" | "provider"
  reason?: string;
  attachments?: string[]; // ipfs:// or CID
  createdAt?: number; // ms or seconds
};

function tsToDateString(ts?: number) {
  if (!ts && ts !== 0) return "-";
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ts);
  }
}

async function loadJsonFromCid(cidOrUri: string, timeoutMs = 5500) {
  // Add a global/overall timeout safeguard so we never stay stuck in a loading state
  const overallMs = Math.max(timeoutMs + 3000, 8000); // at least 8s overall
  try {
    const result = await Promise.race([
      fetchIpfsJson(cidOrUri, { timeoutMs }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("global-timeout")), overallMs)
      ),
    ]);
    return result;
  } catch (e) {
    console.warn("loadJsonFromCid failed", cidOrUri, e);
    throw e;
  }
}

function AttachmentPreview({ uri }: { uri: string }) {
  const [showImg, setShowImg] = useState(true);
  const href = toGatewayUrl(uri) || uri;
  return (
    <div className="space-y-1">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-xs underline decoration-dotted break-all"
      >
        {href}
      </a>
      {showImg && (
        <div className="relative w-full max-w-xs">
          <Image
            src={href}
            alt="attachment"
            width={512}
            height={512}
            className="h-auto w-full max-h-48 rounded border border-white/10 object-contain"
            onError={() => setShowImg(false)}
          />
        </div>
      )}
    </div>
  );
}

function DisputePayloadView({ payload }: { payload: DisputePayload | null }) {
  if (!payload)
    return <div className="text-xs text-gray-500">No metadata found.</div>;
  return (
    <div className="text-xs text-gray-300 space-y-1">
      <div className="flex flex-wrap gap-4">
        <span>
          Type: <span className="text-white">{payload.type || "-"}</span>
        </span>
        <span>
          Offer ID:{" "}
          <span className="text-white">{String(payload.offerId ?? "-")}</span>
        </span>
        <span>
          Listing ID:{" "}
          <span className="text-white">{String(payload.listingId ?? "-")}</span>
        </span>
        <span>
          Author: <Address value={payload.author || undefined} />
        </span>
        <span>
          Role: <span className="text-white">{payload.role || "-"}</span>
        </span>
        <span>
          Created:{" "}
          <span className="text-white">
            {tsToDateString(Number(payload.createdAt))}
          </span>
        </span>
      </div>
      {payload.reason && (
        <div className="mt-2">
          <div className="text-gray-400">Reason</div>
          <div className="whitespace-pre-wrap">{payload.reason}</div>
        </div>
      )}
      {payload.attachments && payload.attachments.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="text-gray-400">Attachments</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {payload.attachments.map((a, i) => (
              <AttachmentPreview key={i} uri={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { contract } = useMarketplaceContract();
  const toast = useToastContext();

  const [owner, setOwner] = useState<string | null>(null);
  const [paused, setPaused] = useState<boolean>(false);
  const [treasury, setTreasury] = useState<string | null>(null);
  const [dop, setDop] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [router, setRouter] = useState<string | null>(null);
  const [weth, setWeth] = useState<string | null>(null);
  const [fees, setFees] = useState<{
    feeUsdLike: bigint;
    feeDop: bigint;
  } | null>(null);
  const [boostParams, setBoostParams] = useState<{
    price: bigint;
    duration: bigint;
  } | null>(null);
  const [profileBoostParams, setProfileBoostParams] = useState<{
    price: bigint;
    duration: bigint;
  } | null>(null);

  // Form state
  const [feeUsdPct, setFeeUsdPct] = useState<string>("");
  const [feeDopPct, setFeeDopPct] = useState<string>("");
  const [boostPriceWei, setBoostPriceWei] = useState<string>("");
  const [boostDurationDays, setBoostDurationDays] = useState<string>("");
  const [profileBoostPriceWei, setProfileBoostPriceWei] = useState<string>("");
  const [profileBoostDurationDays, setProfileBoostDurationDays] =
    useState<string>("");
  const [treasuryInput, setTreasuryInput] = useState<string>("");
  const [dopInput, setDopInput] = useState<string>("");
  const [usdcInput, setUsdcInput] = useState<string>("");
  const [routerInput, setRouterInput] = useState<string>("");
  const [wethInput, setWethInput] = useState<string>("");
  const [verifyAddress, setVerifyAddress] = useState<string>("");
  const [disputeOfferId, setDisputeOfferId] = useState<string>("");
  const [disputeOutcome, setDisputeOutcome] = useState<string>("2"); // default SPLIT

  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message?: React.ReactNode;
    action?: () => Promise<void>;
  }>({ open: false, title: "", message: undefined, action: undefined });

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const isLoading = (key: string) => loadingKey === key;

  // Tabs
  const [activeTab, setActiveTab] = useState<
    "overview" | "config" | "disputes"
  >("overview");

  // Disputes state (admin view)
  // New pagination via contract getDisputedOffers
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [pageLimit, setPageLimit] = useState<number>(25);
  const [pageIds, setPageIds] = useState<bigint[]>([]);
  const [pageLoading, setPageLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [headers, setHeaders] = useState<
    Record<
      string,
      { cid: string; openedBy: string; openedAt: bigint; appealsCount: bigint }
    >
  >({});
  const [appeals, setAppeals] = useState<
    Record<string, Array<{ by: string; cid: string; timestamp: bigint }>>
  >({});

  // New: payloads loaded from IPFS
  const [disputePayloads, setDisputePayloads] = useState<
    Record<string, DisputePayload | null | undefined>
  >({});
  const [appealPayloads, setAppealPayloads] = useState<
    Record<string, Array<DisputePayload | null | undefined>>
  >({});
  const [payloadLoading, setPayloadLoading] = useState<Record<string, boolean>>(
    {}
  );
  // Slow-loading flags
  const [slowLoading, setSlowLoading] = useState<Record<string, boolean>>({});
  // New: track escrow status for classification (pending vs resolved)
  const [disputeStatuses, setDisputeStatuses] = useState<
    Record<string, number>
  >({});
  // EscrowStatus enum indices (keep in sync with contract)
  const ESCROW_STATUS = {
    DISPUTED: 3,
    RESOLVED: 4,
  } as const;
  // Disputes view sub-tab
  const [disputesView, setDisputesView] = useState<"pending" | "resolved">(
    "pending"
  );

  const isOwner = useMemo(() => {
    if (!address || !owner) return false;
    return address.toLowerCase() === owner.toLowerCase();
  }, [address, owner]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!contract) return;
      try {
        const [o, p, t, dopAddr, usdcAddr, f, b, pb, r, w] = await Promise.all([
          contract.getOwner().catch(() => null),
          contract.isPaused().catch(() => false),
          contract.getTreasury().catch(() => null),
          contract.getDopToken().catch(() => null),
          contract.getUsdcToken().catch(() => null),
          contract.getFees().catch(() => null),
          contract.getBoostParams().catch(() => null),
          contract.getProfileBoostParams().catch(() => null),
          contract.getDexRouter().catch(() => null),
          contract.getWeth().catch(() => null),
        ]);
        if (cancelled) return;
        setOwner(o);
        setPaused(!!p);
        setTreasury(t);
        setDop(dopAddr);
        setUsdc(usdcAddr);
        setFees(f);
        setBoostParams(b);
        setProfileBoostParams(pb);
        setRouter(r);
        setWeth(w);

        // Prefill form inputs
        if (f) {
          setFeeUsdPct((Number(f.feeUsdLike) / 100).toString());
          setFeeDopPct((Number(f.feeDop) / 100).toString());
        }
        if (b) {
          setBoostPriceWei(b.price.toString());
          setBoostDurationDays((Number(b.duration) / 86400).toString());
        }
        if (pb) {
          setProfileBoostPriceWei(pb.price.toString());
          setProfileBoostDurationDays((Number(pb.duration) / 86400).toString());
        }
        if (t) setTreasuryInput(t);
        if (dopAddr) setDopInput(dopAddr);
        if (usdcAddr) setUsdcInput(usdcAddr);
        if (r) setRouterInput(r);
        if (w) setWethInput(w);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(e);
        toast.showError("Failed to load admin data", message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [contract, toast]);

  const requireOwner = () => {
    if (!isOwner) {
      toast.showError("Not authorized", "Connect as contract owner");
      return false;
    }
    return true;
  };

  const withConfirm = (
    title: string,
    message: React.ReactNode,
    key: string,
    action: () => Promise<void>
  ) => {
    if (!requireOwner()) return;
    setConfirm({
      open: true,
      title,
      message,
      action: async () => {
        setConfirm((c) => ({ ...c, open: false }));
        try {
          setLoadingKey(key);
          await action();
        } finally {
          setLoadingKey(null);
        }
      },
    });
  };

  // Actions
  const handlePauseToggle = () => {
    if (!contract) return;
    const next = !paused;
    withConfirm(
      next ? "Pause contract" : "Unpause contract",
      <div>
        <p>
          Are you sure you want to {next ? "pause" : "unpause"} the marketplace?
        </p>
      </div>,
      "pause",
      async () => {
        try {
          const tx = next ? await contract.pause() : await contract.unpause();
          await tx.wait?.();
          setPaused(next);
          toast.showSuccess(
            "Success",
            `Contract ${next ? "paused" : "unpaused"}`
          );
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Action failed", message);
        }
      }
    );
  };

  const handleSetFees = () => {
    if (!contract) return;
    const usdBps = Math.round(Number(feeUsdPct || "0") * 100);
    const dopBps = Math.round(Number(feeDopPct || "0") * 100);
    withConfirm(
      "Update fees",
      <div className="space-y-1">
        <p>USD-like: {usdBps / 100}%</p>
        <p>DOP: {dopBps / 100}%</p>
      </div>,
      "fees",
      async () => {
        try {
          const receipt = await contract.setFees(
            BigInt(usdBps),
            BigInt(dopBps)
          );
          await receipt.wait?.();
          setFees({ feeUsdLike: BigInt(usdBps), feeDop: BigInt(dopBps) });
          toast.showSuccess("Fees updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update fees", message);
        }
      }
    );
  };

  const handleSetBoostParams = () => {
    if (!contract) return;
    const price = BigInt(boostPriceWei || "0");
    const duration = BigInt(
      Math.round(Number(boostDurationDays || "0") * 86400)
    );
    withConfirm(
      "Update listing boost params",
      <div className="space-y-1">
        <p>Price (wei): {price.toString()}</p>
        <p>Duration: {Number(duration) / 86400} days</p>
      </div>,
      "boost",
      async () => {
        try {
          const receipt = await contract.setBoostParams(price, duration);
          await receipt.wait?.();
          setBoostParams({ price, duration });
          toast.showSuccess("Listing boost params updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update boost params", message);
        }
      }
    );
  };

  const handleSetProfileBoostParams = () => {
    if (!contract) return;
    const price = BigInt(profileBoostPriceWei || "0");
    const duration = BigInt(
      Math.round(Number(profileBoostDurationDays || "0") * 86400)
    );
    withConfirm(
      "Update profile boost params",
      <div className="space-y-1">
        <p>Price (wei): {price.toString()}</p>
        <p>Duration: {Number(duration) / 86400} days</p>
      </div>,
      "pboost",
      async () => {
        try {
          const receipt = await contract.setProfileBoostParams(price, duration);
          await receipt.wait?.();
          setProfileBoostParams({ price, duration });
          toast.showSuccess("Profile boost params updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update profile boost params", message);
        }
      }
    );
  };

  const handleSetTreasury = () => {
    if (!contract) return;
    const addr = treasuryInput.trim();
    withConfirm(
      "Update treasury",
      <p>New treasury: {addr}</p>,
      "treasury",
      async () => {
        try {
          const receipt = await contract.setTreasury(addr);
          await receipt.wait?.();
          setTreasury(addr);
          toast.showSuccess("Treasury updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update treasury", message);
        }
      }
    );
  };

  const handleSetTokens = () => {
    if (!contract) return;
    const dopAddr = dopInput.trim();
    const usdcAddr = usdcInput.trim();
    withConfirm(
      "Update tokens",
      <div>
        <p>DOP: {dopAddr}</p>
        <p>USDC: {usdcAddr || "(none)"}</p>
      </div>,
      "tokens",
      async () => {
        try {
          const receipt = await contract.setTokens(dopAddr, usdcAddr);
          await receipt.wait?.();
          setDop(dopAddr);
          setUsdc(usdcAddr);
          toast.showSuccess("Tokens updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update tokens", message);
        }
      }
    );
  };

  const handleSetRouter = () => {
    if (!contract) return;
    const dr = routerInput.trim();
    const w = wethInput.trim();
    withConfirm(
      "Update DEX router",
      <div>
        <p>Router: {dr}</p>
        <p>WETH: {w}</p>
      </div>,
      "router",
      async () => {
        try {
          const receipt = await contract.setDexRouter(dr, w);
          await receipt.wait?.();
          setRouter(dr);
          setWeth(w);
          toast.showSuccess("DEX router updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to update router", message);
        }
      }
    );
  };

  const handleVerifyProfile = () => {
    if (!contract) return;
    const u = verifyAddress.trim();
    withConfirm(
      "Verify profile",
      <p>Verify user: {u}</p>,
      "verify",
      async () => {
        try {
          const receipt = await contract.verifyProfile(u);
          await receipt.wait?.();
          toast.showSuccess("Profile verified");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to verify profile", message);
        }
      }
    );
  };

  const handleResolveDispute = () => {
    if (!contract) return;
    const id = BigInt(disputeOfferId || "0");
    const out = Number(disputeOutcome);
    withConfirm(
      "Resolve dispute",
      <div>
        <p>Offer ID: {id.toString()}</p>
        <p>Outcome: {out} (1=REFUND_CLIENT, 2=SPLIT, 3=PAY_PROVIDER)</p>
      </div>,
      "resolve",
      async () => {
        try {
          const receipt = await contract.resolveDispute(id, out);
          await receipt.wait?.();
          toast.showSuccess("Dispute resolved");
          // refresh lists
          void refreshDisputesPage();
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to resolve dispute", message);
        }
      }
    );
  };

  // Paginate disputes via contract
  const refreshDisputesPage = async () => {
    if (!contract) return;
    setPageLoading(true);
    try {
      const { page } = await contract.getDisputedOffers(pageOffset, pageLimit);
      setPageIds(page);
      // prefetch headers + statuses for visible page
      const headerPromises = page.map(async (id) => {
        const h = await contract.getDisputeHeader(id);
        return [id.toString(), h] as const;
      });
      const statusPromises = page.map(async (id) => {
        try {
          const e = await contract.getEscrow(id);
          return [id.toString(), Number(e.status)] as const;
        } catch {
          return [id.toString(), -1] as const; // unknown
        }
      });
      const [entries, statusEntries] = await Promise.all([
        Promise.all(headerPromises),
        Promise.all(statusPromises),
      ]);
      setHeaders((prev) => {
        const merged: typeof prev = { ...prev };
        for (const [k, v] of entries) merged[k] = v;
        return merged;
      });
      setDisputeStatuses((prev) => {
        const merged: typeof prev = { ...prev };
        for (const [k, v] of statusEntries) merged[k] = v;
        return merged;
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.showError("Failed to load disputed offers", message);
    } finally {
      setPageLoading(false);
    }
  };

  // Lazy-load dispute + appeal payloads for an offer when expanded
  const ensurePayloadsLoaded = async (offerId: bigint) => {
    const key = offerId.toString();
    const h = headers[key];
    if (!h || !h.cid) return;

    // Load dispute JSON (header)
    if (disputePayloads[key] === undefined) {
      setPayloadLoading((m) => ({ ...m, [key]: true }));
      // mark slow-load timer
      setSlowLoading((m) => ({ ...m, [key]: false }));
      const slowTimer = setTimeout(() => {
        setSlowLoading((m) => {
          if (disputePayloads[key] !== undefined) return m; // already loaded
          return { ...m, [key]: true };
        });
      }, 2500);
      // Hard fail timer to avoid indefinite "loading" state
      const hardFailTimer = setTimeout(() => {
        setDisputePayloads((m) => {
          if (m[key] === undefined) {
            return { ...m, [key]: null };
          }
          return m;
        });
        setPayloadLoading((m) => ({ ...m, [key]: false }));
      }, 12000); // 12s absolute cap
      try {
        const raw = await loadJsonFromCid(h.cid);
        const data = (raw || {}) as DisputePayload;
        setDisputePayloads((m) => ({ ...m, [key]: data }));
      } catch {
        setDisputePayloads((m) => ({ ...m, [key]: null }));
      } finally {
        clearTimeout(slowTimer);
        clearTimeout(hardFailTimer);
        setPayloadLoading((m) => ({ ...m, [key]: false }));
      }
    }

    // Ensure appeals list first
    if (!appeals[key] && contract) {
      try {
        const items = await contract.getDisputeAppeals(offerId);
        setAppeals((prev) => ({ ...prev, [key]: items }));
      } catch {}
    }

    // Load appeal JSONs
    const items = appeals[key] || [];
    if (items.length > 0 && !appealPayloads[key]) {
      try {
        const payloads = await Promise.all(
          items.map(async (a) => {
            try {
              // Add a race with a per-appeal overall timeout as well
              const raw = await loadJsonFromCid(a.cid);
              return (raw || {}) as DisputePayload;
            } catch {
              return null;
            }
          })
        );
        setAppealPayloads((m) => ({ ...m, [key]: payloads }));
      } catch {
        setAppealPayloads((m) => ({ ...m, [key]: [] }));
      }
    }
  };

  const retryDisputePayload = async (offerId: bigint) => {
    const key = offerId.toString();
    // Reset and reload
    setDisputePayloads((m) => ({ ...m, [key]: undefined }));
    await ensurePayloadsLoaded(offerId);
  };

  const retryAppealPayload = async (offerId: bigint, idx: number) => {
    const key = offerId.toString();
    const items = appeals[key] || [];
    if (!items[idx]) return;
    setAppealPayloads((m) => {
      const current = (m[key] || []).slice();
      current[idx] = undefined; // mark for reload
      return { ...m, [key]: current };
    });
    try {
      const raw = await loadJsonFromCid(items[idx].cid);
      setAppealPayloads((m) => {
        const current = (m[key] || []).slice();
        current[idx] = (raw || {}) as DisputePayload;
        return { ...m, [key]: current };
      });
    } catch {
      setAppealPayloads((m) => {
        const current = (m[key] || []).slice();
        current[idx] = null; // failed again
        return { ...m, [key]: current };
      });
    }
  };

  useEffect(() => {
    if (activeTab === "disputes") {
      void refreshDisputesPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pageOffset, pageLimit, contract]);

  const toggleExpand = async (offerId: bigint) => {
    const key = offerId.toString();
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    // lazy-load appeals + payloads when expanding
    if (!expanded[key]) {
      try {
        await ensurePayloadsLoaded(offerId);
      } catch (e) {
        console.warn("Failed to load dispute metadata:", e);
      }
    }
  };

  return (
    <div className="space-y-8">
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={() => confirm.action?.()}
        confirmText="Proceed"
        danger={true}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <Link href="/" className="text-sm text-gray-300 hover:text-white">
          Back to app
        </Link>
      </div>

      {!isConnected && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-200">
          Connect your wallet to continue.
        </div>
      )}

      {isConnected && owner && !isOwner && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-200">
          You are not the contract owner. Admin actions are disabled.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: "overview", label: "Overview" },
          { key: "config", label: "Configuration" },
          { key: "disputes", label: "Disputes" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              activeTab === t.key
                ? "bg-white/20 border-white/30"
                : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Stat label="Owner" value={<Address value={owner ?? undefined} />} />
          <Stat
            label="Paused"
            value={
              <span className={paused ? "text-red-400" : "text-green-400"}>
                {paused ? "Yes" : "No"}
              </span>
            }
          />
          <Stat
            label="Treasury"
            value={<Address value={treasury ?? undefined} />}
          />
          <Stat
            label="DOP Token"
            value={<Address value={dop ?? undefined} />}
          />
          <Stat
            label="USDC Token"
            value={<Address value={usdc ?? undefined} />}
          />
          <Stat
            label="DEX Router"
            value={<Address value={router ?? undefined} />}
          />
          <Stat label="WETH" value={<Address value={weth ?? undefined} />} />
          <Stat
            label="Fee USDC-like"
            value={
              <span>{fees ? Number(fees.feeUsdLike) / 100 + "%" : "-"}</span>
            }
          />
          <Stat
            label="Fee DOP"
            value={<span>{fees ? Number(fees.feeDop) / 100 + "%" : "-"}</span>}
          />
          <Stat
            label="Boost Price (DOP wei)"
            value={
              <span className="font-mono">
                {boostParams?.price?.toString() ?? "-"}
              </span>
            }
          />
          <Stat
            label="Boost Duration"
            value={
              <span>
                {boostParams
                  ? `${Number(boostParams.duration) / (60 * 60 * 24)} days`
                  : "-"}
              </span>
            }
          />
          <Stat
            label="Profile Boost Price (DOP wei)"
            value={
              <span className="font-mono">
                {profileBoostParams?.price?.toString() ?? "-"}
              </span>
            }
          />
          <Stat
            label="Profile Boost Duration"
            value={
              <span>
                {profileBoostParams
                  ? `${
                      Number(profileBoostParams.duration) / (60 * 60 * 24)
                    } days`
                  : "-"}
              </span>
            }
          />
        </section>
      )}

      {activeTab === "config" && (
        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-6">
          <h2 className="text-lg font-medium">Admin Actions</h2>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-gray-300">
                Pause / Unpause contract
              </div>
              <div className="text-xs text-gray-400 mb-1">
                Current: {paused ? "Paused" : "Active"}
              </div>
            </div>
            <button
              disabled={!isOwner || isLoading("pause")}
              onClick={handlePauseToggle}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                paused
                  ? "bg-green-600 hover:bg-green-500"
                  : "bg-yellow-600 hover:bg-yellow-500"
              } text-white disabled:opacity-50`}
            >
              {isLoading("pause")
                ? "Processing..."
                : paused
                ? "Unpause"
                : "Pause"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fees */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Fees</div>
              <label className="block text-xs text-gray-400 mb-1">
                USD-like fee (%)
              </label>
              <input
                value={feeUsdPct}
                onChange={(e) => setFeeUsdPct(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
                placeholder="e.g. 20"
                inputMode="decimal"
              />
              <label className="block text-xs text-gray-400 mb-1">
                DOP fee (%)
              </label>
              <input
                value={feeDopPct}
                onChange={(e) => setFeeDopPct(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
                placeholder="e.g. 10"
                inputMode="decimal"
              />
              <button
                disabled={!isOwner || isLoading("fees")}
                onClick={handleSetFees}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("fees") ? "Updating..." : "Update fees"}
              </button>
            </div>

            {/* Listing Boost */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Listing Boost</div>
              <label className="block text-xs text-gray-400 mb-1">
                Price (DOP wei)
              </label>
              <input
                value={boostPriceWei}
                onChange={(e) => setBoostPriceWei(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="1000000000000000000000"
              />
              <label className="block text-xs text-gray-400 mb-1">
                Duration (days)
              </label>
              <input
                value={boostDurationDays}
                onChange={(e) => setBoostDurationDays(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
                placeholder="7"
                inputMode="decimal"
              />
              <button
                disabled={!isOwner || isLoading("boost")}
                onClick={handleSetBoostParams}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("boost") ? "Updating..." : "Update listing boost"}
              </button>
            </div>

            {/* Profile Boost */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Profile Boost</div>
              <label className="block text-xs text-gray-400 mb-1">
                Price (DOP wei)
              </label>
              <input
                value={profileBoostPriceWei}
                onChange={(e) => setProfileBoostPriceWei(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="1000000000000000000000"
              />
              <label className="block text-xs text-gray-400 mb-1">
                Duration (days)
              </label>
              <input
                value={profileBoostDurationDays}
                onChange={(e) => setProfileBoostDurationDays(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
                placeholder="7"
                inputMode="decimal"
              />
              <button
                disabled={!isOwner || isLoading("pboost")}
                onClick={handleSetProfileBoostParams}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("pboost") ? "Updating..." : "Update profile boost"}
              </button>
            </div>

            {/* Treasury */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Treasury</div>
              <label className="block text-xs text-gray-400 mb-1">
                Treasury address
              </label>
              <input
                value={treasuryInput}
                onChange={(e) => setTreasuryInput(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <button
                disabled={!isOwner || isLoading("treasury")}
                onClick={handleSetTreasury}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("treasury") ? "Updating..." : "Update treasury"}
              </button>
            </div>

            {/* Tokens */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Tokens</div>
              <label className="block text-xs text-gray-400 mb-1">
                DOP token
              </label>
              <input
                value={dopInput}
                onChange={(e) => setDopInput(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <label className="block text-xs text-gray-400 mb-1">
                USDC token (optional)
              </label>
              <input
                value={usdcInput}
                onChange={(e) => setUsdcInput(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x... or 0x000..."
              />
              <button
                disabled={!isOwner || isLoading("tokens")}
                onClick={handleSetTokens}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("tokens") ? "Updating..." : "Update tokens"}
              </button>
            </div>

            {/* DEX Router */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">DEX Router</div>
              <label className="block text-xs text-gray-400 mb-1">Router</label>
              <input
                value={routerInput}
                onChange={(e) => setRouterInput(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <label className="block text-xs text-gray-400 mb-1">WETH</label>
              <input
                value={wethInput}
                onChange={(e) => setWethInput(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <button
                disabled={!isOwner || isLoading("router")}
                onClick={handleSetRouter}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("router") ? "Updating..." : "Update router"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Verify profile */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Verify Profile</div>
              <label className="block text-xs text-gray-400 mb-1">
                User address
              </label>
              <input
                value={verifyAddress}
                onChange={(e) => setVerifyAddress(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <button
                disabled={!isOwner || isLoading("verify")}
                onClick={handleVerifyProfile}
                className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoading("verify") ? "Verifying..." : "Verify profile"}
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "disputes" && (
        <section className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Disputed Offers</h2>
                <p className="text-xs text-gray-400">
                  Paginated via contract. Separated into pending (open) and
                  resolved.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Limit</label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={pageLimit}
                  onChange={(e) => setPageLimit(Number(e.target.value || 0))}
                  className="w-20 rounded bg-black/40 border border-white/10 px-2 py-1 text-sm"
                />
                <label className="text-xs text-gray-400">Offset</label>
                <input
                  type="number"
                  min={0}
                  value={pageOffset}
                  onChange={(e) => setPageOffset(Number(e.target.value || 0))}
                  className="w-24 rounded bg-black/40 border border-white/10 px-2 py-1 text-sm"
                />
                <button
                  onClick={refreshDisputesPage}
                  disabled={pageLoading}
                  className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {pageLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
            </div>

            {/* Classification */}
            {(() => {
              const pending = pageIds.filter((id) => {
                const s = disputeStatuses[id.toString()];
                return s === undefined || s === ESCROW_STATUS.DISPUTED;
              });
              const resolved = pageIds.filter(
                (id) =>
                  disputeStatuses[id.toString()] === ESCROW_STATUS.RESOLVED
              );

              const renderRow = (id: bigint) => {
                const key = id.toString();
                const h = headers[key];
                const payload = disputePayloads[key];
                const isMetaLoading = !!payloadLoading[key];
                return (
                  <div key={key} className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <span>Offer #{key}</span>
                          {disputeStatuses[key] === ESCROW_STATUS.RESOLVED && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-600/30 border border-green-500/40 text-green-300">
                              Resolved
                            </span>
                          )}
                          {disputeStatuses[key] === ESCROW_STATUS.DISPUTED && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-600/30 border border-yellow-500/40 text-yellow-200">
                              Pending
                            </span>
                          )}
                        </div>
                        {h ? (
                          <div className="text-gray-400 text-xs flex flex-wrap gap-3">
                            <span>
                              Opened By: <Address value={h.openedBy} />
                            </span>
                            <span>
                              Opened At:{" "}
                              {new Date(
                                Number(h.openedAt) * 1000
                              ).toLocaleString()}
                            </span>
                            {h.cid && (
                              <span>
                                CID: {""}
                                <a
                                  className="underline decoration-dotted"
                                  href={`https://ipfs.io/ipfs/${h.cid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {h.cid.slice(0, 18)}…
                                </a>
                              </span>
                            )}
                            <span>Appeals: {String(h.appealsCount)}</span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">
                            Loading header…
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleExpand(id)}
                          className="rounded-md border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10"
                        >
                          {expanded[key] ? "Hide" : "Details"}
                        </button>
                        <Link
                          href={`/offers/${key}`}
                          className="text-xs text-gray-300 hover:text-white underline"
                        >
                          View Offer
                        </Link>
                      </div>
                    </div>

                    {expanded[key] && (
                      <div className="mt-3 rounded-md bg-black/30 border border-white/10 p-3">
                        <EscrowSummary offerId={id} />
                        <div className="mt-3">
                          <div className="font-medium mb-1">
                            Dispute Details
                          </div>
                          {!h?.cid ? (
                            <div className="text-xs text-gray-500">
                              No CID recorded.
                            </div>
                          ) : isMetaLoading && payload === undefined ? (
                            <div className="text-xs text-gray-500 flex items-center gap-2">
                              {slowLoading[key]
                                ? "Still loading metadata (slow)…"
                                : "Loading metadata…"}
                            </div>
                          ) : payload === null ? (
                            <div className="text-xs text-red-400 flex items-center gap-2">
                              <span>Failed to load metadata.</span>
                              <button
                                onClick={() => retryDisputePayload(id)}
                                className="underline decoration-dotted text-red-300 hover:text-red-200"
                              >
                                Retry
                              </button>
                            </div>
                          ) : payload === undefined ? (
                            <div className="text-xs text-gray-500 flex items-center gap-2">
                              {slowLoading[key]
                                ? "Still loading metadata (slow)…"
                                : "Loading metadata…"}
                            </div>
                          ) : (
                            <div className="rounded border border-white/10 p-2">
                              <DisputePayloadView payload={payload} />
                            </div>
                          )}
                        </div>
                        <div className="mt-3">
                          <div className="font-medium mb-1">Appeals</div>
                          {(!appeals[key] || appeals[key].length === 0) && (
                            <div className="text-xs text-gray-400">
                              No appeals recorded.
                            </div>
                          )}
                          <div className="space-y-2">
                            {(appeals[key] || []).map((a, idx) => {
                              const ap = (appealPayloads[key] || [])[idx];
                              return (
                                <div
                                  key={idx}
                                  className="rounded border border-white/10 p-2 text-xs text-gray-300"
                                >
                                  <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <span>
                                      By: <Address value={a.by} />
                                    </span>
                                    <span>
                                      At:{" "}
                                      {new Date(
                                        Number(a.timestamp) * 1000
                                      ).toLocaleString()}
                                    </span>
                                    <span>
                                      CID: {""}
                                      <a
                                        className="underline decoration-dotted"
                                        href={`https://ipfs.io/ipfs/${a.cid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {a.cid.slice(0, 18)}…
                                      </a>
                                    </span>
                                  </div>
                                  {ap === undefined ? (
                                    <div className="text-xs text-gray-500">
                                      Loading metadata…
                                    </div>
                                  ) : ap === null ? (
                                    <div className="text-xs text-red-400 flex items-center gap-2">
                                      <span>Failed to load metadata.</span>
                                      <button
                                        onClick={() => retryAppealPayload(id, idx)}
                                        className="underline decoration-dotted text-red-300 hover:text-red-200"
                                      >
                                        Retry
                                      </button>
                                    </div>
                                  ) : (
                                    <DisputePayloadView payload={ap} />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              };

              // Sub-tabs UI
              return (
                <div className="mt-4">
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => setDisputesView("pending")}
                      className={`px-3 py-1.5 text-xs rounded-md border ${
                        disputesView === "pending"
                          ? "bg-white/20 border-white/30"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      Pending ({pending.length})
                    </button>
                    <button
                      onClick={() => setDisputesView("resolved")}
                      className={`px-3 py-1.5 text-xs rounded-md border ${
                        disputesView === "resolved"
                          ? "bg-white/20 border-white/30"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      Resolved ({resolved.length})
                    </button>
                  </div>
                  <div className="divide-y divide-white/10">
                    {disputesView === "pending" && (
                      <>
                        {pending.length === 0 && !pageLoading && (
                          <div className="text-sm text-gray-400">
                            No pending disputes.
                          </div>
                        )}
                        {pending.map(renderRow)}
                        {pageLoading && pending.length === 0 && (
                          <div className="text-sm text-gray-500">Loading…</div>
                        )}
                      </>
                    )}
                    {disputesView === "resolved" && (
                      <>
                        {resolved.length === 0 && !pageLoading && (
                          <div className="text-sm text-gray-400">
                            No resolved disputes.
                          </div>
                        )}
                        {resolved.map(renderRow)}
                        {pageLoading && resolved.length === 0 && (
                          <div className="text-sm text-gray-500">Loading…</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Resolve Dispute */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="font-medium mb-2">Resolve Dispute</div>
            <label className="block text-xs text-gray-400 mb-1">Offer ID</label>
            <input
              value={disputeOfferId}
              onChange={(e) => setDisputeOfferId(e.target.value)}
              className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
              placeholder="e.g. 12"
              inputMode="numeric"
            />
            <label className="block text-xs text-gray-400 mb-1">Outcome</label>
            <select
              value={disputeOutcome}
              onChange={(e) => setDisputeOutcome(e.target.value)}
              className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
            >
              <option value="1">1 - REFUND_CLIENT</option>
              <option value="2">2 - SPLIT</option>
              <option value="3">3 - PAY_PROVIDER</option>
            </select>
            <button
              disabled={!isOwner || isLoading("resolve")}
              onClick={handleResolveDispute}
              className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
            >
              {isLoading("resolve") ? "Resolving..." : "Resolve dispute"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function EscrowSummary({ offerId }: { offerId: bigint }) {
  const { contract } = useMarketplaceContract();
  const [data, setData] = useState<{
    client: string;
    provider: string;
    token: string;
    amount: string;
    status: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!contract) return;
      try {
        const e = await contract.getEscrow(offerId);
        if (cancelled) return;
        setData({
          client: e.client,
          provider: e.provider,
          token: e.paymentToken,
          amount: e.amount.toString(),
          status: Number(e.status),
        });
      } catch {}
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contract, offerId]);

  if (!data)
    return <div className="text-xs text-gray-500">Loading escrow…</div>;
  return (
    <div className="rounded border border-white/10 p-2 text-xs text-gray-300">
      <div className="flex flex-wrap gap-3">
        <span>
          Client: <Address value={data.client} />
        </span>
        <span>
          Provider: <Address value={data.provider} />
        </span>
        <span>
          Amount: <span className="font-mono">{data.amount}</span>
        </span>
        <span>
          Token: <Address value={data.token} />
        </span>
        <span>Status: {data.status}</span>
      </div>
    </div>
  );
}
