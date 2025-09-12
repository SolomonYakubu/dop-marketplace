"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";

import Link from "next/link";
import Image from "next/image";
import {
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Hourglass,
  ShieldCheck,
  Handshake,
  ArrowRight,
  Eye,
  FileCheck2,
  CircleCheck,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import clsx from "clsx";
import { getTokenAddresses } from "@/lib/contract";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { Offer, Escrow, EscrowStatus } from "@/types/marketplace";
import {
  formatAddress,
  toGatewayUrl,
  formatTokenAmountWithSymbol,
  timeAgo,
} from "@/lib/utils";
import { useToastContext } from "@/components/providers";
import { ConfirmModal } from "@/components/ConfirmModal";

interface OfferWithListing extends Offer {
  listingTitle?: string;
  listingCreator?: string;
  escrow?: Escrow;
  listingImage?: string;
}

// ---- UI helpers (local design primitives) ----
const badgeBase =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide";
const btnBase =
  "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const escrowMeta: Record<EscrowStatus, { label: string; className: string }> = {
  [EscrowStatus.NONE]: {
    label: "None",
    className: "text-gray-400 bg-gray-500/15",
  },
  [EscrowStatus.IN_PROGRESS]: {
    label: "In Progress",
    className: "text-blue-400 bg-blue-500/15",
  },
  [EscrowStatus.COMPLETED]: {
    label: "Completed",
    className: "text-green-400 bg-green-500/15",
  },
  [EscrowStatus.DISPUTED]: {
    label: "Disputed",
    className: "text-red-400 bg-red-500/15",
  },
  [EscrowStatus.RESOLVED]: {
    label: "Resolved",
    className: "text-purple-400 bg-purple-500/15",
  },
  [EscrowStatus.CANCELLED]: {
    label: "Cancelled",
    className: "text-gray-400 bg-gray-500/15",
  },
};

function EscrowBadge({ status }: { status: EscrowStatus }) {
  const meta = escrowMeta[status];
  return (
    <span className={clsx(badgeBase, meta.className)}>
      <FileCheck2 className="w-3.5 h-3.5" /> {meta.label}
    </span>
  );
}

type OfferStatusType = "accepted" | "cancelled" | "pending";
const offerStatusMeta: Record<
  OfferStatusType,
  { label: string; icon: React.ReactNode; className: string }
> = {
  accepted: {
    label: "Accepted",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    className: "bg-green-500/15 text-green-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: <XCircle className="w-3.5 h-3.5" />,
    className: "bg-red-500/15 text-red-400",
  },
  pending: {
    label: "Pending",
    icon: <Hourglass className="w-3.5 h-3.5" />,
    className: "bg-yellow-500/15 text-yellow-400",
  },
};

function OfferPrimaryBadge({ offer }: { offer: OfferWithListing }) {
  const status: OfferStatusType = offer.accepted
    ? "accepted"
    : offer.cancelled
    ? "cancelled"
    : "pending";
  const meta = offerStatusMeta[status];
  return (
    <span className={clsx(badgeBase, meta.className)}>
      {meta.icon} {meta.label}
    </span>
  );
}

const roleBadgeClass = "bg-gray-700/60 text-gray-200";
function RoleBadge({ sent }: { sent: boolean }) {
  return (
    <span className={clsx(badgeBase, roleBadgeClass)}>
      {sent ? "Sent" : "Received"}
    </span>
  );
}

type TokenMap = Record<string, string | undefined>;
function Amount({
  value,
  token,
  tokens,
}: {
  value: bigint;
  token: string;
  tokens: TokenMap;
}) {
  return <>{formatTokenAmountWithSymbol(value, token, { tokens })}</>;
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p
        className={
          typeof value === "string"
            ? "text-gray-200 font-medium"
            : "text-gray-200"
        }
      >
        {value}
      </p>
    </div>
  );
}

