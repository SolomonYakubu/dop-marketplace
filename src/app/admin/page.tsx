"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { useToastContext } from "@/components/providers";
import Link from "next/link";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  toGatewayUrl,
  fetchIpfsJson,
  formatTokenAmount,
  type KnownTokens,
} from "@/lib/utils";
import Image from "next/image";
import { ethers } from "ethers";
import {
  Copy,
  Check,
  Gavel,
  Scale,
  Settings,
  ArrowLeft,
  PiggyBank,
  Coins,
  CircleDollarSign,
  Share2,
  User as UserIcon,
  Pause,
  Play,
  RefreshCw,
  BadgeCheck,
  Clock,
  ChevronDown,
  ChevronRight,
  Eye,
  RotateCcw,
  Briefcase,
  Hammer,
  Users,
  Activity,
  BarChart3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ListingType } from "@/types/marketplace";
import type { OnchainUserProfile } from "@/types/marketplace";

function Address({ value }: { value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-gray-400">-</span>;
  const short = value.slice(0, 6) + "…" + value.slice(-4);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 font-mono text-left group hover:text-white text-gray-200"
      title={`${value}\nClick to copy`}
    >
      <span>{short}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
      )}
    </button>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-400">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg">{value}</div>
    </div>
  );
}

// Compact metric card for the dashboard grid
function MetricCard({
  label,
  value,
  icon: Icon,
  loading,
  tooltip,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  loading?: boolean;
  tooltip?: string;
}) {
  const display =
    typeof value === "number"
      ? new Intl.NumberFormat(undefined, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value)
      : value;
  return (
    <div
      className="rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4"
      title={tooltip || undefined}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-gray-400">
          {label}
        </div>
        <div className="rounded-md p-1.5 bg-white/10">
          <Icon className="h-4 w-4 opacity-80" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold">
        {loading ? (
          <span className="inline-block h-6 w-20 rounded bg-white/10 animate-pulse" />
        ) : (
          display
        )}
      </div>
    </div>
  );
}

