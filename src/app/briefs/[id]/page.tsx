"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, use, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { getMarketplaceContract, getTokenAddresses } from "@/lib/contract";
import {
  toGatewayUrl,
  formatAddress,
  formatTokenAmount,
  tokenSymbolFor,
  getRpcUrl,
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

// Minimal ERC20 ABI for allowance/approve
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

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

  // Normalize waiting for transactions across different return shapes (hash or TransactionResponse)
  async function waitTx(
    tx:
      | { wait?: () => Promise<unknown> }
      | { hash?: string }
      | string
      | null
      | undefined,
    provider:
      | { waitForTransaction?: (hash: string) => Promise<unknown> }
      | null
      | undefined
  ) {
    // ethers.Contract (v6): TransactionResponse with wait()
    if (
      tx &&
      typeof (tx as { wait?: () => Promise<unknown> }).wait === "function"
    ) {
      return await (tx as { wait: () => Promise<unknown> }).wait();
    }
    // viem/hash-like or custom wrapper: string or object with .hash
    const hash = typeof tx === "string" ? tx : (tx as { hash?: string })?.hash;
    if (!hash) return null;
    if (
      provider &&
      typeof (
        provider as { waitForTransaction?: (hash: string) => Promise<unknown> }
      ).waitForTransaction === "function"
    ) {
      return await (
        provider as { waitForTransaction: (hash: string) => Promise<unknown> }
      ).waitForTransaction(hash);
    }
    // Fallback no-op
    return null;
  }

  // Cache for ERC20 decimals per token address
  const erc20DecimalsCache = new Map<string, number>();
  async function getTokenDecimals(
    tokenAddress: string,
    provider: ethers.Provider
  ): Promise<number> {
    const key = ethers.getAddress(tokenAddress);
    const cached = erc20DecimalsCache.get(key);
    if (cached) return cached;
    const tokenRO = new ethers.Contract(key, ERC20_ABI, provider);
    const dec: number = await tokenRO.decimals();
    erc20DecimalsCache.set(key, dec);
    return dec;
  }

  // Ensure proposer has sufficient allowance for ERC20 payments before submitting offer
  async function ensureAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    amount: bigint,
    signer: ethers.Signer,
    provider: ethers.BrowserProvider
  ) {
    // Require strict hex addresses to avoid ENS resolution paths
    const isHexAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
    if (!isHexAddr(tokenAddress) || !isHexAddr(owner) || !isHexAddr(spender)) {
      console.warn("Skipping allowance check due to non-hex address", {
        tokenAddress,
        owner,
        spender,
      });
      return;
    }

    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const current: bigint = await token.allowance(owner, spender);
    if (current < amount) {
      const tx = await token.approve(spender, amount);
      await waitTx(tx, provider);
    }
  }

  async function submitOffer() {
    if (!chain || !address || !state) return;

    if (!offerAmount || parseFloat(offerAmount) <= 0) {
      toast.showError("Invalid amount", "Please enter a valid offer amount");
      return;
    }

    try {
      setSubmittingOffer(true);

      const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
        .ethereum;
      if (!eth) throw new Error("Wallet provider not found");
      const browserProvider = new ethers.BrowserProvider(eth);
      const signer = await browserProvider.getSigner();
      const contractRO = getMarketplaceContract(chainId, browserProvider);
      const contract = contractRO.connect(signer);

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
        const dec = await getTokenDecimals(erc20Addr, browserProvider);
        finalAmount = ethers.parseUnits(offerAmount, dec);

        // Proposer approves allowance upfront for the marketplace contract
        const ownerAddr = ethers.getAddress(await signer.getAddress());
        const spender = contractRO.contractAddress;
        if (spender) {
          await ensureAllowance(
            erc20Addr,
            ownerAddr,
            spender,
            finalAmount,
            signer,
            browserProvider
          );
        } else {
          console.warn(
            "Marketplace contract address not resolvable; skipping allowance pre-check"
          );
        }
      }

      const tx = await contract.makeOffer(state.id, finalAmount, tokenAddress);
      await waitTx(tx, browserProvider);

      toast.showSuccess("Offer submitted");
      setOfferAmount("");
      setShowOfferForm(false);
      await loadOffers();
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
      const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
        .ethereum;
      if (!eth) throw new Error("Wallet provider not found");
      const browserProvider = new ethers.BrowserProvider(eth);
      const signer = await browserProvider.getSigner();
      const contractRO = getMarketplaceContract(chainId, browserProvider);
      const contract = contractRO.connect(signer);

      // No token approvals here; creator just accepts
      const tx = await contract.acceptOffer(offerId);
      await waitTx(tx, browserProvider);

      toast.showSuccess("Offer accepted");
      await loadOffers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to accept offer";
      console.error("Failed to accept offer:", e);
      toast.showError("Accept failed", msg);
    }
  }

  async function cancelOffer(offerId: bigint) {
    if (!chain || !address) return;
    try {
      const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
        .ethereum;
      if (!eth) throw new Error("Wallet provider not found");
      const browserProvider = new ethers.BrowserProvider(eth);
      const signer = await browserProvider.getSigner();
      const contractRO = getMarketplaceContract(chainId, browserProvider);
      const contract = contractRO.connect(signer);

      const tx = await contract.cancelOffer(offerId);
      await waitTx(tx, browserProvider);

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

            {/* Metadata debug */}
            <details className="container-panel">
              <summary className="p-6 cursor-pointer font-medium">
                Debug: Full metadata
              </summary>
              <div className="px-6 pb-6">
                <pre className="text-xs text-gray-400 overflow-auto max-h-80">
                  {JSON.stringify(state.metadata ?? null, null, 2)}
                </pre>
              </div>
            </details>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
