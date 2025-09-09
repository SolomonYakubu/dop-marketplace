"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, use, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { getTokenAddresses } from "@/lib/contract";
import { knownDecimalsFor } from "@/lib/utils";
import {
  toGatewayUrl,
  formatAddress,
  formatTokenAmount,
  tokenSymbolFor,
  timeAgo,
  loadListingMetadataFromURI,
  getCategoryLabel,
} from "@/lib/utils";
import { Offer, EscrowStatus, Listing } from "@/types/marketplace";
import type { ListingMetadata } from "@/types/marketplace";
import { useToastContext } from "@/components/providers";
import { ConfirmModal } from "@/components/ConfirmModal";

// Explicit mapping to ensure correct label/colors regardless of imported enum ordering
const ESCROW_STATUS_LABELS: Record<number, string> = {
  0: "None",
  1: "In Progress",
  2: "Completed",
  3: "Disputed",
  4: "Resolved",
  5: "Cancelled",
};
const ESCROW_STATUS_CLASS: Record<number, string> = {
  1: "px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full",
  2: "px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full",
  3: "px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-full",
  4: "px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs rounded-full",
  5: "px-2 py-1 bg-gray-500/20 text-gray-400 text-xs rounded-full",
};

// Removed local ERC20_ABI (no on-chain decimals lookup needed here)

interface OfferWithEscrow extends Offer {
  escrowStatus?: EscrowStatus;
  canAccept?: boolean;
  canCancel?: boolean;
}

