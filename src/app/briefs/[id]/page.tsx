"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, use, useCallback } from "react";
import {
  ArrowLeft,
  Sparkles,
  CircleOff,
  Clock3,
  Briefcase,
  Tag as TagIcon,
  User2,
  Coins,
  CheckCircle2,
  Timer,
} from "lucide-react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { getTokenAddresses } from "@/lib/contract";
import {
  knownDecimalsFor,
  toGatewayUrl,
  formatAddress,
  formatTokenAmount,
  tokenSymbolFor,
  timeAgo,
  loadListingMetadataFromURI,
  getCategoryLabel,
} from "@/lib/utils";
import { Offer, EscrowStatus, Listing } from "@/types/marketplace";
import { useToastContext } from "@/components/providers";
import { ConfirmModal } from "@/components/ConfirmModal";

interface OfferWithEscrow extends Offer {
  escrowStatus?: EscrowStatus;
  canAccept?: boolean;
  canCancel?: boolean;
}

// Escrow status label map (simplified for brief detail view)
const ESCROW_STATUS_LABELS: Record<number, string> = {
  0: "None",
  1: "In Progress",
  2: "Completed",
  3: "Disputed",
  4: "Resolved",
  5: "Cancelled",
};

// Page-local UI state shape built from shared types
type ListingState = Listing & {
  title: string;
  description: string;
  cover: string | null;
  categoryLabel: string;
  isBoosted: boolean;
  createdAgo: string;
};