function StarBadge() {
  return (
    <span className="inline-flex items-center justify-center rounded-full p-1.5 bg-amber-500/15 border border-amber-400/30 text-amber-300">
      <BadgeCheck className="h-4 w-4" />
    </span>
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

// (Removed tsToDateString; not needed in minimal chat view)

async function loadJsonFromCid(cidOrUri: string, timeoutMs = 5500) {
  return await fetchIpfsJson(cidOrUri, { timeoutMs });
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
    <div className="text-xs text-gray-300 space-y-2">
      {payload.reason && (
        <div className="whitespace-pre-wrap">{payload.reason}</div>
      )}
      {payload.attachments && payload.attachments.length > 0 && (
        <div className="space-y-2">
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
  // Prevent SSR/Client hydration mismatches for wallet-dependent UI
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [owner, setOwner] = useState<string[]>([]);
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
  console.log("Owner state:", owner[0]);
  // Dashboard metrics
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<{
    totalListings: number;
    totalBriefs: number;
    totalGigs: number;
    uniqueCreators: number; // proxy for freelancers
    totalOffers: number;
    activeListingBoosts: number;
    activeProfileBoosts: number;
    disputesPending: number;
    disputesResolved: number;
  }>({
    totalListings: 0,
    totalBriefs: 0,
    totalGigs: 0,
    uniqueCreators: 0,
    totalOffers: 0,
    activeListingBoosts: 0,
    activeProfileBoosts: 0,
    disputesPending: 0,
    disputesResolved: 0,
  });

  // Form state
  const [feeUsdPct, setFeeUsdPct] = useState<string>("");
  const [feeDopPct, setFeeDopPct] = useState<string>("");
  const [boostPriceDop, setBoostPriceDop] = useState<string>("");
  const [boostDurationDays, setBoostDurationDays] = useState<string>("");
  const [profileBoostPriceDop, setProfileBoostPriceDop] = useState<string>("");
  const [profileBoostDurationDays, setProfileBoostDurationDays] =
    useState<string>("");
  const [treasuryInput, setTreasuryInput] = useState<string>("");
  const [dopInput, setDopInput] = useState<string>("");
  const [usdcInput, setUsdcInput] = useState<string>("");
  const [routerInput, setRouterInput] = useState<string>("");
  const [wethInput, setWethInput] = useState<string>("");
  const [verifyAddress, setVerifyAddress] = useState<string>("");
  // Badges form
  const [badgeTarget, setBadgeTarget] = useState<string>("");
  const [badgeKey, setBadgeKey] = useState<string>("STAR");
  const [badgeBusy, setBadgeBusy] = useState<"grant" | "revoke" | null>(null);

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
  // Per-offer extra info toggle
  const [moreInfoOpen, setMoreInfoOpen] = useState<Record<string, boolean>>({});
  // EscrowStatus enum indices (keep in sync with contract)
  const ESCROW_STATUS = {
    DISPUTED: 3,
    RESOLVED: 4,
  } as const;
  // Disputes view sub-tab
  const [disputesView, setDisputesView] = useState<"pending" | "resolved">(
    "pending"
  );

  // Minimal identity cache: username + profilePicCID by lowercase address
  const [profiles, setProfiles] = useState<
    Record<
      string,
      { username?: string; profilePicCID?: string; loaded?: boolean }
    >
  >({});

  const getIdentity = (addr?: string) => {
    if (!addr) return { username: undefined, profilePicCID: undefined };
    const key = addr.toLowerCase();
    return profiles[key] || { username: undefined, profilePicCID: undefined };
  };

  const ensureProfiles = async (addresses: string[]) => {
    if (!contract) return;
    const uniques = Array.from(
      new Set(addresses.map((a) => a?.toLowerCase()).filter(Boolean))
    ) as string[];
    const toFetch = uniques.filter((a) => !profiles[a] || !profiles[a].loaded);
    if (toFetch.length === 0) return;
    try {
      const updates: Record<
        string,
        { username?: string; profilePicCID?: string; loaded: boolean }
      > = {};
      for (const addr of toFetch) {
        try {
          const p = (await contract.getProfile(
            addr
          )) as unknown as OnchainUserProfile;
          updates[addr] = {
            username: p.username || undefined,
            profilePicCID: p.profilePicCID || undefined,
            loaded: true,
          };
        } catch {
          updates[addr] = { loaded: true } as {
            username?: string;
            profilePicCID?: string;
            loaded: boolean;
          };
        }
      }
      setProfiles((prev) => ({ ...prev, ...updates }));
    } catch {
      // ignore identity failures for admin view
    }
  };

  const isOwner = useMemo(() => {
    if (!address || !owner) return false;
    return owner.some((owner) => owner.toLowerCase() === address.toLowerCase());
  }, [address, owner]);

  // Known token addresses for formatting
  const knownTokens: KnownTokens = useMemo(
    () => ({ DOP: dop ?? undefined, USDC: usdc ?? undefined }),
    [dop, usdc]
  );

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
        // Normalize owner to an array in case contract returns a single address
        const owners = Array.isArray(o) ? o : o ? [o] : [];
        setOwner(owners);
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
          try {
            setBoostPriceDop(ethers.formatUnits(b.price, 18));
          } catch {
            setBoostPriceDop(b.price.toString());
          }
          setBoostDurationDays((Number(b.duration) / 86400).toString());
        }
        if (pb) {
          try {
            setProfileBoostPriceDop(ethers.formatUnits(pb.price, 18));
          } catch {
            setProfileBoostPriceDop(pb.price.toString());
          }
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

  // Load dashboard metrics
  useEffect(() => {
    let cancelled = false;
    async function loadMetrics() {
      if (!contract) return;
      setMetricsLoading(true);
      try {
        // Offers and boosts can be read quickly
        const [lastListingId, lastOfferId, listBoosts, profBoosts] =
          await Promise.all([
            contract.getLastListingId().catch(() => BigInt(0)),
            contract.getLastOfferId().catch(() => BigInt(0)),
            contract.activeListingBoostCount().catch(() => 0),
            contract.activeProfileBoostCount().catch(() => 0),
          ]);

        // Enumerate listings (cap to avoid heavy fetches)
        let allListings: Array<{
          id: bigint;
          listingType: number;
          creator: string;
          active: boolean;
        }> = [];
        try {
          const page = await contract.fetchAllListingsByIndex({
            max: 2000,
            pageSize: 200,
          });
          allListings = page.map((l) => ({
            id: l.id,
            listingType: Number(l.listingType),
            creator: l.creator,
            active: l.active,
          }));
        } catch {
          try {
            const page = await contract.fetchAllListingsByIdScan({
              max: 2000,
              batchSize: 200,
            });
            allListings = page.map((l) => ({
              id: l.id,
              listingType: Number(l.listingType),
              creator: l.creator,
              active: l.active,
            }));
          } catch {
            allListings = [];
          }
        }

        // Compute counts
        const briefs = allListings.filter(
          (l) => l.listingType === ListingType.BRIEF
        ).length;
        const gigs = allListings.filter(
          (l) => l.listingType === ListingType.GIG
        ).length;
        const creators = new Set(
          allListings.map((l) => l.creator.toLowerCase())
        ).size;

        // Disputes: sample recent disputed offers page and classify
        let disputesPending = 0;
        let disputesResolved = 0;
        try {
          const { page } = await contract.getDisputedOffers(0, 200);
          if (page && page.length) {
            const statuses = await Promise.all(
              page.map(async (id) => {
                try {
                  const e = await contract.getEscrow(id);
                  return e.status;
                } catch {
                  return -1;
                }
              })
            );
            for (const s of statuses) {
              if (s === 3) disputesPending++; // DISPUTED
              if (s === 4) disputesResolved++; // RESOLVED
            }
          }
        } catch {}

        if (cancelled) return;
        setMetrics({
          totalListings: Number(lastListingId ?? BigInt(0)),
          totalBriefs: briefs,
          totalGigs: gigs,
          uniqueCreators: creators,
          totalOffers: Number(lastOfferId ?? BigInt(0)),
          activeListingBoosts: listBoosts || 0,
          activeProfileBoosts: profBoosts || 0,
          disputesPending,
          disputesResolved,
        });
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    }
    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [contract]);

  const SPECIAL_BADGES = useMemo(
    () => [
      { key: "STAR", value: 6, label: "Star" },
      { key: "MVP", value: 7, label: "MVP" },
      { key: "AMBASSADOR", value: 8, label: "Ambassador" },
    ],
    []
  );

  const handleGrantBadge = async () => {
    if (!contract || !badgeTarget) return;
    if (!requireOwner()) return;
    try {
      setBadgeBusy("grant");
      const badgeNum = Number(
        SPECIAL_BADGES.find((b) => b.key === badgeKey)?.value ?? 6
      );
      await contract.grantBadge(badgeTarget.trim(), badgeNum);
      toast.showSuccess(
        "Badge granted",
        `Granted ${badgeKey} to ${badgeTarget}`
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? (e as { message?: string }).message
          : undefined;
      toast.showError("Grant failed", msg || String(e));
    } finally {
      setBadgeBusy(null);
    }
  };

  const handleRevokeBadge = async () => {
    if (!contract || !badgeTarget) return;
    if (!requireOwner()) return;
    try {
      setBadgeBusy("revoke");
      const badgeNum = Number(
        SPECIAL_BADGES.find((b) => b.key === badgeKey)?.value ?? 6
      );
      await contract.revokeBadge(badgeTarget.trim(), badgeNum);
      toast.showSuccess(
        "Badge revoked",
        `Revoked ${badgeKey} from ${badgeTarget}`
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? (e as { message?: string }).message
          : undefined;
      toast.showError("Revoke failed", msg || String(e));
    } finally {
      setBadgeBusy(null);
    }
  };

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
    // Parse human DOP amount to wei
    const price = (() => {
      try {
        return ethers.parseUnits((boostPriceDop || "0").trim() || "0", 18);
      } catch {
        return BigInt(0);
      }
    })();
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
    const price = (() => {
      try {
        return ethers.parseUnits(
          (profileBoostPriceDop || "0").trim() || "0",
          18
        );
      } catch {
        return BigInt(0);
      }
    })();
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
      // Prefetch identities: openedBy + escrow parties
      try {
        const parties: string[] = [];
        for (const [, v] of entries) {
          if (v?.openedBy) parties.push(v.openedBy);
        }
        const escrows = await Promise.all(
          page.map(async (id) => {
            try {
              return await contract.getEscrow(id);
            } catch {
              return null;
            }
          })
        );
        for (const e of escrows) {
          if (e?.client) parties.push(e.client);
          if (e?.provider) parties.push(e.provider);
        }
        if (parties.length) void ensureProfiles(parties);
      } catch {}
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
      const timer = setTimeout(() => {
        // Indicate slow load; will be reset to false once finished
        setSlowLoading((m) => ({ ...m, [key]: true }));
      }, 2500);
      try {
        const raw = await loadJsonFromCid(h.cid);
        const data = (raw || {}) as DisputePayload;
        setDisputePayloads((m) => ({ ...m, [key]: data }));
      } catch {
        setDisputePayloads((m) => ({ ...m, [key]: null }));
      } finally {
        clearTimeout(timer);
        setPayloadLoading((m) => ({ ...m, [key]: false }));
        setSlowLoading((m) => ({ ...m, [key]: false }));
      }
    }

    // Ensure appeals list and then load their JSONs (auto)
    let list = appeals[key];
    if ((!list || list.length === 0) && contract) {
      try {
        const items = await contract.getDisputeAppeals(offerId);
        list = items;
        setAppeals((prev) => ({ ...prev, [key]: items }));
        // Fetch identities for appeal authors
        const authors = items.map((a) => a.by);
        void ensureProfiles(authors);
      } catch {
        list = [];
      }
    }
    if (list && list.length > 0) {
      const current = appealPayloads[key] || [];
      const next: Array<DisputePayload | null | undefined> = current.slice();
      const loaders: Array<Promise<void>> = [];
      for (let i = 0; i < list.length; i++) {
        if (next[i] === undefined) {
          loaders.push(
            (async (idx: number) => {
              try {
                const raw = await loadJsonFromCid(list![idx].cid);
                next[idx] = (raw || {}) as DisputePayload;
              } catch {
                next[idx] = null;
              }
            })(i)
          );
        }
      }
      if (loaders.length) {
        await Promise.all(loaders);
        setAppealPayloads((m) => ({ ...m, [key]: next }));
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

  // Auto-trigger payload load when headers arrive or expansion changes
  useEffect(() => {
    // For every expanded item with a CID but no payload, kick off loading
    const idsToLoad: bigint[] = [];
    for (const [key, isOpen] of Object.entries(expanded)) {
      if (!isOpen) continue;
      const h = headers[key];
      if (!h || !h.cid) continue;
      const p = disputePayloads[key];
      const loading = payloadLoading[key];
      if (p === undefined && !loading) {
        try {
          idsToLoad.push(BigInt(key));
        } catch {}
      }
    }
    if (idsToLoad.length) {
      idsToLoad.forEach((id) => {
        void ensurePayloadsLoaded(id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, expanded]);

  // When appeals list updates for any expanded item, auto-load missing appeal payloads
  useEffect(() => {
    const idsToLoad: bigint[] = [];
    for (const [key, isOpen] of Object.entries(expanded)) {
      if (!isOpen) continue;
      const list = appeals[key];
      if (!list || list.length === 0) continue;
      const arr = appealPayloads[key] || [];
      // If any undefined or no array yet, schedule load
      if (!appealPayloads[key] || arr.some((x) => x === undefined)) {
        try {
          idsToLoad.push(BigInt(key));
        } catch {}
      }
    }
    if (idsToLoad.length) {
      idsToLoad.forEach((id) => void ensurePayloadsLoaded(id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appeals]);

  // Inline resolve helper
  const handleResolveInline = (offerId: bigint, outcome: 1 | 2 | 3) => {
    if (!contract) return;
    const key = `resolve:${offerId}:${outcome}`;
    withConfirm(
      "Resolve dispute",
      <div>
        <p>Offer ID: {offerId.toString()}</p>
        <p>Outcome: {outcome} (1=REFUND_CLIENT, 2=SPLIT, 3=PAY_PROVIDER)</p>
      </div>,
      key,
      async () => {
        try {
          const receipt = await contract.resolveDispute(offerId, outcome);
          await receipt.wait?.();
          toast.showSuccess("Dispute resolved");
          // Refresh status for this offer
          try {
            const e = await contract.getEscrow(offerId);
            setDisputeStatuses((prev) => ({
              ...prev,
              [offerId.toString()]: Number(e.status),
            }));
          } catch {}
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toast.showError("Failed to resolve dispute", message);
        }
      }
    );
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
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-7 w-7" /> Admin Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage settings, verify users, and monitor marketplace activity.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </div>

      {mounted && !isConnected && (
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
          { key: "overview", label: "Overview", icon: Settings },
          { key: "config", label: "Configuration", icon: PiggyBank },
          { key: "disputes", label: "Disputes", icon: Gavel },
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
            <span className="inline-flex items-center gap-1.5">
              {t.icon ? <t.icon className="h-4 w-4" /> : null}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <section className="space-y-6">
          {/* Metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <MetricCard
              label="Briefs"
              value={metrics.totalBriefs}
              icon={Briefcase}
              loading={metricsLoading}
            />
            <MetricCard
              label="Gigs"
              value={metrics.totalGigs}
              icon={Hammer}
              loading={metricsLoading}
            />
            <MetricCard
              label="Freelancers"
              value={metrics.uniqueCreators}
              icon={Users}
              loading={metricsLoading}
              tooltip="Unique creators across listings (proxy for freelancers)"
            />
            <MetricCard
              label="Offers"
              value={metrics.totalOffers}
              icon={Activity}
              loading={metricsLoading}
            />
            <MetricCard
              label="Boosted Gigs"
              value={metrics.activeListingBoosts}
              icon={Coins}
              loading={metricsLoading}
            />
            <MetricCard
              label="Boosted Profiles"
              value={metrics.activeProfileBoosts}
              icon={BadgeCheck}
              loading={metricsLoading}
            />
          </div>

          {/* Prominent Admin Tools */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium inline-flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-emerald-400" /> Profile
                  Verification
                </h3>
                <span className="text-xs text-gray-400">Admin-only</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">
                    User address
                  </label>
                  <input
                    value={verifyAddress}
                    onChange={(e) => setVerifyAddress(e.target.value)}
                    className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 font-mono"
                    placeholder="0x..."
                  />
                </div>
                <div className="flex items-end">
                  <button
                    disabled={!isOwner || isLoading("verify")}
                    onClick={handleVerifyProfile}
                    className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {isLoading("verify") ? "Verifying..." : "Verify profile"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Users must have already created a profile before verification.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4">
              <h3 className="text-lg font-medium mb-2 inline-flex items-center gap-2">
                <StarBadge /> Special Badges
              </h3>
              <label className="block text-xs text-gray-400 mb-1">
                User address
              </label>
              <input
                value={badgeTarget}
                onChange={(e) => setBadgeTarget(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <label className="block text-xs text-gray-400 mb-1">Badge</label>
              <select
                value={badgeKey}
                onChange={(e) => setBadgeKey(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
              >
                {SPECIAL_BADGES.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isOwner || badgeBusy === "grant"}
                  onClick={handleGrantBadge}
                  className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {badgeBusy === "grant" ? "Granting..." : "Grant badge"}
                </button>
                <button
                  disabled={!isOwner || badgeBusy === "revoke"}
                  onClick={handleRevokeBadge}
                  className="rounded-md bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {badgeBusy === "revoke" ? "Revoking..." : "Revoke"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Grant standout badges like Star, MVP, or Ambassador.
              </p>
            </div>
          </div>

          {/* System Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat
              label="Owner"
              icon={UserIcon}
              value={<Address value={owner[0] ?? undefined} />}
            />
            <Stat
              label="Paused"
              icon={paused ? Pause : Play}
              value={
                <span className={paused ? "text-red-400" : "text-green-400"}>
                  {paused ? "Yes" : "No"}
                </span>
              }
            />
            <Stat
              label="Treasury"
              icon={PiggyBank}
              value={<Address value={treasury ?? undefined} />}
            />
            <Stat
              label="DOP Token"
              icon={Coins}
              value={<Address value={dop ?? undefined} />}
            />
            <Stat
              label="USDC Token"
              icon={CircleDollarSign}
              value={<Address value={usdc ?? undefined} />}
            />
            <Stat
              label="DEX Router"
              icon={Share2}
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
              value={
                <span>{fees ? Number(fees.feeDop) / 100 + "%" : "-"}</span>
              }
            />
            <Stat
              label="Boost Price (DOP)"
              value={
                <span
                  className="font-mono"
                  title={boostParams?.price?.toString()}
                >
                  {boostParams?.price != null
                    ? `${formatTokenAmount(boostParams.price, "", {
                        decimals: 18,
                        maxFractionDigits: 4,
                      })} DOP`
                    : "-"}
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
              label="Profile Boost Price (DOP)"
              value={
                <span
                  className="font-mono"
                  title={profileBoostParams?.price?.toString()}
                >
                  {profileBoostParams?.price != null
                    ? `${formatTokenAmount(profileBoostParams.price, "", {
                        decimals: 18,
                        maxFractionDigits: 4,
                      })} DOP`
                    : "-"}
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
          </div>
        </section>
      )}

      {activeTab === "config" && (
        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-6">
          <h2 className="text-lg font-medium inline-flex items-center gap-2">
            <Settings className="h-5 w-5" /> Admin Actions
          </h2>

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
              <span className="inline-flex items-center gap-2">
                {isLoading("pause") ? (
                  <span>Processing...</span>
                ) : paused ? (
                  <>
                    <Play className="h-4 w-4" /> <span>Unpause</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4" /> <span>Pause</span>
                  </>
                )}
              </span>
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("fees") ? "Updating..." : "Update fees"}
                </span>
              </button>
            </div>

            {/* Listing Boost */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Listing Boost</div>
              <label className="block text-xs text-gray-400 mb-1">
                Price (DOP)
              </label>
              <input
                value={boostPriceDop}
                onChange={(e) => setBoostPriceDop(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="e.g. 1000"
                inputMode="decimal"
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("boost") ? "Updating..." : "Update listing boost"}
                </span>
              </button>
            </div>

            {/* Profile Boost */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Profile Boost</div>
              <label className="block text-xs text-gray-400 mb-1">
                Price (DOP)
              </label>
              <input
                value={profileBoostPriceDop}
                onChange={(e) => setProfileBoostPriceDop(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="e.g. 1000"
                inputMode="decimal"
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("pboost") ? "Updating..." : "Update profile boost"}
                </span>
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("treasury") ? "Updating..." : "Update treasury"}
                </span>
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("tokens") ? "Updating..." : "Update tokens"}
                </span>
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("router") ? "Updating..." : "Update router"}
                </span>
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
                <span className="inline-flex items-center gap-2">
                  {isLoading("verify") ? "Verifying..." : "Verify profile"}
                </span>
              </button>
            </div>

            {/* Special badges */}
            <div className="rounded-md border border-white/10 p-4">
              <div className="font-medium mb-2">Special Badges</div>
              <label className="block text-xs text-gray-400 mb-1">
                User address
              </label>
              <input
                value={badgeTarget}
                onChange={(e) => setBadgeTarget(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3 font-mono"
                placeholder="0x..."
              />
              <label className="block text-xs text-gray-400 mb-1">Badge</label>
              <select
                value={badgeKey}
                onChange={(e) => setBadgeKey(e.target.value)}
                className="w-full rounded bg-black/40 border border-white/10 px-3 py-2 mb-3"
              >
                {SPECIAL_BADGES.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <button
                  disabled={!isOwner || badgeBusy === "grant"}
                  onClick={handleGrantBadge}
                  className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {badgeBusy === "grant" ? "Granting..." : "Grant badge"}
                </button>
                <button
                  disabled={!isOwner || badgeBusy === "revoke"}
                  onClick={handleRevokeBadge}
                  className="rounded-md bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {badgeBusy === "revoke" ? "Revoking..." : "Revoke"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Admin-only. User must have created a profile.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeTab === "disputes" && (
        <section className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            {(() => {
              const pending = pageIds.filter((id) => {
                const s = disputeStatuses[id.toString()];
                return s === undefined || s === ESCROW_STATUS.DISPUTED;
              });
              const resolved = pageIds.filter(
                (id) =>
                  disputeStatuses[id.toString()] === ESCROW_STATUS.RESOLVED
              );
              return (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium">Disputes</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-200">
                        Pending {pending.length}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-300">
                        Resolved {resolved.length}
                      </span>
                      <span className="text-xs text-gray-400">
                        Showing {pageIds.length} • Offset {pageOffset}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">Page size</label>
                    <select
                      value={pageLimit}
                      onChange={(e) =>
                        setPageLimit(Number(e.target.value || 0))
                      }
                      className="rounded bg-black/40 border border-white/10 px-2 py-1 text-sm"
                    >
                      {[10, 25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        setPageOffset(Math.max(0, pageOffset - pageLimit))
                      }
                      disabled={pageLoading || pageOffset === 0}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPageOffset(pageOffset + pageLimit)}
                      disabled={pageLoading || pageIds.length < pageLimit}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
                    >
                      Next
                    </button>
                    <button
                      onClick={refreshDisputesPage}
                      disabled={pageLoading}
                      className="rounded-md bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-sm disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {pageLoading ? (
                        <span>Loading...</span>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4" /> Refresh
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}

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
                  <div
                    key={key}
                    className="rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer"
                    onClick={() => toggleExpand(id)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <span>Offer #{key}</span>
                          {disputeStatuses[key] === ESCROW_STATUS.RESOLVED && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-600/30 border border-green-500/40 text-green-300 inline-flex items-center gap-1">
                              <BadgeCheck className="h-3 w-3" /> Resolved
                            </span>
                          )}
                          {disputeStatuses[key] === ESCROW_STATUS.DISPUTED && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-600/30 border border-yellow-500/40 text-yellow-200 inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Pending
                            </span>
                          )}
                        </div>
                        {h ? (
                          <div className="text-gray-400 text-xs flex flex-wrap gap-3 mt-1">
                            {(() => {
                              const ident = getIdentity(h.openedBy);
                              const display = ident.username
                                ? `@${ident.username}`
                                : h.openedBy;
                              const avatarUrl = ident.profilePicCID
                                ? toGatewayUrl(ident.profilePicCID)
                                : null;
                              return (
                                <span className="inline-flex items-center gap-1.5">
                                  {avatarUrl ? (
                                    <Image
                                      src={avatarUrl}
                                      alt={display}
                                      width={16}
                                      height={16}
                                      className="h-4 w-4 rounded-full object-cover border border-white/10"
                                    />
                                  ) : (
                                    <UserIcon className="h-4 w-4 opacity-70" />
                                  )}
                                  <Link
                                    href={`/profile/${h.openedBy}`}
                                    className="underline decoration-dotted hover:text-white"
                                  >
                                    {display}
                                  </Link>
                                </span>
                              );
                            })()}
                            <span>
                              Opened At:{" "}
                              {new Date(
                                Number(h.openedAt) * 1000
                              ).toUTCString()}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(id);
                          }}
                          className="rounded-md border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10 inline-flex items-center gap-1.5"
                        >
                          {expanded[key] ? (
                            <>
                              <ChevronDown className="h-4 w-4" /> Hide
                            </>
                          ) : (
                            <>
                              <ChevronRight className="h-4 w-4" /> Details
                            </>
                          )}
                        </button>
                        {disputeStatuses[key] === ESCROW_STATUS.DISPUTED &&
                          isOwner && (
                            <div className="hidden sm:flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResolveInline(id, 1);
                                }}
                                disabled={isLoading(`resolve:${key}:1`)}
                                className="rounded-md bg-red-600/80 hover:bg-red-600 text-white px-2 py-1 text-xs disabled:opacity-50 inline-flex items-center gap-1"
                                title="Refund client"
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Refund
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResolveInline(id, 2);
                                }}
                                disabled={isLoading(`resolve:${key}:2`)}
                                className="rounded-md bg-yellow-600/80 hover:bg-yellow-600 text-black px-2 py-1 text-xs disabled:opacity-50 inline-flex items-center gap-1"
                                title="Split funds"
                              >
                                <Scale className="h-3.5 w-3.5" /> Split
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResolveInline(id, 3);
                                }}
                                disabled={isLoading(`resolve:${key}:3`)}
                                className="rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white px-2 py-1 text-xs disabled:opacity-50 inline-flex items-center gap-1"
                                title="Pay provider"
                              >
                                <Gavel className="h-3.5 w-3.5" /> Pay
                              </button>
                            </div>
                          )}
                        <Link
                          href={`/offers/${key}`}
                          className="text-xs text-gray-300 hover:text-white underline inline-flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Eye className="h-4 w-4" /> View Offer
                        </Link>
                      </div>
                    </div>

                    {expanded[key] && (
                      <div className="mt-3 rounded-lg bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/10 p-3">
                        <EscrowSummary offerId={id} tokens={knownTokens} />
                        {/* Chat-style conversation */}
                        <div className="mt-3 space-y-3">
                          {/* Opening message */}
                          <div className="flex items-start gap-2">
                            {(() => {
                              const ident = getIdentity(h?.openedBy);
                              const avatarUrl = ident.profilePicCID
                                ? toGatewayUrl(ident.profilePicCID)
                                : null;
                              return avatarUrl ? (
                                <Image
                                  src={avatarUrl}
                                  alt="avatar"
                                  width={28}
                                  height={28}
                                  className="h-7 w-7 rounded-full object-cover border border-white/10"
                                />
                              ) : (
                                <div className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center">
                                  <UserIcon className="h-4 w-4 opacity-80" />
                                </div>
                              );
                            })()}
                            <div className="flex-1">
                              <div className="text-xs text-gray-400 flex items-center gap-2">
                                <span className="font-medium text-gray-200">
                                  {(() => {
                                    const ident = getIdentity(h?.openedBy);
                                    return ident.username
                                      ? `@${ident.username}`
                                      : h?.openedBy;
                                  })()}
                                </span>
                                <span>opened dispute</span>
                                <span className="opacity-70">
                                  {new Date(
                                    (h?.openedAt ? Number(h.openedAt) : 0) *
                                      1000
                                  ).toUTCString()}
                                </span>
                              </div>
                              <div className="mt-1 inline-block max-w-[720px] rounded-2xl rounded-tl-sm bg-white/10 border border-white/10 p-3 text-sm">
                                {!h?.cid ? (
                                  <div className="text-xs text-gray-500">
                                    No metadata CID recorded.
                                  </div>
                                ) : isMetaLoading && payload === undefined ? (
                                  <div className="text-xs text-gray-500">
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
                                    Preparing metadata…
                                    <button
                                      onClick={() => ensurePayloadsLoaded(id)}
                                      className="underline decoration-dotted hover:text-white"
                                    >
                                      Load now
                                    </button>
                                  </div>
                                ) : (
                                  <DisputePayloadView payload={payload} />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Appeals as replies */}
                          {(appeals[key] || []).map((a, idx) => {
                            const ap = (appealPayloads[key] || [])[idx];
                            const ident = getIdentity(a.by);
                            const avatarUrl = ident.profilePicCID
                              ? toGatewayUrl(ident.profilePicCID)
                              : null;
                            return (
                              <div key={idx} className="flex items-start gap-2">
                                {avatarUrl ? (
                                  <Image
                                    src={avatarUrl}
                                    alt="avatar"
                                    width={28}
                                    height={28}
                                    className="h-7 w-7 rounded-full object-cover border border-white/10"
                                  />
                                ) : (
                                  <div className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center">
                                    <UserIcon className="h-4 w-4 opacity-80" />
                                  </div>
                                )}
                                <div className="flex-1">
                                  <div className="text-xs text-gray-400 flex items-center gap-2">
                                    <span className="font-medium text-gray-200">
                                      {ident.username
                                        ? `@${ident.username}`
                                        : a.by}
                                    </span>
                                    <span>appealed</span>
                                    <span className="opacity-70">
                                      {new Date(
                                        Number(a.timestamp) * 1000
                                      ).toUTCString()}
                                    </span>
                                  </div>
                                  <div className="mt-1 inline-block max-w-[720px] rounded-2xl rounded-tl-sm bg-white/10 border border-white/10 p-3 text-sm">
                                    {ap === undefined ? (
                                      <div className="text-xs text-gray-500 flex items-center gap-2">
                                        Loading metadata…
                                        <button
                                          onClick={() =>
                                            retryAppealPayload(id, idx)
                                          }
                                          className="underline decoration-dotted hover:text-white"
                                        >
                                          Retry
                                        </button>
                                      </div>
                                    ) : ap === null ? (
                                      <div className="text-xs text-red-400 flex items-center gap-2">
                                        <span>Failed to load metadata.</span>
                                        <button
                                          onClick={() =>
                                            retryAppealPayload(id, idx)
                                          }
                                          className="underline decoration-dotted text-red-300 hover:text-red-200"
                                        >
                                          Retry
                                        </button>
                                      </div>
                                    ) : (
                                      <DisputePayloadView payload={ap} />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {/* More info for this offer */}
                          <div className="pt-2">
                            <button
                              className="text-xs underline decoration-dotted text-gray-300 hover:text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMoreInfoOpen((m) => ({
                                  ...m,
                                  [key]: !m[key],
                                }));
                              }}
                            >
                              {moreInfoOpen[key] ? "Hide info" : "More info"}
                            </button>
                            {moreInfoOpen[key] && (
                              <div className="mt-2 rounded border border-white/10 bg-black/30 p-2 text-xs text-gray-300">
                                {(() => {
                                  const meta = (payload || undefined) as
                                    | DisputePayload
                                    | undefined;
                                  const createdNum = meta?.createdAt
                                    ? Number(meta.createdAt)
                                    : undefined;
                                  const createdStr = createdNum
                                    ? new Date(
                                        createdNum *
                                          (createdNum > 1e12 ? 1 : 1000)
                                      ).toUTCString()
                                    : "-";
                                  return (
                                    <>
                                      <div className="flex flex-wrap gap-4">
                                        <span>
                                          Type:{" "}
                                          <span className="text-white">
                                            {meta?.type || "-"}
                                          </span>
                                        </span>
                                        <span>
                                          Offer ID:{" "}
                                          <span className="text-white">
                                            {key}
                                          </span>
                                        </span>
                                        <span>
                                          Listing ID:{" "}
                                          <span className="text-white">
                                            {String(meta?.listingId ?? "-")}
                                          </span>
                                        </span>
                                        <span>
                                          Author:{" "}
                                          <Address
                                            value={meta?.author || h?.openedBy}
                                          />
                                        </span>
                                        <span>
                                          Role:{" "}
                                          <span className="text-white">
                                            {meta?.role || "-"}
                                          </span>
                                        </span>
                                        <span>
                                          Created:{" "}
                                          <span className="text-white">
                                            {createdStr}
                                          </span>
                                        </span>
                                      </div>
                                      {h?.cid && (
                                        <div className="mt-2">
                                          CID: {""}
                                          <a
                                            className="underline decoration-dotted"
                                            href={`https://ipfs.io/ipfs/${h.cid}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {h.cid.slice(0, 24)}…
                                          </a>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
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
                  <div className="inline-flex mb-4 rounded-md border border-white/10 overflow-hidden">
                    <button
                      onClick={() => setDisputesView("pending")}
                      className={`px-3 py-1.5 text-xs ${
                        disputesView === "pending"
                          ? "bg-white/20"
                          : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      Pending ({pending.length})
                    </button>
                    <button
                      onClick={() => setDisputesView("resolved")}
                      className={`px-3 py-1.5 text-xs ${
                        disputesView === "resolved"
                          ? "bg-white/20"
                          : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      Resolved ({resolved.length})
                    </button>
                  </div>
                  <div className="space-y-3">
                    {disputesView === "pending" && (
                      <>
                        {pending.length === 0 && !pageLoading && (
                          <div className="text-sm text-gray-400">
                            No pending disputes.
                          </div>
                        )}
                        {pending.map(renderRow)}
                        {pageLoading && pending.length === 0 && (
                          <div className="grid gap-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <div
                                key={i}
                                className="rounded-lg border border-white/10 bg-white/5 p-3"
                              >
                                <div className="h-5 w-40 bg-white/10 rounded animate-pulse" />
                                <div className="mt-2 h-4 w-full bg-white/5 rounded animate-pulse" />
                              </div>
                            ))}
                          </div>
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
                          <div className="grid gap-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <div
                                key={i}
                                className="rounded-lg border border-white/10 bg-white/5 p-3"
                              >
                                <div className="h-5 w-40 bg-white/10 rounded animate-pulse" />
                                <div className="mt-2 h-4 w-full bg-white/5 rounded animate-pulse" />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>
      )}
    </div>
  );
}

function EscrowSummary({
  offerId,
  tokens,
}: {
  offerId: bigint;
  tokens?: KnownTokens;
}) {
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
  const formattedAmount = (() => {
    try {
      const v = BigInt(data.amount);
      return `${formatTokenAmount(v, data.token, {
        tokens,
        maxFractionDigits: 4,
      })} ${
        data.token?.toLowerCase() === (tokens?.USDC || "").toLowerCase()
          ? "USDC"
          : data.token?.toLowerCase() === (tokens?.DOP || "").toLowerCase()
          ? "DOP"
          : ""
      }`.trim();
    } catch {
      return data.amount;
    }
  })();
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
          Amount: <span className="font-mono">{formattedAmount}</span>
        </span>
        <span>
          Token: <Address value={data.token} />
        </span>
        <span>Status: {data.status}</span>
      </div>
    </div>
  );
}
