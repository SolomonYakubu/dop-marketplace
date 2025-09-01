"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, use } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { getMarketplaceContract, getTokenAddresses } from "@/lib/contract";
import {
  EscrowStatus,
  DisputeOutcome,
  Offer,
  Escrow,
  Listing,
  ListingMetadata,
} from "@/types/marketplace";
import {
  formatAddress,
  truncateText,
  formatTokenAmount,
  tokenSymbolFor,
  knownDecimalsFor,
  loadListingMetadataFromURI,
  timeAgo,
  getRpcUrl,
  toGatewayUrl,
} from "@/lib/utils";

// Helpers for escrow labels (kept local; not in shared utils yet)
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

function getDisputeOutcomeLabel(outcome: DisputeOutcome) {
  switch (outcome) {
    case DisputeOutcome.NONE:
      return "None";
    case DisputeOutcome.CLIENT_WINS:
      return "Client Wins";
    case DisputeOutcome.PROVIDER_WINS:
      return "Provider Wins";
    case DisputeOutcome.SPLIT:
      return "Split";
    default:
      return "Unknown";
  }
}

// Minimal ERC20 surface used in this page (to avoid any)
type ERC20 = {
  decimals(): Promise<number>;
  symbol(): Promise<string>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(
    spender: string,
    amount: bigint
  ): Promise<ethers.ContractTransactionResponse>;
};

// Typed helper to get the injected browser provider without using `any`
function getBrowserProvider(): ethers.BrowserProvider {
  if (typeof window === "undefined") {
    throw new Error("No window available");
  }
  const w = window as typeof window & { ethereum?: unknown };
  if (!w.ethereum) {
    throw new Error("No injected provider found");
  }
  return new ethers.BrowserProvider(w.ethereum as ethers.Eip1193Provider);
}

