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
import { useToastContext } from "@/components/providers";
import { ConfirmModal } from "@/components/ConfirmModal";

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
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);

  // Confirmation modal state
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message?: React.ReactNode;
    action?: () => Promise<void>;
  }>({ open: false, title: "", message: undefined, action: undefined });
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

  // Dispute state
  const [disputeHeader, setDisputeHeader] = useState<{
    cid: string;
    openedBy: string;
    openedAt: bigint;
    appealsCount: bigint;
  } | null>(null);
  const [appeals, setAppeals] = useState<
    Array<{ by: string; cid: string; timestamp: bigint }>
  >([]);

  // Dispute form states
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeFiles, setDisputeFiles] = useState<File[]>([]);
  const [openingDispute, setOpeningDispute] = useState(false);

  // Appeal form states
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealFiles, setAppealFiles] = useState<File[]>([]);
  const [appealing, setAppealing] = useState(false);

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

        // Dispute header + appeals if disputed/resolved
        try {
          if (
            escrowData &&
            (escrowData.status === EscrowStatus.DISPUTED ||
              escrowData.status === EscrowStatus.RESOLVED)
          ) {
            const header = await contract.getDisputeHeader(offerId);
            setDisputeHeader(header);
            const allAppeals = await contract.getDisputeAppeals(offerId);
            setAppeals(allAppeals);
          } else {
            setDisputeHeader(null);
            setAppeals([]);
          }
        } catch {
          setDisputeHeader(null);
          setAppeals([]);
        }
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
      toast.showError(
        "Not Authorized",
        "Only the paying client can approve tokens."
      );
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
      toast.showSuccess(
        "Success",
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
      console.error("Token approval failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.showError("Approval Failed", "Failed to approve tokens: " + msg);
    } finally {
      setApproving(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!offer || !listing || !clientAddress || submitting) return;

    setSubmitting(true);
    try {
      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);

      // For ETH payments, just send the value with the transaction
      if (isEth) {
        const tx = await contract.acceptOffer(offer.id as bigint, offer.amount);
        await tx.wait();
        toast.showSuccess("Success", "Offer accepted");
        window.location.reload();
        return;
      }

      // For token payments, we need to ensure approval first
      if (needsApproval) {
        toast.showWarning(
          "Approval Required",
          "Token approval is required before accepting the offer."
        );
        return;
      }

      const tx = await contract.acceptOffer(offer.id as bigint);
      await tx.wait();
      toast.showSuccess("Success", "Offer accepted");
      window.location.reload();
    } catch (error: unknown) {
      console.error("Accept offer failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.showError("Error", "Failed to accept offer: " + msg);
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
      toast.showError("Error", "Failed to validate work: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOffer = async () => {
    if (!offer || !isProposer || submitting) return;

    setConfirm({
      open: true,
      title: "Cancel Offer",
      message: "Are you sure you want to cancel this offer?",
      action: async () => {
        setConfirm((c) => ({ ...c, open: false }));
        setSubmitting(true);
        try {
          const web3 = getBrowserProvider();
          const signer = await web3.getSigner();
          const contract = getMarketplaceContract(chainId, web3).connect(
            signer
          );
          const tx = await contract.cancelOffer(offer.id as bigint);
          await tx.wait();
          window.location.reload();
        } catch (error: unknown) {
          console.error("Cancel offer failed:", error);
          const msg = error instanceof Error ? error.message : "Unknown error";
          toast.showError("Error", "Failed to cancel offer: " + msg);
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  // Upload a single file to IPFS via our API route and return an ipfs:// URI
  async function uploadFileToIpfs(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/ipfs", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "IPFS upload failed");
    return `ipfs://${data.cid}`;
  }

  // Build and upload a dispute/appeal JSON payload. Returns raw CID (no ipfs://)
  async function uploadDisputeJson(
    payload: Record<string, unknown>
  ): Promise<string> {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const file = new File([blob], "dispute.json", { type: "application/json" });
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/ipfs", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Upload failed");
    return String(data.cid);
  }

  const handleOpenDispute = async () => {
    // Toggle the dispute form instead of opening immediately (CID flow)
    setShowDisputeForm((v) => !v);
  };

  async function handleSubmitDisputeWithCID() {
    if (!escrow || !offer || !address || openingDispute) return;
    if (!disputeReason.trim() && disputeFiles.length === 0) {
      setConfirm({
        open: true,
        title: "Submit Dispute",
        message: "Submit dispute without reason or attachments?",
        action: async () => {
          setConfirm((c) => ({ ...c, open: false }));
          await submitDispute();
        },
      });
      return;
    }
    await submitDispute();
  }

  async function submitDispute() {
    try {
      setOpeningDispute(true);
      // Upload attachments (optional)
      const attachmentUris: string[] = [];
      for (const file of disputeFiles) {
        try {
          const uri = await uploadFileToIpfs(file);
          attachmentUris.push(uri);
        } catch (e) {
          console.warn("Failed to upload an attachment:", e);
        }
      }

      const payload = {
        type: "dispute",
        offerId: String(offer!.id),
        listingId: String(offer!.listingId),
        author: address,
        role: isClientWallet ? "client" : "provider",
        reason: disputeReason,
        attachments: attachmentUris,
        createdAt: Date.now(),
      };
      const cid = await uploadDisputeJson(payload);

      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);
      await contract.openDisputeWithCID(escrow!.offerId, cid);
      toast.showSuccess("Success", "Dispute opened");
      window.location.reload();
    } catch (error: unknown) {
      console.error("Open dispute with CID failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.showError("Error", "Failed to open dispute: " + msg);
    } finally {
      setOpeningDispute(false);
    }
  }

  async function handleSubmitAppealWithCID() {
    if (!escrow || !offer || !address || appealing) return;
    if (!appealReason.trim() && appealFiles.length === 0) {
      setConfirm({
        open: true,
        title: "Submit Appeal",
        message: "Submit appeal without reason or attachments?",
        action: async () => {
          setConfirm((c) => ({ ...c, open: false }));
          await submitAppeal();
        },
      });
      return;
    }
    await submitAppeal();
  }

  async function submitAppeal() {
    try {
      setAppealing(true);
      const attachmentUris: string[] = [];
      for (const file of appealFiles) {
        try {
          const uri = await uploadFileToIpfs(file);
          attachmentUris.push(uri);
        } catch (e) {
          console.warn("Failed to upload an attachment:", e);
        }
      }

      const payload = {
        type: "appeal",
        offerId: String(offer!.id),
        listingId: String(offer!.listingId),
        author: address,
        role: isClientWallet ? "client" : "provider",
        reason: appealReason,
        attachments: attachmentUris,
        createdAt: Date.now(),
      };
      const cid = await uploadDisputeJson(payload);

      const web3 = getBrowserProvider();
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);
      await contract.appealDispute(escrow!.offerId, cid);
      toast.showSuccess("Success", "Appeal submitted");
      window.location.reload();
    } catch (error: unknown) {
      console.error("Appeal with CID failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.showError("Error", "Failed to submit appeal: " + msg);
    } finally {
      setAppealing(false);
    }
  }

  async function handleLeaveReview() {
    if (!offer || !address || leavingReview) return;
    if (!canReview) {
      toast.showWarning(
        "Not Available",
        "Reviews available after escrow completion."
      );
      return;
    }
    if (rating < 1 || rating > 5) {
      toast.showWarning("Invalid Rating", "Rating must be 1-5");
      return;
    }

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
      toast.showSuccess("Success", "Review submitted");
      window.location.reload();
    } catch (error: unknown) {
      console.error("Leave review failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.showError("Error", "Failed to submit review: " + msg);
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
        {/* Accept flow */}
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

        {/* Proposer-side cancel for pending offers */}
        {!offer?.accepted && !offer?.cancelled && isProposer && (
          <button
            onClick={handleCancelOffer}
            disabled={submitting}
            className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Cancelling..." : "Cancel Offer"}
          </button>
        )}

        {/* Validation during escrow */}
        {canValidate && (
          <button
            onClick={handleValidateWork}
            disabled={submitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Validating..." : "Validate Work"}
          </button>
        )}

        {/* Dispute / Refund */}
        {canDispute && isClientWallet && (
          <button
            onClick={handleOpenDispute}
            disabled={openingDispute}
            className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {openingDispute ? "Preparing..." : "Request Refund"}
          </button>
        )}
        {canDispute && !isClientWallet && isProviderWallet && (
          <button
            onClick={handleOpenDispute}
            disabled={openingDispute}
            className="w-full px-4 py-2 border border-red-500 text-red-400 rounded hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            {openingDispute ? "Preparing..." : "Open Dispute"}
          </button>
        )}

        {/* Dispute form (toggle) */}
        {showDisputeForm && (
          <div className="mt-3 rounded border border-red-900 p-3 bg-red-950/20">
            <div className="text-sm font-medium text-red-300 mb-2">
              Open Dispute
            </div>
            <label className="block text-xs text-gray-400 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              rows={3}
              placeholder={
                isClientWallet
                  ? "Describe why you request a refund..."
                  : "Describe the issue..."
              }
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm mb-3"
            />
            <label className="block text-xs text-gray-400 mb-1">
              Attachments (optional)
            </label>
            <input
              type="file"
              multiple
              onChange={(e) =>
                setDisputeFiles(Array.from(e.target.files || []))
              }
              className="w-full text-xs text-gray-300"
            />
            {disputeFiles.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {disputeFiles.length} file(s) selected
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmitDisputeWithCID}
                disabled={openingDispute}
                className="flex-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm"
              >
                {openingDispute ? "Submitting..." : "Submit Dispute"}
              </button>
              <button
                onClick={() => setShowDisputeForm(false)}
                className="px-3 py-2 border border-white/10 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Appeal form (toggle) */}
        {showAppealForm && (
          <div className="mt-3 rounded border border-yellow-900 p-3 bg-yellow-950/10">
            <div className="text-sm font-medium text-yellow-300 mb-2">
              Submit Appeal
            </div>
            <label className="block text-xs text-gray-400 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              rows={3}
              placeholder="Provide additional context/evidence..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm mb-3"
            />
            <label className="block text-xs text-gray-400 mb-1">
              Attachments (optional)
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => setAppealFiles(Array.from(e.target.files || []))}
              className="w-full text-xs text-gray-300"
            />
            {appealFiles.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {appealFiles.length} file(s) selected
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmitAppealWithCID}
                disabled={appealing}
                className="flex-1 px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 text-sm"
              >
                {appealing ? "Submitting..." : "Submit Appeal"}
              </button>
              <button
                onClick={() => setShowAppealForm(false)}
                className="px-3 py-2 border border-white/10 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
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

  const renderDisputeSection = () => {
    if (!escrow) return null;

    const showDetails =
      escrow.status === EscrowStatus.DISPUTED ||
      escrow.status === EscrowStatus.RESOLVED;

    if (!showDetails && !showAppealForm) return null;

    const canAppeal =
      showDetails &&
      !!address &&
      !!disputeHeader &&
      address.toLowerCase() !== disputeHeader.openedBy.toLowerCase() &&
      (isClientWallet || isProviderWallet) &&
      escrow.status === EscrowStatus.DISPUTED;

    return (
      <div className="container-panel p-6">
        <h3 className="font-medium mb-3">Dispute</h3>

        {showDetails && (
          <div className="rounded border border-white/10 p-3 text-sm">
            {disputeHeader ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-4 text-gray-300">
                  <span>
                    Opened By: {formatAddress(disputeHeader.openedBy)}
                  </span>
                  <span>
                    Opened At:{" "}
                    {new Date(
                      Number(disputeHeader.openedAt) * 1000
                    ).toLocaleString()}
                  </span>
                  {disputeHeader.cid && (
                    <span>
                      CID:{" "}
                      <a
                        className="underline decoration-dotted"
                        href={`https://ipfs.io/ipfs/${disputeHeader.cid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {disputeHeader.cid.slice(0, 18)}…
                      </a>
                    </span>
                  )}
                  <span>Appeals: {String(disputeHeader.appealsCount)}</span>
                </div>

                <div className="mt-3">
                  <div className="font-medium mb-1">Appeals</div>
                  {appeals.length === 0 ? (
                    <div className="text-xs text-gray-400">
                      No appeals recorded.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {appeals.map((a, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-white/10 p-2 text-xs text-gray-300"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <span>By: {formatAddress(a.by)}</span>
                            <span>
                              At:{" "}
                              {new Date(
                                Number(a.timestamp) * 1000
                              ).toLocaleString()}
                            </span>
                            <span>
                              CID:{" "}
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                Loading dispute details…
              </div>
            )}
          </div>
        )}

        {canAppeal && !showAppealForm && (
          <button
            onClick={() => setShowAppealForm(true)}
            className="mt-3 px-4 py-2 border border-yellow-600 text-yellow-300 rounded hover:bg-yellow-600/10 text-sm"
          >
            Appeal
          </button>
        )}

        {showAppealForm && (
          <div className="mt-3 rounded border border-yellow-900 p-3 bg-yellow-950/10">
            <div className="text-sm font-medium text-yellow-300 mb-2">
              Submit Appeal
            </div>
            <label className="block text-xs text-gray-400 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              rows={3}
              placeholder="Provide additional context/evidence..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm mb-3"
            />
            <label className="block text-xs text-gray-400 mb-1">
              Attachments (optional)
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => setAppealFiles(Array.from(e.target.files || []))}
              className="w-full text-xs text-gray-300"
            />
            {appealFiles.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {appealFiles.length} file(s) selected
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmitAppealWithCID}
                disabled={appealing}
                className="flex-1 px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 text-sm"
              >
                {appealing ? "Submitting..." : "Submit Appeal"}
              </button>
              <button
                onClick={() => setShowAppealForm(false)}
                className="px-3 py-2 border border-white/10 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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

            {/* Dispute Section */}
            {renderDisputeSection()}

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

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={() => confirm.action?.()}
        confirmText="Proceed"
        danger={true}
      />
    </div>
  );
}
