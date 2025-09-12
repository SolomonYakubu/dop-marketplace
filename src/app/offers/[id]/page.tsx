"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, useRef, use } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { getTokenAddresses } from "@/lib/contract";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
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
import {
  supabase,
  type OfferChatMessage,
  type OfferChatDocument,
} from "@/lib/supabaseClient";
import {
  ArrowLeft,
  CheckCircle2,
  Hourglass,
  Send as SendIcon,
  Paperclip,
  AlertTriangle,
  MessageSquare,
  RefreshCcw,
  Star as StarIcon,
  X as CloseIcon,
} from "lucide-react";

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
  const { contract } = useMarketplaceContract();
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

  // Chat state (single document model)
  const [chatMessages, setChatMessages] = useState<OfferChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // Actions panel always visible now (removed show/hide state)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showFees, setShowFees] = useState(false);

  // Helper: consistent token amount + symbol rendering
  const displayToken = (
    amount: bigint,
    tokenAddr: string,
    opts?: { fallbackSymbol?: string }
  ) => {
    return `${formatTokenAmount(amount, tokenAddr, {
      tokens,
      decimals:
        knownDecimalsFor(tokenAddr, tokens) ??
        (tokenAddr === ethers.ZeroAddress ? 18 : tokenDecimals),
    })} ${
      tokenSymbolFor(tokenAddr, tokens) !== "Token"
        ? tokenSymbolFor(tokenAddr, tokens)
        : opts?.fallbackSymbol || tokenSymbol
    }`;
  };

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
        const offerId = BigInt(resolvedParams.id);

        // Fetch offer
        const offerData = await contract!.getOffer(offerId);

        // Fetch related listing
        const listingData = await contract!.getListing(offerData.listingId);

        // Try to fetch escrow if offer is accepted
        let escrowData: Escrow | null = null;
        if (offerData.accepted) {
          try {
            escrowData = await contract!.getEscrow(offerId);
          } catch {}
        }

        // Fetch listing metadata via shared tolerant helper
        const listingMeta = await loadListingMetadataFromURI(
          listingData.metadataURI,
          listingData
        );

        // Token + fee context
        const dopAddr = await contract!.getDopToken();
        const { feeDop, feeUsdLike } = await contract!.getFees();
        const paymentToken = offerData.paymentToken as string;
        const itIsEth = paymentToken === ethers.ZeroAddress;
        setIsEth(itIsEth);

        let symbol = "ETH";
        let decimals = 18;
        if (!itIsEth) {
          try {
            const erc20 = contract!.getErc20(paymentToken) as unknown as ERC20;
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
            const erc20 = contract!.getErc20(paymentToken) as unknown as ERC20;
            const raw = await erc20.allowance(
              clientAddress,
              contract!.contractAddress
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
              const reviewed = await contract!.hasReviewed(offerId, address);
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
            const header = await contract!.getDisputeHeader(offerId);
            setDisputeHeader(header);
            const allAppeals = await contract!.getDisputeAppeals(offerId);
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

  // Chat: load + realtime subscription (document model - listen for UPDATE)
  useEffect(() => {
    if (!resolvedParams?.id) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const offerIdStr = resolvedParams.id;
    let mounted = true;
    // helper fetch
    const fetchDoc = async () => {
      try {
        const { data } = await supabase
          .from("offer_chats")
          .select("offer_id,messages,updated_at")
          .eq("offer_id", offerIdStr)
          .maybeSingle();
        if (!mounted) return;
        if (data) {
          const doc = data as OfferChatDocument;
          setChatMessages(Array.isArray(doc.messages) ? doc.messages : []);
        }
      } catch {}
    };
    async function loadDoc() {
      setChatLoading(true);
      try {
        const { data, error } = await supabase
          .from("offer_chats")
          .select("offer_id,messages,updated_at")
          .eq("offer_id", offerIdStr)
          .maybeSingle();
        if (!mounted) return;
        if (!error && data) {
          const doc = data as OfferChatDocument;
          setChatMessages(Array.isArray(doc.messages) ? doc.messages : []);
        } else {
          setChatMessages([]);
        }
      } catch (e) {
        if (mounted) console.warn("Chat load failed", e);
      } finally {
        if (mounted) setChatLoading(false);
      }
    }
    loadDoc();

    channel = supabase
      .channel(`offer_chat_doc_${offerIdStr}`)
      .on(
        "postgres_changes",
        {
          schema: "public",
          table: "offer_chats",
          event: "*",
          filter: `offer_id=eq.${offerIdStr}`,
        },
        (payload) => {
          const newDoc = payload.new as OfferChatDocument;
          setChatMessages(
            Array.isArray(newDoc.messages) ? newDoc.messages : []
          );
        }
      )
      .subscribe();

    // Fallback polling every 6s in case realtime missed (network blocks, etc.)
    pollRef.current = setInterval(fetchDoc, 6000);
    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [resolvedParams.id]);

  // Auto scroll to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  const canUseChat = !!address && (isListingCreator || isProposer);

  async function handleSendChat() {
    if (!canUseChat) return;
    const text = chatInput.trim();
    if (!text && chatFiles.length === 0) return;
    if (chatSending) return;
    setChatSending(true);
    try {
      // Upload attachments first (if any)
      const attachmentUris: string[] = [];
      for (const file of chatFiles) {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/ipfs", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Upload failed");
          attachmentUris.push(`ipfs://${data.cid}`);
        } catch (err) {
          console.warn("Attachment upload failed", err);
        }
      }
      const message: OfferChatMessage = {
        id: crypto.randomUUID(),
        sender: address!.toLowerCase(),
        content: text || undefined,
        attachments: attachmentUris.length ? attachmentUris : undefined,
        created_at: new Date().toISOString(),
        message_type:
          attachmentUris.length && text
            ? "mixed"
            : attachmentUris.length
            ? "image"
            : "text",
      };

      // Optimistic update
      setChatMessages((cur) => [...cur, message]);

      // Prefer RPC append to avoid race conditions
      const { error: rpcError } = await supabase.rpc(
        "append_offer_chat_message",
        {
          p_offer_id: resolvedParams.id,
          // Supabase JS expects raw json serializable; cast via unknown to bypass any rule.
          p_message: message as unknown as Record<string, unknown>,
        }
      );
      if (rpcError) {
        // Fallback: manual upsert (read-modify-write). Last-write-wins.
        console.warn("RPC append failed, falling back", rpcError);
        const { data } = await supabase
          .from("offer_chats")
          .select("messages")
          .eq("offer_id", resolvedParams.id)
          .maybeSingle();
        let msgs: OfferChatMessage[] = [];
        if (data && Array.isArray(data.messages))
          msgs = data.messages as OfferChatMessage[];
        msgs = [...msgs, message];
        const { error: upError } = await supabase
          .from("offer_chats")
          .upsert({ offer_id: resolvedParams.id, messages: msgs });
        if (upError) throw upError;
      }
      setChatInput("");
      setChatFiles([]);
    } catch (e) {
      console.error("Send chat failed", e);
      toast.showError("Chat", "Failed to send message");
    } finally {
      setChatSending(false);
    }
  }

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
      const erc20 = contract!.getErc20(
        offer.paymentToken as string
      ) as unknown as ERC20;
      const raw = await erc20.allowance(
        clientAddress,
        contract!.contractAddress
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
      const token = contract!.getErc20(
        offer.paymentToken as string
      ) as unknown as ERC20;
      const tx = await token.approve(contract!.contractAddress, offer.amount);
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
      // For ETH payments, just send the value with the transaction
      if (isEth) {
        const tx = await contract!.acceptOffer(
          offer.id as bigint,
          offer.amount
        );
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

      const tx = await contract!.acceptOffer(offer.id as bigint);
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
      await contract!.validateWork(escrow.offerId);
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
          const tx = await contract!.cancelOffer(offer.id as bigint);
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

      await contract!.openDisputeWithCID(escrow!.offerId, cid);
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

      await contract!.appealDispute(escrow!.offerId, cid);
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

      await contract!.leaveReview(offer.id as bigint, rating, reviewURI);
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
        <div className="text-center text-gray-400 p-3 border border-gray-800 rounded text-xs">
          Connect wallet to interact
        </div>
      );
    }

    const needsClientApprovalNotice =
      !isEth && needsApproval && !isClientWallet;

    return (
      <div className="space-y-4">
        {/* Acceptance */}
        {canAccept && (
          <div className="space-y-2">
            {!isEth && (
              <div className="p-3 rounded border border-gray-800 bg-gray-900/40 text-[11px] text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Allowance</span>
                  <span className="text-white">
                    {displayToken(allowance, offer!.paymentToken as string)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Required</span>
                  <span className="text-white">
                    {displayToken(offer!.amount, offer!.paymentToken as string)}
                  </span>
                </div>
              </div>
            )}
            {!isEth && isClientWallet && needsApproval && (
              <button
                onClick={handleApprove}
                disabled={approving}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {approving && <RefreshCcw className="w-4 h-4 animate-spin" />}{" "}
                {approving ? "Approving" : `Approve ${tokenSymbol}`}
              </button>
            )}
            {needsClientApprovalNotice && (
              <div className="text-xs text-yellow-400 p-2 border border-yellow-900 rounded flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Client must approve{" "}
                {tokenSymbol}
              </div>
            )}
            <button
              onClick={handleAcceptOffer}
              disabled={submitting || (!isEth && needsApproval)}
              className="w-full flex items-center justify-center gap-2 rounded bg-green-600 hover:bg-green-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting && <RefreshCcw className="w-4 h-4 animate-spin" />}
              {submitting
                ? "Accepting..."
                : isEth
                ? `Accept & Send ${displayToken(
                    offer!.amount,
                    ethers.ZeroAddress
                  )}`
                : "Accept Offer"}
            </button>
          </div>
        )}

        {/* Accept flow */}
        {/* Escrow management */}
        <div className="space-y-2 pt-2 border-t border-gray-800">
          {!offer?.accepted && !offer?.cancelled && isProposer && (
            <button
              onClick={handleCancelOffer}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting && <RefreshCcw className="w-4 h-4 animate-spin" />}
              {submitting ? "Cancelling..." : "Cancel Offer"}
            </button>
          )}
          {canValidate && (
            <button
              onClick={handleValidateWork}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting && <RefreshCcw className="w-4 h-4 animate-spin" />}
              {submitting ? "Validating..." : "Validate Work"}
            </button>
          )}
        </div>

        {/* Disputes */}
        {(canDispute || showDisputeForm || showAppealForm) && (
          <div className="space-y-2 pt-2 border-t border-gray-800">
            {canDispute && isClientWallet && (
              <button
                onClick={handleOpenDispute}
                disabled={openingDispute}
                className="w-full flex items-center justify-center gap-2 rounded bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {openingDispute && (
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                )}
                {openingDispute ? "Preparing..." : "Request Refund"}
              </button>
            )}
            {canDispute && !isClientWallet && isProviderWallet && (
              <button
                onClick={handleOpenDispute}
                disabled={openingDispute}
                className="w-full flex items-center justify-center gap-2 rounded border border-red-500 text-red-400 hover:bg-red-500/10 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {openingDispute && (
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                )}
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
                  onChange={(e) =>
                    setAppealFiles(Array.from(e.target.files || []))
                  }
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
        )}

        {!isListingCreator && !isProposer && (
          <div className="text-center text-gray-400 p-3 border border-gray-800 rounded text-xs">
            Not a party to this offer
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
      <div className="container-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {steps.map((s) => (
            <span
              key={s.key}
              className={`px-2 py-0.5 rounded-full border ${
                s.completed
                  ? "bg-green-500/15 border-green-500/30 text-green-300"
                  : "border-gray-700 text-gray-500"
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            {escrow.status === EscrowStatus.COMPLETED && (
              <CheckCircle2 className="w-3 h-3 text-green-400" />
            )}
            {escrow.status === EscrowStatus.IN_PROGRESS && (
              <Hourglass className="w-3 h-3 text-yellow-400" />
            )}
            {escrow.status === EscrowStatus.DISPUTED && (
              <AlertTriangle className="w-3 h-3 text-red-400" />
            )}
            {getEscrowStatusLabel(escrow.status)}
          </span>
          <span>Client {escrow.clientValidated ? "✓" : "–"}</span>
          <span>Provider {escrow.providerValidated ? "✓" : "–"}</span>
          {escrow.disputeOutcome !== DisputeOutcome.NONE && (
            <span className="text-red-400">
              {getDisputeOutcomeLabel(escrow.disputeOutcome)}
            </span>
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
      <div className="container-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <StarIcon className="w-4 h-4 text-yellow-400" />
          <h3 className="font-medium text-sm">Reviews</h3>
        </div>
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
                <div className="space-y-1">
                  <label className="block text-sm text-gray-300">Rating</label>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, idx) => {
                      const val = idx + 1;
                      const active = rating >= val;
                      return (
                        <button
                          type="button"
                          key={val}
                          onClick={() => setRating(val)}
                          className="p-1"
                          aria-label={`Set rating ${val}`}
                        >
                          <StarIcon
                            className={`w-5 h-5 ${
                              active
                                ? "text-yellow-400 fill-yellow-400"
                                : "text-gray-600"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
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
                  className="w-full px-4 py-2 bg-white text-black rounded hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium"
                >
                  {leavingReview && (
                    <RefreshCcw className="w-4 h-4 animate-spin" />
                  )}
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
        <Link
          href="/offers"
          className="group inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back
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
            {/* Offer Details (clean, minimal) */}
            <div className="container-panel p-6">
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
                <div className="flex-1 min-w-0 space-y-1">
                  <h1 className="text-xl font-semibold tracking-tight">
                    {listingMetadata?.title || `Listing #${String(listing.id)}`}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-green-400 font-medium text-sm">
                      {displayToken(offer.amount, offer.paymentToken as string)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        offer.accepted
                          ? "bg-green-500/15 text-green-300"
                          : offer.cancelled
                          ? "bg-red-500/15 text-red-300"
                          : "bg-yellow-500/15 text-yellow-300"
                      }`}
                    >
                      {offer.accepted
                        ? "Accepted"
                        : offer.cancelled
                        ? "Cancelled"
                        : "Pending"}
                    </span>
                    <span className="text-gray-500">
                      {timeAgo(Number(offer.createdAt))}
                    </span>
                    <span className="text-gray-700">•</span>
                    <button
                      onClick={() => setShowFees((v) => !v)}
                      className="underline decoration-dotted text-gray-400 hover:text-gray-200"
                    >
                      {showFees ? "Hide fees" : "Fees"}
                    </button>
                    <button
                      onClick={() => setShowParticipants((v) => !v)}
                      className="underline decoration-dotted text-gray-400 hover:text-gray-200"
                    >
                      {showParticipants ? "Hide participants" : "Participants"}
                    </button>
                    <button
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="underline decoration-dotted text-gray-400 hover:text-gray-200"
                    >
                      {showAdvanced ? "Hide desc" : "Description"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                {showFees && !offer.accepted && (
                  <div className="rounded border border-gray-800 p-3 text-xs space-y-1 bg-gray-900/40">
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        Fee ({Number(feeBps) / 100}%)
                      </span>
                      <span className="text-white">
                        {displayToken(estFee, offer.paymentToken as string)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Provider Receives</span>
                      <span className="text-white">
                        {displayToken(
                          providerPayout,
                          offer.paymentToken as string
                        )}
                      </span>
                    </div>
                  </div>
                )}
                {showParticipants && (
                  <div className="rounded border border-gray-800 p-3 text-xs space-y-1 bg-gray-900/40">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Listing Creator</span>
                      <span className="text-white">
                        {formatAddress(listing.creator)}
                        {isListingCreator && " • you"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Proposer</span>
                      <span className="text-white">
                        {formatAddress(offer.proposer)}
                        {isProposer && " • you"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Client</span>
                      <span className="text-white">
                        {clientAddress ? formatAddress(clientAddress) : "-"}
                        {isClientWallet && " • you"}
                      </span>
                    </div>
                  </div>
                )}
                {showAdvanced && listingMetadata?.description && (
                  <div className="rounded border border-gray-800 p-3 bg-gray-900/40 text-sm text-gray-300 whitespace-pre-wrap">
                    {listingMetadata.description}
                  </div>
                )}
              </div>
            </div>

            {/* Chat (participants only) - JSON document model */}
            <div className="container-panel p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                <h3 className="font-medium text-sm">Chat</h3>
              </div>
              {!canUseChat && (
                <div className="text-sm text-gray-400 mb-2">
                  Only offer participants may chat.
                </div>
              )}
              <div className="h-64 overflow-y-auto border border-gray-800 rounded p-3 space-y-2 text-xs bg-black/30 thin-blue-scrollbar">
                {chatLoading && (
                  <div className="text-gray-500 text-center mt-4 text-xs">
                    Loading…
                  </div>
                )}
                {!chatLoading && chatMessages.length === 0 && (
                  <div className="text-gray-500 text-center mt-8">
                    No messages yet.
                  </div>
                )}
                {chatMessages.map((m) => {
                  const mine = address && m.sender === address.toLowerCase();
                  const hasAttachments =
                    m.attachments && m.attachments.length > 0;
                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        mine ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words shadow-sm ${
                          mine
                            ? "bg-blue-600 text-white"
                            : "bg-gray-800 text-gray-100"
                        }`}
                      >
                        {!mine && (
                          <div className="text-[9px] opacity-60 mb-0.5 font-medium">
                            {m.sender.slice(0, 6)}…{m.sender.slice(-4)}
                          </div>
                        )}
                        {m.content && (
                          <div className="leading-relaxed">{m.content}</div>
                        )}
                        {hasAttachments && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {m.attachments!.map((uri, idx) => {
                              const gateway = uri.startsWith("ipfs://")
                                ? `https://ipfs.io/ipfs/${uri.replace(
                                    "ipfs://",
                                    ""
                                  )}`
                                : uri;
                              const linkId = `${m.id}-att-${idx}`;
                              return (
                                <div key={uri} className="relative">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={gateway}
                                    alt="attachment"
                                    className="h-16 w-16 object-cover rounded border border-white/10 cursor-pointer hover:opacity-90 transition"
                                    onClick={() => setPreviewImage(gateway)}
                                    onError={(e) => {
                                      const img =
                                        e.currentTarget as HTMLImageElement;
                                      img.style.display = "none";
                                      const a = document.getElementById(linkId);
                                      if (a) a.classList.remove("hidden");
                                    }}
                                  />
                                  <a
                                    id={linkId}
                                    href={gateway}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hidden underline break-all text-[10px]"
                                  >
                                    {uri}
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="mt-1 text-[9px] opacity-60 text-right">
                          {new Date(m.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              {canUseChat && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChat();
                  }}
                  className="mt-3 space-y-2"
                >
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 flex items-center gap-1 rounded border border-gray-800 bg-gray-900/60 px-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-transparent outline-none py-2 text-sm"
                        maxLength={4000}
                      />
                      <input
                        id="chat-file-input"
                        type="file"
                        multiple
                        onChange={(e) =>
                          setChatFiles(Array.from(e.target.files || []))
                        }
                        className="hidden"
                        accept="image/*"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          document.getElementById("chat-file-input")?.click()
                        }
                        className="text-gray-400 hover:text-white p-1"
                        aria-label="Attach images"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <button
                        type="submit"
                        disabled={
                          chatSending ||
                          (!chatInput.trim() && chatFiles.length === 0)
                        }
                        className="text-blue-400 hover:text-blue-300 disabled:opacity-50 p-1"
                        aria-label="Send message"
                      >
                        {chatSending ? (
                          <RefreshCcw className="w-4 h-4 animate-spin" />
                        ) : (
                          <SendIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {chatFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                      {chatFiles.slice(0, 4).map((f) => (
                        <span
                          key={f.name}
                          className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700"
                        >
                          {f.name.slice(0, 12)}
                        </span>
                      ))}
                      {chatFiles.length > 4 && (
                        <span className="text-gray-500">
                          +{chatFiles.length - 4} more
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setChatFiles([])}
                        className="px-2 py-0.5 rounded border border-gray-700 hover:bg-gray-800"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>

            {/* Escrow Progress */}
            {renderEscrowProgress()}

            {/* Dispute Section */}
            {renderDisputeSection()}

            {/* Reviews */}
            {renderReviews()}
          </div>

          <aside className="space-y-4 lg:sticky top-4 h-fit">
            <div className="container-panel p-4 space-y-3">
              <h3 className="font-medium text-sm">Actions</h3>
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

      {/* Image Preview Lightbox */}
      {/* Related Listing now at bottom for lower priority */}
      {offer && listing && (
        <div className="container-panel p-4">
          <h3 className="font-medium mb-3">Related Listing</h3>
          <div className="border border-gray-800 rounded p-4">
            <div className="flex gap-4">
              {cover && (
                <Image
                  src={cover}
                  alt={
                    listingMetadata?.title || `Listing #${String(listing.id)}`
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
                    {listingMetadata?.title || `Listing #${String(listing.id)}`}
                  </h4>
                  <span className="text-xs text-gray-400">
                    {listing.listingType === 0 ? "Brief" : "Gig"}
                  </span>
                </div>
                <p className="text-xs text-gray-300 mb-3">
                  {truncateText(
                    listingMetadata?.description || "No description available",
                    120
                  )}
                </p>
                <Link
                  href={`/${
                    listing.listingType === 0 ? "briefs" : "gigs"
                  }/${String(listing.id)}`}
                  className="text-xs text-blue-400 hover:underline"
                >
                  View Full Listing →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-3xl max-h-full rounded border border-white/10 bg-black/60 backdrop-blur-sm p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage}
              alt="preview"
              className="max-h-[70vh] max-w-full object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 bg-white text-black rounded-full w-7 h-7 flex items-center justify-center shadow"
              aria-label="Close preview"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