export default function OfferDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { address, chain } = useAccount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingMetadata, setListingMetadata] = useState<
    ListingMetadata | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState(false);

  // New state for token + fee UX
  const [isEth, setIsEth] = useState<boolean>(true);
  const [tokenSymbol, setTokenSymbol] = useState<string>("ETH");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const [feeBps, setFeeBps] = useState<bigint>(BigInt(0));
  const [estFee, setEstFee] = useState<bigint>(BigInt(0));
  const [providerPayout, setProviderPayout] = useState<bigint>(BigInt(0));
  const [needsApproval, setNeedsApproval] = useState<boolean>(false);
  const [allowance, setAllowance] = useState<bigint>(BigInt(0));
  const [approving, setApproving] = useState<boolean>(false);

  // Reviews state
  const [hasReviewed, setHasReviewed] = useState<boolean>(false);
  const [canReview, setCanReview] = useState<boolean>(false);
  const [rating, setRating] = useState<number>(5);
  const [reviewText, setReviewText] = useState<string>("");
  const [leavingReview, setLeavingReview] = useState<boolean>(false);

  const chainId = chain?.id ?? 11124;
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );
  const tokens = getTokenAddresses(chainId);

  // Derive cover image from listing metadata (IPFS/HTTP tolerant)
  const cover = toGatewayUrl(listingMetadata?.image || null);

  // The actor who must accept is always the listing creator (per contract)
  const canAccept =
    !!address &&
    !!listing &&
    address.toLowerCase() === listing.creator.toLowerCase() &&
    !offer?.accepted &&
    !offer?.cancelled;

  // Role checks
  const isListingCreator =
    !!address &&
    !!listing &&
    address.toLowerCase() === listing.creator.toLowerCase();
  const isProposer =
    !!address &&
    !!offer &&
    address.toLowerCase() === offer.proposer.toLowerCase();

  const clientAddress = useMemo(() => {
    if (!offer || !listing) return null as string | null;
    // In BRIEF, client is listing.creator. In GIG, client is offer.proposer.
    return listing.listingType === 0 ? listing.creator : offer.proposer;
  }, [offer, listing]);

  const isClientWallet = useMemo(() => {
    if (!address || !clientAddress) return false;
    return address.toLowerCase() === clientAddress.toLowerCase();
  }, [address, clientAddress]);

  // NEW: derive provider address and check if current wallet is provider
  const providerAddress = useMemo(() => {
    if (!offer || !listing) return null as string | null;
    // In BRIEF, provider is offer.proposer. In GIG, provider is listing.creator.
    return listing.listingType === 0 ? offer.proposer : listing.creator;
  }, [offer, listing]);

  const isProviderWallet = useMemo(() => {
    if (!address || !providerAddress) return false;
    return address.toLowerCase() === providerAddress.toLowerCase();
  }, [address, providerAddress]);

  // UPDATED: allow validation for either participant if their respective validation is pending
  const canValidate =
    escrow &&
    ((isClientWallet && !escrow.clientValidated) ||
      (isProviderWallet && !escrow.providerValidated));
  const canDispute = escrow && escrow.status === EscrowStatus.IN_PROGRESS;

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const contract = getMarketplaceContract(chainId, provider);
        const offerId = BigInt(resolvedParams.id);

        // Fetch offer
        const offerData = await contract.getOffer(offerId);

        // Fetch related listing
        const listingData = await contract.getListing(offerData.listingId);

        // Try to fetch escrow if offer is accepted
        let escrowData: Escrow | null = null;
        if (offerData.accepted) {
          try {
            escrowData = await contract.getEscrow(offerId);
          } catch {}
        }

        // Fetch listing metadata via shared tolerant helper
        const listingMeta = await loadListingMetadataFromURI(
          listingData.metadataURI,
          listingData
        );

        // Token + fee context
        const dopAddr = await contract.getDopToken();
        const { feeDop, feeUsdLike } = await contract.getFees();
        const paymentToken = offerData.paymentToken as string;
        const itIsEth = paymentToken === ethers.ZeroAddress;
        setIsEth(itIsEth);

        let symbol = "ETH";
        let decimals = 18;
        if (!itIsEth) {
          try {
            const erc20 = contract.getErc20(paymentToken) as unknown as ERC20;
            const dec = await erc20.decimals();
            decimals = Number(dec);
            try {
              const sym = await erc20.symbol();
              symbol = String(sym);
            } catch {
              symbol = "TOKEN";
            }
          } catch {}
        }
        setTokenSymbol(symbol);
        setTokenDecimals(decimals);

        const bps =
          paymentToken.toLowerCase() === dopAddr.toLowerCase()
            ? feeDop
            : feeUsdLike;
        setFeeBps(bps);
        const fee = (offerData.amount * bps) / BigInt(10000);
        setEstFee(fee);
        setProviderPayout(offerData.amount - fee);

        // Allowance check for ERC20
        let allowanceVal = BigInt(0);
        let needs = false;
        if (!itIsEth && listingData && offerData && clientAddress) {
          try {
            const erc20 = contract.getErc20(paymentToken) as unknown as ERC20;
            const raw = await erc20.allowance(
              clientAddress,
              contract.contractAddress
            );
            allowanceVal = ethers.toBigInt(raw);
            needs = allowanceVal < offerData.amount;
          } catch {}
        }
        setAllowance(allowanceVal);
        setNeedsApproval(needs);

        setOffer(offerData);
        setEscrow(escrowData);
        setListing(listingData);
        setListingMetadata(listingMeta);

        // Reviews gating
        try {
          if (escrowData && address) {
            const finished = isEscrowFinished(escrowData);
            if (finished) {
              const reviewed = await contract.hasReviewed(offerId, address);
              setHasReviewed(reviewed);
              setCanReview(!reviewed);
            } else {
              setHasReviewed(false);
              setCanReview(false);
            }
          } else {
            setHasReviewed(false);
            setCanReview(false);
          }
        } catch {}
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load offer";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, provider, resolvedParams.id, address]);

  function isEscrowFinished(e: Escrow) {
    // Finished if both validated or if status is COMPLETED
    try {
      if (e.clientValidated && e.providerValidated) return true;
      return e.status === EscrowStatus.COMPLETED;
    } catch {
      return false;
    }
  }

  const refreshAllowance = async () => {
    if (!offer || !listing || !clientAddress || isEth) return;
    try {
      const contract = getMarketplaceContract(chainId, provider);
      const erc20 = contract.getErc20(
        offer.paymentToken as string
      ) as unknown as ERC20;
      const raw = await erc20.allowance(
        clientAddress,
        contract.contractAddress
      );
      const a = ethers.toBigInt(raw);
      setAllowance(a);
      setNeedsApproval(a < offer.amount);
    } catch {}
  };

  const handleApprove = async () => {
    if (!offer || !listing || !clientAddress || approving) return;
    if (!isClientWallet) {
      alert("Only the paying client can approve tokens.");
      return;
    }
    if (isEth) return;

    setApproving(true);
    try {
      // Use browser wallet for approval
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);
      const token = contract.getErc20(
        offer.paymentToken as string
      ) as unknown as ERC20;
      const tx = await token.approve(contract.contractAddress, offer.amount);
      await tx.wait();
      await refreshAllowance();
      alert(
        `Approved ${formatTokenAmount(
          offer.amount,
          offer.paymentToken as string,
          {
            tokens,
            decimals:
              knownDecimalsFor(offer.paymentToken as string, tokens) ??
              tokenDecimals,
          }
        )} ${
          tokenSymbolFor(offer.paymentToken as string, tokens) !== "Token"
            ? tokenSymbolFor(offer.paymentToken as string, tokens)
            : tokenSymbol
        }`
      );
    } catch (error: unknown) {
      console.error("Approve failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert("Approve failed: " + msg);
    } finally {
      setApproving(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!offer || !address || submitting || !listing) return;

    // For ERC20, ensure allowance present when client pays (BRIEF) or when client is proposer (GIG)
    if (!isEth && needsApproval) {
      // If user is provider on a GIG, the client must approve first.
      if (!isClientWallet) {
        alert("Client must approve token allowance before acceptance.");
        return;
      }
      // If user is client, prompt to approve first.
      alert("Please approve tokens before accepting.");
      return;
    }

    setSubmitting(true);
    try {
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);

      const value = isEth ? (offer.amount as bigint) : undefined;
      const tx = await contract.acceptOffer(offer.id, value);
      await tx.wait();

      window.location.reload();
    } catch (error: unknown) {
      console.error("Accept offer failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to accept offer: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateWork = async () => {
    if (!escrow || !address || submitting) return;

    setSubmitting(true);
    try {
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);
      await contract.validateWork(escrow.offerId);
      window.location.reload();
    } catch (error: unknown) {
      console.error("Validate work failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to validate work: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDispute = async () => {
    if (!escrow || !address || submitting) return;

    const reason = prompt("Please enter the reason for dispute:");
    if (!reason) return;

    setSubmitting(true);
    try {
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);
      await contract.openDispute(escrow.offerId);
      window.location.reload();
    } catch (error: unknown) {
      console.error("Open dispute failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to open dispute: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  async function handleLeaveReview() {
    if (!offer || !address || leavingReview) return;
    if (!canReview) return alert("Reviews available after escrow completion.");
    if (rating < 1 || rating > 5) return alert("Rating must be 1-5");

    setLeavingReview(true);
    try {
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);

      const reviewPayload = {
        type: "review",
        offerId: String(offer.id),
        rating,
        text: reviewText,
        author: address,
        timestamp: Date.now(),
      };
      const json = JSON.stringify(reviewPayload);
      const reviewURI = `data:application/json;base64,${btoa(json)}`;

      await contract.leaveReview(offer.id as bigint, rating, reviewURI);
      alert("Review submitted");
      window.location.reload();
    } catch (error: unknown) {
      console.error("Leave review failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to submit review: " + msg);
    } finally {
      setLeavingReview(false);
    }
  }

  const renderOfferActions = () => {
    if (!address) {
      return (
        <div className="text-center text-gray-400 p-4 border border-gray-800 rounded">
          Connect wallet to interact with this offer
        </div>
      );
    }

    const needsClientApprovalNotice =
      !isEth && needsApproval && !isClientWallet;

    return (
      <div className="space-y-3">
        {canAccept && (
          <>
            {!isEth && (
              <div className="p-3 rounded border border-gray-800 text-xs text-gray-300">
                Allowance:{" "}
                {formatTokenAmount(allowance, offer!.paymentToken as string, {
                  tokens,
                  decimals:
                    knownDecimalsFor(offer!.paymentToken as string, tokens) ??
                    tokenDecimals,
                })}{" "}
                {tokenSymbol}
                <br />
                Required:{" "}
                {formatTokenAmount(
                  offer!.amount,
                  offer!.paymentToken as string,
                  {
                    tokens,
                    decimals:
                      knownDecimalsFor(offer!.paymentToken as string, tokens) ??
                      tokenDecimals,
                  }
                )}{" "}
                {tokenSymbol}
              </div>
            )}

            {!isEth && isClientWallet && needsApproval && (
              <button
                onClick={handleApprove}
                disabled={approving}
                className="w-full px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 transition-colors"
              >
                {approving ? "Approving..." : `Approve ${tokenSymbol}`}
              </button>
            )}

            {needsClientApprovalNotice && (
              <div className="text-xs text-yellow-400 p-2 border border-yellow-900 rounded">
                Client must approve {tokenSymbol} allowance before acceptance.
              </div>
            )}

            <button
              onClick={handleAcceptOffer}
              disabled={submitting || (!isEth && needsApproval)}
              className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {submitting
                ? "Accepting..."
                : isEth
                ? `Accept Offer (send ${formatTokenAmount(
                    offer!.amount,
                    ethers.ZeroAddress,
                    { decimals: 18 }
                  )} ETH)`
                : "Accept Offer"}
            </button>
          </>
        )}

        {canValidate && (
          <button
            onClick={handleValidateWork}
            disabled={submitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Validating..." : "Validate Work"}
          </button>
        )}

        {canDispute && isClientWallet && (
          <button
            onClick={handleOpenDispute}
            disabled={submitting}
            className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Opening Dispute..." : "Open Dispute"}
          </button>
        )}

        {!isListingCreator && !isProposer && (
          <div className="text-center text-gray-400 p-4 border border-gray-800 rounded">
            You are not a party to this offer
          </div>
        )}
      </div>
    );
  };

  const renderEscrowProgress = () => {
    if (!escrow) return null;

    const steps = [
      { key: "created", label: "Offer Accepted", completed: true },
      {
        key: "active",
        label: "Escrow In Progress",
        completed: escrow.status >= EscrowStatus.IN_PROGRESS,
      },
      {
        key: "completed",
        label: "Completed",
        completed: escrow.status >= EscrowStatus.COMPLETED,
      },
    ];

    return (
      <div className="container-panel p-6">
        <h3 className="font-medium mb-4">Escrow Progress</h3>
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.key} className="flex items-center gap-3">
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  step.completed
                    ? "bg-green-600 border-green-600"
                    : "border-gray-600"
                }`}
              >
                {step.completed && (
                  <div className="w-2 h-2 bg-white rounded-full" />
                )}
              </div>
              <span
                className={`text-sm ${
                  step.completed ? "text-white" : "text-gray-400"
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-800 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Status:</span>
            <span className="text-white">
              {getEscrowStatusLabel(escrow.status)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Client Validated:</span>
            <span
              className={
                escrow.clientValidated ? "text-green-400" : "text-gray-400"
              }
            >
              {escrow.clientValidated ? "✓ Yes" : "✗ No"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Provider Validated:</span>
            <span
              className={
                escrow.providerValidated ? "text-green-400" : "text-gray-400"
              }
            >
              {escrow.providerValidated ? "✓ Yes" : "✗ No"}
            </span>
          </div>
          {escrow.disputeOutcome !== DisputeOutcome.NONE && (
            <div className="flex justify-between">
              <span className="text-gray-400">Dispute Outcome:</span>
              <span className="text-red-400">
                {getDisputeOutcomeLabel(escrow.disputeOutcome)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderReviews = () => {
    if (!offer) return null;
    const finished = escrow ? isEscrowFinished(escrow) : false;

    return (
      <div className="container-panel p-6">
        <h3 className="font-medium mb-4">Reviews</h3>
        {!finished && (
          <div className="text-sm text-gray-400">
            Reviews can be submitted after escrow completion.
          </div>
        )}

        {finished && address && (
          <div className="space-y-3">
            {hasReviewed ? (
              <div className="text-sm text-green-400">
                You have submitted a review for this mission.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Rating
                  </label>
                  <select
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded"
                  >
                    {[1, 2, 3, 4, 5].map((r) => (
                      <option key={r} value={r}>
                        {r} Star{r > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Feedback (optional)
                  </label>
                  <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    rows={3}
                    placeholder="Share your experience..."
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm"
                  />
                </div>
                <button
                  onClick={handleLeaveReview}
                  disabled={!canReview || leavingReview}
                  className="w-full px-4 py-2 bg-white text-black rounded hover:opacity-90 disabled:opacity-50"
                >
                  {leavingReview ? "Submitting..." : "Submit Review"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/offers" className="text-sm text-gray-400 hover:text-white">
          ← Back to Offers
        </Link>
      </div>

      {loading ? (
        <div className="container-panel p-6 animate-pulse space-y-4">
          <div className="h-8 w-1/2 bg-gray-900/60 rounded" />
          <div className="h-32 w-full bg-gray-900/60 rounded" />
          <div className="h-4 w-full bg-gray-900/60 rounded" />
        </div>
      ) : error ? (
        <div className="container-panel p-6 text-sm text-red-400">{error}</div>
      ) : offer && listing ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Offer Details */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                  Offer #{String(offer.id)}
                </span>
                <span
                  className={`text-[11px] rounded-full px-2 py-0.5 ${
                    offer.accepted
                      ? "border border-green-500/30 bg-green-400/20 text-green-300"
                      : offer.cancelled
                      ? "border border-red-500/30 bg-red-400/20 text-red-300"
                      : "border border-yellow-500/30 bg-yellow-400/20 text-yellow-300"
                  }`}
                >
                  {offer.accepted
                    ? "Accepted"
                    : offer.cancelled
                    ? "Cancelled"
                    : "Pending"}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {timeAgo(Number(offer.createdAt))}
                </span>
              </div>

              <div className="flex items-start gap-4 mb-4">
                {cover && (
                  <Image
                    src={cover}
                    alt={
                      listingMetadata?.title || `Listing #${String(listing.id)}`
                    }
                    width={96}
                    height={96}
                    className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded border border-gray-800 flex-shrink-0"
                    unoptimized
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                )}
                <h1 className="text-2xl font-semibold">
                  Offer for &quot;
                  {listingMetadata?.title ||
                    `Listing #${String(listing.id)}`}{" "}
                  &quot;
                </h1>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="font-medium mb-2">Offer Amount</h3>
                  <div className="text-2xl font-bold text-green-400">
                    {`${formatTokenAmount(
                      offer.amount,
                      offer.paymentToken as string,
                      {
                        tokens,
                        decimals:
                          knownDecimalsFor(
                            offer.paymentToken as string,
                            tokens
                          ) ?? (isEth ? 18 : tokenDecimals),
                      }
                    )} ${
                      tokenSymbolFor(offer.paymentToken as string, tokens) !==
                      "Token"
                        ? tokenSymbolFor(offer.paymentToken as string, tokens)
                        : tokenSymbol
                    }`}
                  </div>
                  <div className="text-sm text-gray-400">
                    Payment Token:{" "}
                    {isEth ? "ETH (native)" : formatAddress(offer.paymentToken)}
                  </div>

                  {/* Estimated fees before acceptance */}
                  {!offer.accepted && (
                    <div className="mt-3 text-sm text-gray-300 space-y-1">
                      <div className="flex justify-between">
                        <span>Estimated Fee ({Number(feeBps) / 100}%):</span>
                        <span className="text-white">
                          {`${formatTokenAmount(
                            estFee,
                            offer.paymentToken as string,
                            {
                              tokens,
                              decimals:
                                knownDecimalsFor(
                                  offer.paymentToken as string,
                                  tokens
                                ) ?? (isEth ? 18 : tokenDecimals),
                            }
                          )} ${
                            tokenSymbolFor(
                              offer.paymentToken as string,
                              tokens
                            ) !== "Token"
                              ? tokenSymbolFor(
                                  offer.paymentToken as string,
                                  tokens
                                )
                              : tokenSymbol
                          }`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Provider Receives:</span>
                        <span className="text-white">
                          {`${formatTokenAmount(
                            providerPayout,
                            offer.paymentToken as string,
                            {
                              tokens,
                              decimals:
                                knownDecimalsFor(
                                  offer.paymentToken as string,
                                  tokens
                                ) ?? (isEth ? 18 : tokenDecimals),
                            }
                          )} ${
                            tokenSymbolFor(
                              offer.paymentToken as string,
                              tokens
                            ) !== "Token"
                              ? tokenSymbolFor(
                                  offer.paymentToken as string,
                                  tokens
                                )
                              : tokenSymbol
                          }`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-medium mb-2">Parties</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-400">Listing Creator:</span>{" "}
                      {formatAddress(listing.creator)}
                      {isListingCreator && (
                        <span className="text-blue-400 ml-2">(You)</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-400">Offer Proposer:</span>{" "}
                      {formatAddress(offer.proposer)}
                      {isProposer && (
                        <span className="text-blue-400 ml-2">(You)</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-400">Client (pays):</span>{" "}
                      {clientAddress ? formatAddress(clientAddress) : "-"}
                      {isClientWallet && (
                        <span className="text-blue-400 ml-2">(You)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {listingMetadata?.description && (
                <div>
                  <h3 className="font-medium mb-2">Project Description</h3>
                  <p className="text-gray-300 whitespace-pre-wrap">
                    {listingMetadata.description}
                  </p>
                </div>
              )}
            </div>

            {/* Related Listing */}
            <div className="container-panel p-6">
              <h3 className="font-medium mb-3">Related Listing</h3>
              <div className="border border-gray-800 rounded p-4">
                <div className="flex gap-4">
                  {cover && (
                    <Image
                      src={cover}
                      alt={
                        listingMetadata?.title ||
                        `Listing #${String(listing.id)}`
                      }
                      width={64}
                      height={64}
                      className="w-16 h-16 object-cover rounded border border-gray-800 flex-shrink-0"
                      unoptimized
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">
                        {listingMetadata?.title ||
                          `Listing #${String(listing.id)}`}
                      </h4>
                      <span className="text-xs text-gray-400">
                        {listing.listingType === 0 ? "Brief" : "Gig"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-3">
                      {truncateText(
                        listingMetadata?.description ||
                          "No description available",
                        150
                      )}
                    </p>
                    <Link
                      href={`/${
                        listing.listingType === 0 ? "briefs" : "gigs"
                      }/${String(listing.id)}`}
                      className="text-sm text-blue-400 hover:underline"
                    >
                      View Full Listing →
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Escrow Progress */}
            {renderEscrowProgress()}

            {/* Reviews */}
            {renderReviews()}
          </div>

          <aside className="space-y-4">
            {/* Actions */}
            <div className="container-panel p-6">
              <h3 className="font-medium mb-4">Actions</h3>
              {renderOfferActions()}
            </div>

            {/* Escrow Details */}
            {escrow && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="font-medium">Escrow Details</h3>
                <div className="text-sm text-gray-400 space-y-2">
                  <div className="flex justify-between">
                    <span>Amount:</span>
                    <span className="text-white">
                      {`${formatTokenAmount(
                        escrow.amount,
                        offer!.paymentToken as string,
                        {
                          tokens,
                          decimals:
                            knownDecimalsFor(
                              offer!.paymentToken as string,
                              tokens
                            ) ?? (isEth ? 18 : tokenDecimals),
                        }
                      )} ${
                        tokenSymbolFor(
                          offer!.paymentToken as string,
                          tokens
                        ) !== "Token"
                          ? tokenSymbolFor(
                              offer!.paymentToken as string,
                              tokens
                            )
                          : tokenSymbol
                      }`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fee:</span>
                    <span className="text-white">
                      {`${formatTokenAmount(
                        escrow.feeAmount,
                        offer!.paymentToken as string,
                        {
                          tokens,
                          decimals:
                            knownDecimalsFor(
                              offer!.paymentToken as string,
                              tokens
                            ) ?? (isEth ? 18 : tokenDecimals),
                        }
                      )} ${
                        tokenSymbolFor(
                          offer!.paymentToken as string,
                          tokens
                        ) !== "Token"
                          ? tokenSymbolFor(
                              offer!.paymentToken as string,
                              tokens
                            )
                          : tokenSymbol
                      }`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className="text-white">
                      {getEscrowStatusLabel(escrow.status)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="container-panel p-6 space-y-3">
              <h3 className="font-medium">Timeline</h3>
              <div className="text-sm text-gray-400 space-y-2">
                <div>
                  <span className="text-gray-500">Offer Created:</span>{" "}
                  {timeAgo(Number(offer.createdAt))}
                </div>
                {listing && (
                  <div>
                    <span className="text-gray-500">Listing Created:</span>{" "}
                    {timeAgo(Number(listing.createdAt))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
