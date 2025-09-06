"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import Link from "next/link";
import Image from "next/image";
import { getMarketplaceContract, getTokenAddresses } from "@/lib/contract";
import { Offer, Escrow, EscrowStatus } from "@/types/marketplace";
import {
  formatAddress,
  toGatewayUrl,
  formatTokenAmountWithSymbol,
} from "@/lib/utils";
import { useToastContext } from "@/components/providers";
import { ConfirmModal } from "@/components/ConfirmModal";

interface OfferWithListing extends Offer {
  listingTitle?: string;
  listingCreator?: string;
  escrow?: Escrow;
  listingImage?: string;
}

function getRpcUrl(chainId: number) {
  return chainId === 2741
    ? "https://api.mainnet.abs.xyz"
    : "https://api.testnet.abs.xyz";
}

function timeAgo(tsSec: number) {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function getEscrowStatusLabel(status: EscrowStatus) {
  switch (status) {
    case EscrowStatus.NONE:
      return "None";
    case EscrowStatus.IN_PROGRESS:
      return "In Progress";
    case EscrowStatus.COMPLETED:
      return "Completed";
    case EscrowStatus.DISPUTED:
      return "Disputed";
    case EscrowStatus.RESOLVED:
      return "Resolved";
    case EscrowStatus.CANCELLED:
      return "Cancelled";
    default:
      return "Unknown";
  }
}

function getEscrowStatusColor(status: EscrowStatus) {
  switch (status) {
    case EscrowStatus.NONE:
      return "text-gray-400 bg-gray-400/20";
    case EscrowStatus.IN_PROGRESS:
      return "text-blue-400 bg-blue-400/20";
    case EscrowStatus.COMPLETED:
      return "text-green-400 bg-green-400/20";
    case EscrowStatus.DISPUTED:
      return "text-red-400 bg-red-400/20";
    case EscrowStatus.RESOLVED:
      return "text-purple-400 bg-purple-400/20";
    case EscrowStatus.CANCELLED:
      return "text-gray-400 bg-gray-400/20";
    default:
      return "text-gray-400 bg-gray-400/20";
  }
}

export default function OffersPage() {
  const { chain, address } = useAccount();
  const toast = useToastContext();
  const [offers, setOffers] = useState<OfferWithListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "sent" | "received" | "active" | "completed"
  >("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Track expanded state per-offer for mobile details
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Confirmation modal state
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message?: React.ReactNode;
    action?: () => Promise<void>;
  }>({ open: false, title: "", message: undefined, action: undefined });

  const chainId = chain?.id ?? 11124;
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );
  const tokens = getTokenAddresses(chainId);

  const loadOffers = useCallback(async () => {
    if (!address || !chain) return;

    setLoading(true);
    setError(null);

    try {
      const contract = getMarketplaceContract(chainId, provider);

      // Scan recent offers by id (not by blocks), hydrate details
      const lastId = await contract.getLastOfferId();
      const MAX_TO_CHECK = BigInt(1000); // how many recent offers to scan
      const MAX_COLLECT = 200; // cap results for UI
      const BATCH = BigInt(50);

      let cursor = lastId;
      const collected: OfferWithListing[] = [];

      while (cursor > BigInt(0) && collected.length < MAX_COLLECT) {
        const ids: bigint[] = [];
        for (
          let i = BigInt(0);
          i < BATCH && cursor > BigInt(0);
          i += BigInt(1)
        ) {
          ids.push(cursor);
          cursor -= BigInt(1);
        }

        const offersBatch = await Promise.all(
          ids.map(async (id) => {
            try {
              return await contract.getOffer(id);
            } catch (e) {
              console.warn("Failed to fetch offer", id.toString(), e);
              return null;
            }
          })
        );

        // hydrate listing + escrow for relevant offers
        for (const off of offersBatch) {
          if (!off) continue;
          // Filter: relevant to user (sent or received)
          let relevant = false;
          if (off.proposer && address) {
            relevant = off.proposer.toLowerCase() === address.toLowerCase();
          }

          let listingTitle: string | undefined;
          let listingCreator: string | undefined;
          let listingImage: string | undefined;

          try {
            const listing = await contract.getListing(off.listingId);
            listingCreator = listing.creator;
            if (address && !relevant) {
              relevant =
                listing.creator.toLowerCase() === address.toLowerCase();
            }

            // best-effort metadata title + image
            listingTitle = `Listing #${off.listingId.toString()}`;
            if (listing.metadataURI) {
              try {
                const gatewayUrl = toGatewayUrl(listing.metadataURI);
                if (gatewayUrl) {
                  const response = await fetch(gatewayUrl);
                  if (response.ok) {
                    const metadata = await response.json().catch(() => null);
                    if (metadata && typeof metadata === "object") {
                      const t = (metadata as { title?: string }).title;
                      if (t) listingTitle = t;
                      const img =
                        (metadata as { image?: string }).image || null;
                      const imgUrl = toGatewayUrl(img);
                      if (imgUrl) listingImage = imgUrl;
                    }
                  }
                }
              } catch (err) {
                console.warn("Failed to load listing metadata:", err);
              }
            }
          } catch (err) {
            console.warn(
              "Failed to fetch listing for offer",
              off.id.toString(),
              err
            );
          }

          if (!relevant) continue;

          let escrow: Escrow | undefined;
          if (off.accepted) {
            try {
              escrow = await contract.getEscrow(off.id);
            } catch {
              // ignore
            }
          }
          collected.push({
            ...off,
            listingTitle,
            listingCreator,
            escrow,
            listingImage,
          });
          if (collected.length >= MAX_COLLECT) break;
        }

        if (lastId - cursor >= MAX_TO_CHECK) break;
      }

      // newest first
      setOffers(collected.sort((a, b) => Number(b.createdAt - a.createdAt)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load offers";
      console.error("Failed to load offers:", e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [address, chain, chainId, provider]);

  const acceptOffer = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      try {
        setActionLoading(offerId.toString());

        const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
          .ethereum;
        if (!eth) throw new Error("Wallet provider not found");
        const browserProvider = new ethers.BrowserProvider(eth);
        const contract = getMarketplaceContract(chainId, browserProvider);
        const signer = await browserProvider.getSigner();
        contract.connect(signer);

        const tx = await contract.acceptOffer(offerId);
        await tx;

        toast.showSuccess("Success", "Offer accepted successfully!");
        await loadOffers();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to accept offer";
        console.error("Failed to accept offer:", e);
        toast.showError("Error", msg);
      } finally {
        setActionLoading(null);
      }
    },
    [chain, address, chainId, loadOffers, toast]
  );

  const validateWork = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      try {
        setActionLoading(`validate-${offerId.toString()}`);

        const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
          .ethereum;
        if (!eth) throw new Error("Wallet provider not found");
        const browserProvider = new ethers.BrowserProvider(eth);
        const contract = getMarketplaceContract(chainId, browserProvider);
        const signer = await browserProvider.getSigner();
        contract.connect(signer);

        const tx = await contract.validateWork(offerId);
        await tx;

        toast.showSuccess("Success", "Work validated successfully!");
        await loadOffers();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to validate work";
        console.error("Failed to validate work:", e);
        toast.showError("Error", msg);
      } finally {
        setActionLoading(null);
      }
    },
    [chain, address, chainId, loadOffers, toast]
  );

  const openDispute = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      setConfirm({
        open: true,
        title: "Open Dispute",
        message:
          "Are you sure you want to open a dispute? This action cannot be undone.",
        action: async () => {
          setConfirm((c) => ({ ...c, open: false }));
          try {
            setActionLoading(`dispute-${offerId.toString()}`);

            const eth = (
              window as unknown as { ethereum?: ethers.Eip1193Provider }
            ).ethereum;
            if (!eth) throw new Error("Wallet provider not found");
            const browserProvider = new ethers.BrowserProvider(eth);
            const contract = getMarketplaceContract(chainId, browserProvider);
            const signer = await browserProvider.getSigner();
            contract.connect(signer);

            const tx = await contract.openDispute(offerId);
            await tx;

            toast.showSuccess("Success", "Dispute opened successfully!");
            await loadOffers();
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "Failed to open dispute";
            console.error("Failed to open dispute:", e);
            toast.showError("Error", msg);
          } finally {
            setActionLoading(null);
          }
        },
      });
    },
    [chain, address, chainId, loadOffers, toast]
  );

  const cancelOffer = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      setConfirm({
        open: true,
        title: "Cancel Offer",
        message: "Are you sure you want to cancel this offer?",
        action: async () => {
          setConfirm((c) => ({ ...c, open: false }));
          try {
            setActionLoading(`cancel-${offerId.toString()}`);

            const eth = (
              window as unknown as { ethereum?: ethers.Eip1193Provider }
            ).ethereum;
            if (!eth) throw new Error("Wallet provider not found");
            const browserProvider = new ethers.BrowserProvider(eth);
            const contract = getMarketplaceContract(chainId, browserProvider);
            const signer = await browserProvider.getSigner();
            contract.connect(signer);

            const tx = await contract.cancelOffer(offerId);
            await tx;

            toast.showSuccess("Success", "Offer cancelled successfully!");
            await loadOffers();
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "Failed to cancel offer";
            console.error("Failed to cancel offer:", e);
            toast.showError("Error", msg);
          } finally {
            setActionLoading(null);
          }
        },
      });
    },
    [chain, address, chainId, loadOffers, toast]
  );

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  const filteredOffers = useMemo(() => {
    if (!address) return [];

    return offers.filter((offer) => {
      switch (filter) {
        case "sent":
          return offer.proposer.toLowerCase() === address.toLowerCase();
        case "received":
          return offer.listingCreator?.toLowerCase() === address.toLowerCase();
        case "active":
          return (
            offer.accepted && offer.escrow?.status === EscrowStatus.IN_PROGRESS
          );
        case "completed":
          return offer.escrow?.status === EscrowStatus.COMPLETED;
        default:
          return (
            offer.proposer.toLowerCase() === address.toLowerCase() ||
            offer.listingCreator?.toLowerCase() === address.toLowerCase()
          );
      }
    });
  }, [offers, filter, address]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-800 rounded w-1/3"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={loadOffers}
            className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  type FilterType = typeof filter;
  const filterOptions: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "sent", label: "Sent by Me" },
    { value: "received", label: "Received" },
    { value: "active", label: "Active Contracts" },
    { value: "completed", label: "Completed" },
  ];

  const toggleExpanded = (idStr: string) =>
    setExpanded((prev) => ({ ...prev, [idStr]: !prev[idStr] }));

  return (
    <>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">
              Offers & Contracts
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Manage your offers and active contracts
            </p>
          </div>
          <Link
            href="/browse"
            className="px-3 py-2 sm:px-4 sm:py-2 bg-white text-black rounded-lg hover:opacity-90 text-sm sm:text-base whitespace-nowrap"
          >
            Browse Listings
          </Link>
        </div>

        {/* Filters - sticky and horizontally scrollable on mobile */}
        <div className="sticky top-0 z-10 -mx-6 px-6 py-3 mb-4 sm:mb-6 bg-black/60 supports-[backdrop-filter]:bg-black/30 backdrop-blur border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="flex-1 overflow-x-auto">
              <div className="flex gap-2 min-w-max">
                {filterOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                      filter === value
                        ? "bg-white text-black"
                        : "border border-gray-700 text-gray-300 hover:border-gray-600"
                    }`}
                    aria-pressed={filter === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={loadOffers}
              className="px-3 py-2 rounded-lg text-sm border border-gray-700 hover:border-gray-600"
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Results count */}
        <div className="mb-4 text-sm text-gray-400">
          {filteredOffers.length} offer{filteredOffers.length !== 1 ? "s" : ""}{" "}
          found
        </div>

        {/* Offers List */}
        <div className="space-y-4">
          {filteredOffers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4">No offers found.</p>
              <Link
                href="/browse"
                className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
              >
                Browse listings to make offers
              </Link>
            </div>
          ) : (
            filteredOffers.map((offer) => {
              const idStr = offer.id.toString();
              const isExpanded = !!expanded[idStr];
              const isSender =
                address?.toLowerCase() === offer.proposer.toLowerCase();

              return (
                <div key={idStr} className="group container-panel p-4 sm:p-6">
                  <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                    {/* Media / Listing Image */}
                    <div className="relative w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 flex-shrink-0 rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                      {offer.listingImage ? (
                        <Image
                          src={offer.listingImage}
                          alt={
                            offer.listingTitle ||
                            `Listing #${offer.listingId.toString()}`
                          }
                          fill
                          sizes="(max-width: 768px) 96px, 128px"
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          unoptimized
                          onError={(e) => {
                            (
                              e.currentTarget as HTMLImageElement
                            ).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-gray-900 to-gray-800">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            className="w-8 h-8 text-gray-600"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.5"
                              d="M3 16l5-5 4 4 5-6 4 5M3 7h18"
                            />
                          </svg>
                        </div>
                      )}
                      {/* subtle overlays */}
                      <div className="absolute inset-0 ring-1 ring-white/10 group-hover:ring-blue-500/30" />
                      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded-full">
                          #{idStr}
                        </span>

                        {offer.accepted ? (
                          <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                            ✓ Accepted
                          </span>
                        ) : offer.cancelled ? (
                          <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
                            ✗ Cancelled
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
                            ⏳ Pending
                          </span>
                        )}

                        {offer.escrow && (
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${getEscrowStatusColor(
                              offer.escrow.status
                            )}`}
                          >
                            {getEscrowStatusLabel(offer.escrow.status)}
                          </span>
                        )}

                        <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded-full">
                          {isSender ? "Sent" : "Received"}
                        </span>
                      </div>

                      <h3 className="text-lg sm:text-xl font-semibold mb-2 break-words">
                        <Link
                          href={`/briefs/${offer.listingId.toString()}`}
                          className="hover:text-gray-300 transition-colors"
                        >
                          {offer.listingTitle}
                        </Link>
                      </h3>

                      {/* Compact summary on mobile */}
                      <div className="md:hidden flex items-center justify-between text-sm mb-2">
                        <div className="font-semibold">
                          {formatTokenAmountWithSymbol(
                            offer.amount,
                            offer.paymentToken,
                            { tokens }
                          )}
                        </div>
                        <div className="text-gray-400">
                          {timeAgo(Number(offer.createdAt))}
                        </div>
                      </div>

                      {/* Detail grid: visible on md+, toggle on mobile */}
                      <div
                        className={`grid sm:grid-cols-2 gap-4 text-sm mb-3 ${
                          isExpanded ? "" : "hidden md:grid"
                        }`}
                      >
                        <div>
                          <p className="text-gray-400">Proposer:</p>
                          <p>{formatAddress(offer.proposer)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Listing Creator:</p>
                          <p>
                            {offer.listingCreator &&
                              formatAddress(offer.listingCreator)}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400">Amount:</p>
                          <p className="font-semibold">
                            {formatTokenAmountWithSymbol(
                              offer.amount,
                              offer.paymentToken,
                              { tokens }
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400">Created:</p>
                          <p>{timeAgo(Number(offer.createdAt))}</p>
                        </div>
                      </div>

                      {/* Toggle details button on mobile */}
                      <button
                        className="md:hidden text-xs text-gray-300 underline underline-offset-4"
                        onClick={() => toggleExpanded(idStr)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>

                      {/* Escrow Details */}
                      {offer.escrow && (
                        <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
                          <h4 className="font-semibold mb-2">
                            Contract Details
                          </h4>
                          <div className="grid sm:grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-gray-400">Contract Amount:</p>
                              <p>
                                {formatTokenAmountWithSymbol(
                                  offer.escrow.amount,
                                  offer.escrow.paymentToken,
                                  { tokens }
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-400">Fee:</p>
                              <p>
                                {formatTokenAmountWithSymbol(
                                  offer.escrow.feeAmount,
                                  offer.escrow.paymentToken,
                                  { tokens }
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-400">Status:</p>
                              <p>{getEscrowStatusLabel(offer.escrow.status)}</p>
                            </div>
                          </div>

                          {offer.escrow.status === EscrowStatus.IN_PROGRESS && (
                            <div className="mt-3 flex items-center gap-4 text-sm">
                              <div className="flex items-center">
                                <span
                                  className={`w-2 h-2 rounded-full mr-2 ${
                                    offer.escrow.clientValidated
                                      ? "bg-green-500"
                                      : "bg-gray-600"
                                  }`}
                                ></span>
                                Client Validated
                              </div>
                              <div className="flex items-center">
                                <span
                                  className={`w-2 h-2 rounded-full mr-2 ${
                                    offer.escrow.providerValidated
                                      ? "bg-green-500"
                                      : "bg-gray-600"
                                  }`}
                                ></span>
                                Provider Validated
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="w-full mt-3 pt-3 border-t border-gray-800 md:w-56 md:mt-0 md:pt-0 md:pl-6 md:border-t-0 md:border-l md:border-gray-800 md:sticky md:top-4">
                      <div className="space-y-2">
                        {!offer.accepted &&
                          !offer.cancelled &&
                          address?.toLowerCase() ===
                            offer.listingCreator?.toLowerCase() && (
                            <button
                              onClick={() => acceptOffer(offer.id)}
                              disabled={actionLoading === idStr}
                              aria-busy={actionLoading === idStr}
                              className="w-full h-10 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                              {actionLoading === idStr
                                ? "Accepting..."
                                : "Accept Offer"}
                            </button>
                          )}

                        {!offer.accepted && !offer.cancelled && isSender && (
                          <button
                            onClick={() => cancelOffer(offer.id)}
                            disabled={actionLoading === `cancel-${idStr}`}
                            aria-busy={actionLoading === `cancel-${idStr}`}
                            className="w-full h-10 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            {actionLoading === `cancel-${idStr}`
                              ? "Cancelling..."
                              : "Cancel Offer"}
                          </button>
                        )}

                        {offer.escrow?.status === EscrowStatus.IN_PROGRESS && (
                          <div className="space-y-2">
                            {offer.escrow &&
                              ((address?.toLowerCase() ===
                                offer.escrow.client.toLowerCase() &&
                                !offer.escrow.clientValidated) ||
                                (address?.toLowerCase() ===
                                  offer.escrow.provider.toLowerCase() &&
                                  !offer.escrow.providerValidated)) && (
                                <button
                                  onClick={() => validateWork(offer.id)}
                                  disabled={
                                    actionLoading === `validate-${idStr}`
                                  }
                                  aria-busy={
                                    actionLoading === `validate-${idStr}`
                                  }
                                  className="w-full h-10 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {actionLoading === `validate-${idStr}`
                                    ? "Validating..."
                                    : "Validate Work"}
                                </button>
                              )}

                            <button
                              onClick={() => openDispute(offer.id)}
                              disabled={actionLoading === `dispute-${idStr}`}
                              aria-busy={actionLoading === `dispute-${idStr}`}
                              className="w-full h-10 px-4 py-2 border border-red-500 text-red-400 rounded-lg hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {actionLoading === `dispute-${idStr}`
                                ? "Opening..."
                                : address?.toLowerCase() ===
                                  offer.escrow?.client.toLowerCase()
                                ? "Request Refund"
                                : "Open Dispute"}
                            </button>
                          </div>
                        )}

                        <Link
                          href={`/offers/${idStr}`}
                          className="block w-full h-10 px-4 py-2 border border-gray-700 text-center rounded-lg hover:border-gray-600 transition-colors"
                        >
                          View Details
                        </Link>
                      </div>
                    </div>
                    {/* End Actions */}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={() => confirm.action?.()}
        confirmText="Proceed"
        danger={true}
      />
    </>
  );
}