export default function OffersPage() {
  const { contract } = useMarketplaceContract();
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

  const chainId =
    chain?.id ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124);

  const tokens = getTokenAddresses(chainId);

  const loadOffers = useCallback(async () => {
    if (!address || !chain) return;

    setLoading(true);
    setError(null);

    try {
      // Scan recent offers by id (not by blocks), hydrate details
      const lastId = await contract!.getLastOfferId();
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
              return await contract!.getOffer(id);
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
            const listing = await contract!.getListing(off.listingId);
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
              escrow = await contract!.getEscrow(off.id);
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
  }, [address, chain, contract]);

  const acceptOffer = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      try {
        setActionLoading(offerId.toString());

        const tx = await contract!.acceptOffer(offerId);
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
    [chain, address, contract, toast, loadOffers]
  );

  const validateWork = useCallback(
    async (offerId: bigint) => {
      if (!chain || !address) return;

      try {
        setActionLoading(`validate-${offerId.toString()}`);

        const tx = await contract!.validateWork(offerId);
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
    [chain, address, contract, toast, loadOffers]
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

            const tx = await contract!.cancelOffer(offerId);
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
    [chain, address, contract, toast, loadOffers]
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
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading offers...
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/60 to-gray-900/20 animate-pulse"
              />
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
  const filterOptions: {
    value: FilterType;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "all",
      label: "All",
      icon: <ArrowRight className="w-3.5 h-3.5" />,
    },
    {
      value: "sent",
      label: "Sent",
      icon: <ArrowRight className="w-3.5 h-3.5 rotate-45" />,
    },
    {
      value: "received",
      label: "Received",
      icon: <ArrowLeft className="w-3.5 h-3.5" />,
    },
    {
      value: "active",
      label: "Active",
      icon: <Handshake className="w-3.5 h-3.5" />,
    },
    {
      value: "completed",
      label: "Completed",
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
    },
  ];

  const toggleExpanded = (idStr: string) =>
    setExpanded((prev) => ({ ...prev, [idStr]: !prev[idStr] }));

  return (
    <>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex flex-col gap-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">Offers</h1>
              <p className="text-sm text-gray-400">
                Track proposals and contracts in one clean dashboard.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/browse"
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white text-black px-4 py-2 text-sm font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <ArrowRight className="w-4 h-4" /> Browse
              </Link>
              <button
                onClick={loadOffers}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-white/10"
              >
                <RefreshCcw className="w-4 h-4" /> Refresh
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex overflow-x-auto gap-2 pb-1 -mx-1 px-1">
            {filterOptions.map(({ value, label, icon }) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs sm:text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 whitespace-nowrap ${
                    active
                      ? "bg-white text-black border-white"
                      : "border-white/10 bg-gray-900/40 text-gray-300 hover:bg-gray-800/70"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              );
            })}
            <div className="ml-auto hidden sm:flex items-center text-xs text-gray-500">
              {filteredOffers.length} result
              {filteredOffers.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Compact results count (mobile) */}
        <div className="sm:hidden mb-4 text-xs text-gray-500">
          {filteredOffers.length} result{filteredOffers.length === 1 ? "" : "s"}
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
                <div
                  key={idStr}
                  className="group rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col md:flex-row md:items-start gap-5">
                    {/* Media / Listing Image */}
                    <div className="relative w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 flex-shrink-0 rounded-lg overflow-hidden border border-white/10 bg-gray-900">
                      {offer.listingImage ? (
                        <Image
                          src={offer.listingImage}
                          alt={
                            offer.listingTitle ||
                            `Listing #${offer.listingId.toString()}`
                          }
                          fill
                          sizes="(max-width: 768px) 96px, 128px"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
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
                      <div className="absolute inset-0 ring-1 ring-white/10 group-hover:ring-white/30" />
                      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span
                          className={clsx(
                            badgeBase,
                            "bg-gray-800/80 text-gray-300"
                          )}
                        >
                          #{idStr}
                        </span>
                        <OfferPrimaryBadge offer={offer} />
                        {offer.escrow && (
                          <EscrowBadge status={offer.escrow.status} />
                        )}
                        <RoleBadge sent={isSender} />
                      </div>

                      <h3 className="text-lg sm:text-xl font-semibold mb-2 break-words leading-tight">
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
                        className={`grid sm:grid-cols-2 gap-4 text-[13px] mb-3 ${
                          isExpanded ? "" : "hidden md:grid"
                        }`}
                      >
                        <DataRow
                          label="Proposer"
                          value={formatAddress(offer.proposer)}
                        />
                        <DataRow
                          label="Creator"
                          value={
                            offer.listingCreator &&
                            formatAddress(offer.listingCreator)
                          }
                        />
                        <DataRow
                          label="Amount"
                          value={
                            <span className="font-semibold text-gray-100">
                              <Amount
                                value={offer.amount}
                                token={offer.paymentToken}
                                tokens={tokens}
                              />
                            </span>
                          }
                        />
                        <DataRow
                          label="Created"
                          value={timeAgo(Number(offer.createdAt))}
                        />
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
                        <div className="mt-4 p-4 rounded-lg border border-white/5 bg-gray-900/40">
                          <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm tracking-wide uppercase text-gray-300">
                            <Handshake className="w-4 h-4" /> Contract
                          </h4>
                          <div className="grid sm:grid-cols-3 gap-4 text-[13px]">
                            <DataRow
                              label="Amount"
                              value={
                                <span className="font-medium text-gray-100">
                                  <Amount
                                    value={offer.escrow.amount}
                                    token={offer.escrow.paymentToken}
                                    tokens={tokens}
                                  />
                                </span>
                              }
                            />
                            <DataRow
                              label="Fee"
                              value={
                                <span className="text-gray-200">
                                  <Amount
                                    value={offer.escrow.feeAmount}
                                    token={offer.escrow.paymentToken}
                                    tokens={tokens}
                                  />
                                </span>
                              }
                            />
                            <DataRow
                              label="Status"
                              value={escrowMeta[offer.escrow.status].label}
                            />
                          </div>
                          {offer.escrow.status === EscrowStatus.IN_PROGRESS && (
                            <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-gray-300">
                              {[
                                {
                                  label: "Client",
                                  active: offer.escrow.clientValidated,
                                },
                                {
                                  label: "Provider",
                                  active: offer.escrow.providerValidated,
                                },
                              ].map((r) => (
                                <div
                                  key={r.label}
                                  className="flex items-center gap-1"
                                >
                                  <span
                                    className={clsx(
                                      "w-2 h-2 rounded-full",
                                      r.active ? "bg-green-500" : "bg-gray-600"
                                    )}
                                  />
                                  {r.label}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="w-full mt-4 pt-4 border-t border-white/5 md:w-60 md:mt-0 md:pt-0 md:pl-6 md:border-t-0 md:border-l md:border-white/5 md:sticky md:top-4">
                      <div className="space-y-2">
                        {!offer.accepted &&
                          !offer.cancelled &&
                          address?.toLowerCase() ===
                            offer.listingCreator?.toLowerCase() && (
                            <button
                              onClick={() => acceptOffer(offer.id)}
                              disabled={actionLoading === idStr}
                              aria-busy={actionLoading === idStr}
                              className={clsx(
                                btnBase,
                                "w-full bg-green-600 hover:bg-green-500 text-white"
                              )}
                            >
                              {actionLoading === idStr ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />{" "}
                                  Accepting
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-4 h-4" /> Accept
                                  Offer
                                </>
                              )}
                            </button>
                          )}

                        {!offer.accepted && !offer.cancelled && isSender && (
                          <button
                            onClick={() => cancelOffer(offer.id)}
                            disabled={actionLoading === `cancel-${idStr}`}
                            aria-busy={actionLoading === `cancel-${idStr}`}
                            className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 text-sm font-medium"
                          >
                            {actionLoading === `cancel-${idStr}` ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />{" "}
                                Cancelling
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4" /> Cancel Offer
                              </>
                            )}
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
                                  className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
                                >
                                  {actionLoading === `validate-${idStr}` ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />{" "}
                                      Validating
                                    </>
                                  ) : (
                                    <>
                                      <CircleCheck className="w-4 h-4" />{" "}
                                      Validate Work
                                    </>
                                  )}
                                </button>
                              )}
                          </div>
                        )}

                        <Link
                          href={`/offers/${idStr}`}
                          className={clsx(
                            btnBase,
                            "w-full border border-white/10 hover:border-gray-400/40 text-gray-200 hover:text-white bg-transparent"
                          )}
                        >
                          <Eye className="w-4 h-4" /> View Details
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