// Page-local UI state shape built from shared types
type ListingState = Listing & {
  title: string;
  description: string;
  cover: string | null;
  categoryLabel: string;
  isBoosted: boolean;
  createdAgo: string;
  skills: string[];
  metadata?: ListingMetadata;
  primaryLink: string | null;
  metadataLink: string | null;
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
      const metadataLink = toGatewayUrl(l.metadataURI);
      const primaryLink =
        toGatewayUrl(meta?.attachments?.[0] || null) || metadataLink || null;

      const categoryLabel = getCategoryLabel(Number(l.category));
      const createdAgo = timeAgo(Number(l.createdAt));

      const title = meta?.title || `Brief #${resolvedParams.id}`;
      const description = meta?.description || "No description provided.";
      const skills = (meta?.requirements ?? []).slice(0, 20);

      setState({
        ...l,
        title,
        description,
        cover,
        categoryLabel,
        isBoosted,
        createdAgo,
        skills,
        metadata: meta,
        primaryLink,
        metadataLink,
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
      <div className="flex items-center justify-between">
        <Link href="/briefs" className="text-sm text-gray-400 hover:text-white">
          ← Back to Briefs
        </Link>
        {state?.metadataLink && (
          <a
            href={state.metadataLink}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-gray-400 hover:text-white"
          >
            Open metadata
          </a>
        )}
      </div>

      {loading ? (
        <div className="container-panel p-6 animate-pulse space-y-4">
          <div className="h-8 w-1/2 bg-gray-900/60 rounded" />
          <div className="h-48 w-full bg-gray-900/60 rounded" />
          <div className="h-4 w-full bg-gray-900/60 rounded" />
          <div className="h-4 w-5/6 bg-gray-900/60 rounded" />
        </div>
      ) : error ? (
        <div className="container-panel p-6 text-sm text-red-400">{error}</div>
      ) : state ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Main Listing Content */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                  Brief
                </span>
                <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                  {state.categoryLabel}
                </span>
                {state.isBoosted && (
                  <span className="text-[11px] rounded-full border border-amber-500/30 bg-amber-400/20 px-2 py-0.5 text-amber-300">
                    ⚡ Boosted
                  </span>
                )}
                {!state.active && (
                  <span className="text-[11px] rounded-full border border-red-500/30 bg-red-400/20 px-2 py-0.5 text-red-300">
                    Inactive
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  {state.createdAgo}
                </span>
              </div>
              <h1 className="text-2xl font-semibold">{state.title}</h1>
              {state.cover ? (
                <Image
                  src={state.cover}
                  alt="cover"
                  width={1600}
                  height={900}
                  className="mt-4 w-full rounded object-cover max-h-96"
                />
              ) : null}
              <p className="mt-4 text-gray-300 whitespace-pre-wrap">
                {state.description}
              </p>

              {!!state.skills?.length && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {state.skills.map((s: string, i: number) => (
                    <span
                      key={`sk-${i}`}
                      className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-400"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Budget info from metadata */}
              {(() => {
                const b = state.metadata?.budget;
                if (!b) return null;
                const hasMin = typeof b.min === "number";
                const hasMax = typeof b.max === "number";
                const content =
                  hasMin && hasMax
                    ? `$${b.min} - $${b.max}`
                    : hasMin
                    ? `$${b.min}+`
                    : hasMax
                    ? `Up to $${b.max}`
                    : "Budget to be discussed";
                return (
                  <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
                    <h3 className="font-medium text-green-400 mb-2">
                      Budget Information
                    </h3>
                    <p className="text-gray-300">{content}</p>
                  </div>
                );
              })()}

              {/* Requirements */}
              {Array.isArray(state.metadata?.requirements) && (
                <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
                  <h3 className="font-medium mb-2">Requirements</h3>
                  <ul className="list-disc list-inside text-gray-300 space-y-1">
                    {(state.metadata?.requirements || []).map((req, idx) => (
                      <li key={idx}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Deliverables */}
              {Array.isArray(state.metadata?.deliverables) && (
                <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
                  <h3 className="font-medium mb-2">Expected Deliverables</h3>
                  <ul className="list-disc list-inside text-gray-300 space-y-1">
                    {(state.metadata?.deliverables || []).map((del, idx) => (
                      <li key={idx}>{del}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Offers Section */}
            <div className="container-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">
                  Offers ({offers.length})
                </h2>
                {canMakeOffer && (
                  <button
                    onClick={() => setShowOfferForm(!showOfferForm)}
                    className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
                  >
                    Make Offer
                  </button>
                )}
              </div>

              {/* Offer Form */}
              {showOfferForm && canMakeOffer && (
                <div className="mb-6 p-4 border border-gray-700 rounded-lg">
                  <h3 className="font-medium mb-3">Submit Your Offer</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={offerAmount}
                        onChange={(e) => setOfferAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded border border-gray-800 bg-black px-3 py-2 text-sm focus:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Payment Token
                      </label>
                      <select
                        value={paymentToken}
                        onChange={(e) => setPaymentToken(e.target.value)}
                        className="w-full rounded border border-gray-800 bg-black px-3 py-2 text-sm focus:border-gray-600"
                      >
                        <option value="ETH">ETH</option>
                        {tokens.USDC && <option value="USDC">USDC</option>}
                        {tokens.DOP && <option value="DOP">DOP</option>}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={submitOffer}
                        disabled={submittingOffer || !offerAmount}
                        className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
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
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="h-20 bg-gray-900/50 rounded animate-pulse"
                    ></div>
                  ))}
                </div>
              ) : offers.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No offers yet</p>
              ) : (
                <div className="space-y-3">
                  {offers.map((offer, idx) => (
                    <div
                      key={
                        offer.id != null ? offer.id.toString() : `offer-${idx}`
                      }
                      className="p-4 border border-gray-800 rounded-lg hover:border-gray-700"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">
                              {offer.amount != null
                                ? formatTokenAmount(
                                    offer.amount,
                                    offer.paymentToken,
                                    { tokens, maxFractionDigits: 6 }
                                  )
                                : "0"}{" "}
                              {tokenSymbolFor(offer.paymentToken, tokens)}
                            </span>
                            {(() => {
                              const s =
                                offer.escrowStatus != null
                                  ? Number(offer.escrowStatus)
                                  : undefined;
                              const label =
                                s != null ? ESCROW_STATUS_LABELS[s] : undefined;
                              const cls =
                                s != null ? ESCROW_STATUS_CLASS[s] : undefined;
                              return label && cls ? (
                                <span className={cls}>{label}</span>
                              ) : null;
                            })()}
                            {offer.cancelled && (
                              <span className={ESCROW_STATUS_CLASS[5]}>
                                Cancelled
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-sm">
                            From {formatAddress(offer.proposer)} •{" "}
                            {timeAgo(Number(offer.createdAt))}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {offer.canAccept && (
                            <button
                              onClick={() => acceptOffer(offer.id)}
                              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
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
                              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="container-panel p-6 space-y-3">
              <h3 className="font-medium">On-chain Info</h3>
              <div className="text-sm text-gray-400">
                <div>
                  <span className="text-gray-500">Listing ID:</span>{" "}
                  {String(state.id)}
                </div>
                <div className="mt-1">
                  <span className="text-gray-500">Creator:</span>{" "}
                  {formatAddress(state.creator)}
                </div>
                <div className="mt-1 break-all">
                  <span className="text-gray-500">Status:</span>{" "}
                  <span
                    className={state.active ? "text-green-400" : "text-red-400"}
                  >
                    {state.active ? "Active" : "Inactive"}
                  </span>
                </div>
                {state.isBoosted && (
                  <div className="mt-1">
                    <span className="text-gray-500">Boost expires:</span>{" "}
                    {new Date(
                      Number(state.boostExpiry) * 1000
                    ).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>

            {state.primaryLink && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="font-medium">Attachment</h3>
                <a
                  href={state.primaryLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-cyan-300 hover:underline break-all"
                >
                  View File
                </a>
              </div>
            )}

            {isOwner && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="font-medium">Owner Actions</h3>
                <div className="space-y-2">
                  <Link
                    href={`/manage/listing/${state.id}`}
                    className="block w-full text-center px-4 py-2 border border-gray-700 rounded hover:border-gray-600"
                  >
                    Manage Listing
                  </Link>
                  <Link
                    href="/offers"
                    className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