export default function BriefDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { contract } = useMarketplaceContract();
  const { chain, address } = useAccount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ListingState | null>(null);
  const [offers, setOffers] = useState<OfferWithEscrow[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const toast = useToastContext();
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message?: React.ReactNode;
    onConfirm?: () => void;
  }>({ open: false, title: "" });

  // Offer form state
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [paymentToken, setPaymentToken] = useState("ETH");
  const [submittingOffer, setSubmittingOffer] = useState(false);

  const chainId =
    chain?.id ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124);

  const tokens = getTokenAddresses(chainId);

  const loadListing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const id = BigInt(resolvedParams.id);
      const l = await contract!.getListing(id);

      // Check boost status
      let isBoosted = false;
      try {
        isBoosted = await contract!.isBoosted(id);
      } catch {
        // ignore
      }

      // Load normalized metadata using shared helper
      const meta = await loadListingMetadataFromURI(l.metadataURI, l);

      const cover = toGatewayUrl(meta?.image || null);

      const categoryLabel = getCategoryLabel(Number(l.category));
      const createdAgo = timeAgo(Number(l.createdAt));

      const title = meta?.title || `Brief #${resolvedParams.id}`;
      const description = meta?.description || "No description provided.";
      setState({
        ...l,
        title,
        description,
        cover,
        categoryLabel,
        isBoosted,
        createdAgo,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [contract, resolvedParams.id]);

  const loadOffers = useCallback(async () => {
    if (!state) return;

    setLoadingOffers(true);
    try {
      // Use contract view to paginate offers for this listing
      const pageSize = 50;
      let offset = 0;
      const all: Offer[] = [];
      // defensively cap pages to avoid runaway loops
      const MAX_PAGES = 200;
      let pages = 0;
      while (pages < MAX_PAGES) {
        const page = await contract!.getOffersForListing(
          state.id,
          offset,
          pageSize
        );
        if (!page || page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
        pages += 1;
      }

      const offerDetails: OfferWithEscrow[] = [];

      for (const offer of all) {
        try {
          let escrowStatus: EscrowStatus | undefined;
          if (offer.accepted) {
            try {
              const escrow = await contract!.getEscrow(offer.id);
              // Ensure numeric status to avoid enum/index mismatches
              const s = Number(escrow.status);
              escrowStatus = Number.isFinite(s)
                ? (s as unknown as EscrowStatus)
                : undefined;
            } catch {
              // ignore escrow load failure
            }
          }

          offerDetails.push({
            ...offer,
            escrowStatus,
            canAccept:
              !offer.accepted &&
              !offer.cancelled &&
              address?.toLowerCase() === state.creator.toLowerCase(),
            canCancel:
              !offer.accepted &&
              !offer.cancelled &&
              address?.toLowerCase() === offer.proposer.toLowerCase(),
          });
        } catch (err) {
          console.warn(`Failed to process offer ${offer.id.toString()}:`, err);
        }
      }

      setOffers(offerDetails.sort((a, b) => Number(b.createdAt - a.createdAt)));
    } catch (err) {
      console.error("Failed to load offers:", err);
    } finally {
      setLoadingOffers(false);
    }
  }, [state, contract, address]);

  // Simple helper to resolve decimals using known mapping; fallback to 18
  function resolveDecimals(tokenAddress: string): number {
    return knownDecimalsFor(tokenAddress, tokens) ?? 18;
  }

  async function submitOffer() {
    if (!chain || !address || !state) return;

    if (!offerAmount || parseFloat(offerAmount) <= 0) {
      toast.showError("Invalid amount", "Please enter a valid offer amount");
      return;
    }

    try {
      setSubmittingOffer(true);
      if (!contract) throw new Error("Contract not ready");

      const tokenAddress =
        paymentToken === "ETH"
          ? ethers.ZeroAddress
          : paymentToken === "USDC"
          ? tokens.USDC
          : tokens.DOP;

      // Compute amount in correct units per token
      let finalAmount: bigint;
      if (tokenAddress === ethers.ZeroAddress) {
        finalAmount = ethers.parseEther(offerAmount);
      } else {
        const erc20Addr = ethers.getAddress(tokenAddress as string);
        const dec = resolveDecimals(erc20Addr);
        finalAmount = ethers.parseUnits(offerAmount, dec);
      }

      const tx = await contract.makeOffer(state.id, finalAmount, tokenAddress);
      await tx;

      toast.showSuccess("Offer submitted");
      setOfferAmount("");
      setShowOfferForm(false);
      await loadOffers();
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit offer";
      console.error("Failed to submit offer:", e);
      toast.showError("Submit failed", msg);
    } finally {
      setSubmittingOffer(false);
    }
  }

  async function acceptOffer(offerId: bigint) {
    if (!chain || !address) return;

    try {
      if (!contract) throw new Error("Contract not ready");
      const tx = await contract.acceptOffer(offerId);
      await tx.wait();

      toast.showSuccess("Offer accepted");
      await loadOffers();
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to accept offer";
      console.error("Failed to accept offer:", e);
      toast.showError("Accept failed", msg);
    }
  }

  async function cancelOffer(offerId: bigint) {
    if (!chain || !address) return;
    try {
      if (!contract) throw new Error("Contract not ready");
      const tx = await contract.cancelOffer(offerId);
      await tx.wait();

      toast.showSuccess("Offer cancelled");
      await loadOffers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to cancel offer";
      console.error("Failed to cancel offer:", e);
      toast.showError("Cancel failed", msg);
    }
  }

  useEffect(() => {
    loadListing();
  }, [loadListing]);

  useEffect(() => {
    if (state) {
      loadOffers();
    }
  }, [state, loadOffers]);

  const isOwner = !!(
    address &&
    state &&
    address.toLowerCase() === state.creator.toLowerCase()
  );
  const canMakeOffer = !!address && !isOwner && !!state?.active;

  // UI primitives -----------------------------------------------------------
  const badgeBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide";
  const badgeVariants: Record<string, string> = {
    neutral: "bg-gray-800/70 text-gray-300",
    outline: "border border-white/10 text-gray-300",
    boosted: "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30",
    inactive: "bg-red-500/15 text-red-400",
    category: "bg-gray-700/50 text-gray-200",
    info: "bg-gray-700/30 text-gray-300",
    success: "bg-green-500/15 text-green-400",
    danger: "bg-red-500/15 text-red-400",
  };
  const Badge = ({
    children,
    variant = "neutral",
    className = "",
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => (
    <span
      className={`${badgeBase} ${
        badgeVariants[variant] || badgeVariants.neutral
      } ${className}`.trim()}
    >
      {children}
    </span>
  );
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed";

  const offerStatusBadge = (offer: OfferWithEscrow) => {
    if (offer.cancelled)
      return (
        <Badge variant="inactive" className="!px-2">
          Cancelled
        </Badge>
      );
    const s =
      offer.escrowStatus != null ? Number(offer.escrowStatus) : undefined;
    if (s == null) return null;
    const label = ESCROW_STATUS_LABELS[s];
    if (!label) return null;
    switch (s) {
      case 2:
        return (
          <Badge variant="success" className="!px-2 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {label}
          </Badge>
        );
      case 3:
        return (
          <Badge variant="danger" className="!px-2">
            {label}
          </Badge>
        );
      case 5:
        return (
          <Badge variant="inactive" className="!px-2">
            {label}
          </Badge>
        );
      default:
        return (
          <Badge variant="info" className="!px-2">
            {label}
          </Badge>
        );
    }
  };

  const skeleton = (
    <div className="space-y-6">
      <div className="h-6 w-40 bg-gray-800/60 rounded animate-pulse" />
      <div className="rounded-xl border border-white/5 p-6 bg-gradient-to-b from-gray-900/70 to-gray-900/30">
        <div className="h-7 w-2/3 bg-gray-800/60 rounded animate-pulse mb-6" />
        <div className="h-64 w-full bg-gray-800/40 rounded-lg animate-pulse" />
        <div className="mt-6 space-y-2">
          <div className="h-4 w-full bg-gray-800/50 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-gray-800/50 rounded animate-pulse" />
        </div>
      </div>
      <div className="rounded-xl border border-white/5 p-6 bg-gradient-to-b from-gray-900/70 to-gray-900/30">
        <div className="h-5 w-32 bg-gray-800/60 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 bg-gray-800/40 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );

  // Removed top-level Make Offer button per request

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={() => {
          const fn = confirm.onConfirm;
          setConfirm((c) => ({ ...c, open: false }));
          fn?.();
        }}
        confirmText="Proceed"
        danger
      />
      <div className="flex items-center gap-3">
        <Link
          href="/briefs"
          className="text-sm text-gray-400 hover:text-white inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>
      {loading ? (
        skeleton
      ) : error ? (
        <div className="container-panel p-6 text-sm text-red-400">{error}</div>
      ) : state ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-6">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge
                  variant="outline"
                  className="inline-flex items-center gap-1"
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  Brief
                </Badge>
                <Badge
                  variant="category"
                  className="inline-flex items-center gap-1"
                >
                  <TagIcon className="w-3.5 h-3.5" />
                  {state.categoryLabel}
                </Badge>
                {state.isBoosted && (
                  <Badge
                    variant="boosted"
                    className="inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Boosted
                  </Badge>
                )}
                {!state.active && (
                  <Badge
                    variant="inactive"
                    className="inline-flex items-center gap-1"
                  >
                    <CircleOff className="w-3.5 h-3.5" />
                    Inactive
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-1">
                  <Clock3 className="w-3.5 h-3.5" />
                  {state.createdAgo}
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight leading-tight mb-4">
                {state.title}
              </h1>
              {state.cover && (
                <div className="relative rounded-lg overflow-hidden border border-white/10 mb-6">
                  <Image
                    src={state.cover}
                    alt="cover"
                    width={1600}
                    height={900}
                    className="w-full object-cover max-h-[420px]"
                  />
                  <div className="absolute inset-0 ring-1 ring-white/10" />
                </div>
              )}
              <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                <p className="text-gray-300 whitespace-pre-wrap">
                  {state.description}
                </p>
              </div>
            </div>

            {/* Offers Section */}
            <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                  <Coins className="w-4 h-4" />
                  Offers{" "}
                  <span className="text-gray-500 text-xs font-normal">
                    ({offers.length})
                  </span>
                </h2>
                {canMakeOffer && (
                  <button
                    onClick={() => setShowOfferForm((o) => !o)}
                    className={`${btnBase} border border-white/10 px-3 py-1.5 text-gray-200 hover:bg-white/5`}
                  >
                    {showOfferForm ? "Close" : "Make Offer"}
                  </button>
                )}
              </div>

              {/* Offer Form */}
              {showOfferForm && canMakeOffer && (
                <div className="mb-6 p-4 rounded-lg border border-white/10 bg-gray-900/60">
                  <h3 className="font-medium mb-4 text-sm flex items-center gap-2">
                    <Coins className="w-4 h-4 text-yellow-400" />
                    Submit Offer
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">
                        Payment Token
                      </label>
                      <select
                        value={paymentToken}
                        onChange={(e) => setPaymentToken(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
                      >
                        <option value="ETH">ETH</option>
                        {tokens.USDC && <option value="USDC">USDC</option>}
                        {tokens.DOP && <option value="DOP">DOP</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">
                        Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={offerAmount}
                        onChange={(e) => setOfferAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-md border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
                      />
                    </div>

                    <div className="flex items-end mt-2 md:mt-0">
                      <button
                        onClick={submitOffer}
                        disabled={submittingOffer || !offerAmount}
                        className={`${btnBase} w-full bg-green-600 hover:bg-green-500 text-white px-4 py-2.5 disabled:opacity-50`}
                      >
                        {submittingOffer ? "Submitting..." : "Submit Offer"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Offers List */}
              {loadingOffers ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-24 rounded-lg bg-gray-900/50 animate-pulse"
                    />
                  ))}
                </div>
              ) : offers.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">
                  No offers yet
                </div>
              ) : (
                <div className="space-y-3">
                  {offers.map((offer, idx) => {
                    const key =
                      offer.id != null ? offer.id.toString() : `offer-${idx}`;
                    return (
                      <div
                        key={key}
                        className="group rounded-lg border border-white/5 bg-gray-900/40 hover:bg-gray-900/60 hover:border-white/10 transition-colors p-4"
                      >
                        <Link
                          href={`/offers/${offer.id}`}
                          className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm text-gray-100 flex items-center gap-1">
                                {offer.amount != null
                                  ? formatTokenAmount(
                                      offer.amount,
                                      offer.paymentToken,
                                      { tokens, maxFractionDigits: 6 }
                                    )
                                  : "0"}{" "}
                                {tokenSymbolFor(offer.paymentToken, tokens)}
                              </span>
                              {offerStatusBadge(offer)}
                            </div>
                            <p className="text-[12px] text-gray-500 flex items-center gap-1">
                              <User2 className="w-3.5 h-3.5" />
                              From {formatAddress(offer.proposer)} •{" "}
                              {timeAgo(Number(offer.createdAt))}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 self-start sm:self-auto">
                            {offer.canAccept && (
                              <button
                                onClick={() => acceptOffer(offer.id)}
                                className={`${btnBase} bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-xs`}
                              >
                                Accept
                              </button>
                            )}
                            {offer.canCancel && (
                              <button
                                onClick={() =>
                                  setConfirm({
                                    open: true,
                                    title: "Cancel offer?",
                                    message:
                                      "Are you sure you want to cancel this offer?",
                                    onConfirm: () => cancelOffer(offer.id),
                                  })
                                }
                                className={`${btnBase} bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 text-xs`}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-6 space-y-4">
              <h3 className="font-medium text-sm tracking-wide flex items-center gap-2 text-gray-200">
                <Timer className="w-4 h-4" />
                Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-[12px] text-gray-400">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    Listing ID
                  </p>
                  <p className="font-medium text-gray-200 text-xs">
                    {String(state.id)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    Creator
                  </p>
                  <p className="font-medium text-gray-200 text-xs break-all">
                    {formatAddress(state.creator)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    Status
                  </p>
                  <p
                    className={`font-medium text-xs ${
                      state.active ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {state.active ? "Active" : "Inactive"}
                  </p>
                </div>
                {state.isBoosted && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">
                      Boost Expires
                    </p>
                    <p className="font-medium text-gray-200 text-xs">
                      {new Date(
                        Number(state.boostExpiry) * 1000
                      ).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Attachment panel removed */}

            {isOwner && (
              <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-6 space-y-4">
                <h3 className="font-medium text-sm tracking-wide text-gray-200">
                  Owner
                </h3>
                <div className="space-y-2">
                  <Link
                    href={`/manage/listing/${state.id}`}
                    className={`${btnBase} w-full border border-white/10 hover:bg-white/5 px-4 py-2 text-gray-200 justify-center`}
                  >
                    Manage Listing
                  </Link>
                  <Link
                    href="/offers"
                    className={`${btnBase} w-full bg-blue-600 text-white hover:bg-blue-500 px-4 py-2 justify-center`}
                  >
                    View All Offers
                  </Link>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
