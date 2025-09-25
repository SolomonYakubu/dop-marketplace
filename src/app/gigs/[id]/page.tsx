"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, use } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { getTokenAddresses } from "@/lib/contract";
import type {
  Listing,
  OnchainUserProfile,
  Review,
  ProfileMetadata,
  ListingMetadata,
  Offer,
  Escrow,
} from "@/types/marketplace";
import {
  toGatewayUrl,
  formatAddress,
  truncateText,
  timeAgo,
  loadListingMetadataFromURI,
  getCategoryLabel,
  asRecord,
  asString,
  asStringArray,
  asNumber,
  knownDecimalsFor,
} from "@/lib/utils";
import { useToast, useAsyncOperation } from "@/hooks/useErrorHandling";
import { ToastContainer } from "@/components/Toast";
import { LoadingButton } from "@/components/Loading";
import { EscrowStatus } from "@/types/marketplace";
import { createReceiptNotifier } from "@/lib/txReceipt";
import {
  Sparkles,
  Tag as TagIcon,
  Star,
  Clock3,
  Package,
  FileText,
  User2,
  ArrowLeft,
  Loader2,
  UserCircle2,
} from "lucide-react";
import { ConfirmModal } from "@/components/ConfirmModal";

// Types for UI state
type PortfolioItem = { image?: string; title?: string; description?: string };
type ServicePackage = {
  name?: string;
  price?: string | number;
  currency?: string;
  description?: string;
  deliveryTime?: string;
  revisions?: number;
  includes?: string[];
};

type GigUIState = Listing & {
  title: string;
  description: string;
  cover: string | null;
  categoryLabel: string;
  isBoosted: boolean;
  createdAgo: string;
  skills: string[];
  price?: string | number;
  tokenSymbol?: string;
  rateUnit?: string;
  deliveryTime?: string;
  portfolio: PortfolioItem[];
  packages: ServicePackage[];
  metadata: ListingMetadata | undefined;
  primaryLink: string | null;
  metadataLink: string | null;
};

type ReviewWithTimestamp = Review & { timestamp?: bigint | number | string };

// Minimal ERC20 for allowance/approve
interface Erc20 {
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(
    spender: string,
    amount: bigint
  ): Promise<{ wait?: () => Promise<unknown> } & object>;
}

export default function GigDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const { contract } = useMarketplaceContract();
  const { address, chain } = useAccount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<GigUIState | null>(null);
  const [profile, setProfile] = useState<OnchainUserProfile | null>(null);
  const [profileMetadata, setProfileMetadata] =
    useState<Partial<ProfileMetadata> | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({
    description: "",
    timeline: "",
    budget: "",
    token: "ETH",
  });

  const [avgRating, setAvgRating] = useState<number | null>(null);
  // Reviews pagination state
  const [rawReviews, setRawReviews] = useState<ReviewWithTimestamp[]>([]);
  const [parsedReviews, setParsedReviews] = useState<
    Array<{
      rating: number;
      reviewer: string;
      text?: string;
      timestamp?: number;
    }>
  >([]);
  const [reviewsLoadingMore, setReviewsLoadingMore] = useState(false);
  const reviewsPageSize = 3;

  // NEW: track current user's most recent offer on this gig
  const [myOffer, setMyOffer] = useState<Offer | null>(null);
  const [myEscrow, setMyEscrow] = useState<Escrow | null>(null);
  const [offerActionLoading, setOfferActionLoading] = useState<
    null | "cancel" | "dispute"
  >(null);

  const toast = useToast();
  const { loading: submitting, execute } = useAsyncOperation();
  const notifyReceipt = useMemo(
    () => createReceiptNotifier(toast, { chain }),
    [toast, chain]
  );

  // Confirmation modal state
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message?: React.ReactNode;
    action?: () => Promise<void>;
  }>({ open: false, title: "", message: undefined, action: undefined });

  const chainId = chain?.id ?? 11124;
  const tokenAddresses = useMemo(() => getTokenAddresses(chainId), [chainId]);

  // Dynamic boost pricing state (listing-level)
  const [boostPrice, setBoostPrice] = useState<bigint | null>(null);
  const [boostDurationDays, setBoostDurationDays] = useState<number | null>(
    null
  );

  // Normalize profile skills to avoid undefined access
  const profileSkills = useMemo(
    () => (Array.isArray(profile?.skills) ? (profile!.skills as string[]) : []),
    [profile]
  );

  const isOwner =
    address &&
    state?.creator &&
    address.toLowerCase() === state.creator.toLowerCase();

  // Helper to parse a single review item (lazy enrichment)
  const parseReviewItem = async (r: ReviewWithTimestamp) => {
    let text: string | undefined = undefined;
    const uri: string = r.reviewURI;
    try {
      if (uri && uri.startsWith("data:")) {
        const [, rest] = uri.split(",");
        if (rest) {
          const jsonStr = atob(rest);
          const obj = JSON.parse(jsonStr) as unknown;
          const rec =
            obj && typeof obj === "object"
              ? (obj as Record<string, unknown>)
              : undefined;
          text =
            (rec?.["text"] as string) ||
            (rec?.["comment"] as string) ||
            (rec?.["review"] as string) ||
            undefined;
        }
      } else if (uri) {
        const url = toGatewayUrl(uri) || uri;
        const res = await fetch(url);
        const t = await res.text();
        try {
          const obj = JSON.parse(t) as unknown;
          const rec =
            obj && typeof obj === "object"
              ? (obj as Record<string, unknown>)
              : undefined;
          text =
            (rec?.["text"] as string) ||
            (rec?.["comment"] as string) ||
            (rec?.["review"] as string) ||
            t;
        } catch {
          text = t;
        }
      }
    } catch {}
    return {
      rating: Number(r.rating || 0),
      reviewer: r.reviewer as string,
      text,
      timestamp: r.timestamp != null ? Number(r.timestamp) : undefined,
    };
  };

  const hasMoreReviews = parsedReviews.length < rawReviews.length;

  const loadMoreReviews = async () => {
    if (reviewsLoadingMore || !rawReviews.length) return;
    setReviewsLoadingMore(true);
    try {
      const start = parsedReviews.length;
      const end = Math.min(rawReviews.length, start + reviewsPageSize);
      const slice = rawReviews.slice(start, end);
      const parsed = await Promise.all(slice.map((r) => parseReviewItem(r)));
      setParsedReviews((prev) => [...prev, ...parsed]);
    } catch {
    } finally {
      setReviewsLoadingMore(false);
    }
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const id = BigInt(resolvedParams.id);
        const l: Listing = await contract!.getListing(id);

        // Fetch metadata from IPFS using shared helper
        let meta: ListingMetadata | undefined = undefined;
        let cover: string | null = null;
        try {
          meta = await loadListingMetadataFromURI(l.metadataURI, l);
          cover = toGatewayUrl(meta?.image || null);
        } catch {}

        // Fetch creator profile (always attempt; use joinedAt>0 to validate)
        let creatorProfile: OnchainUserProfile | null = null;
        let creatorProfileMeta: Partial<ProfileMetadata> | null = null;
        try {
          const prof = (await contract!.getProfile(
            l.creator
          )) as OnchainUserProfile;
          if (prof && prof.joinedAt && prof.joinedAt !== BigInt(0)) {
            const normalized: OnchainUserProfile = {
              ...prof,
              skills: Array.isArray(prof.skills) ? prof.skills : [],
              portfolioURIs: Array.isArray(prof.portfolioURIs)
                ? prof.portfolioURIs
                : [],
            };
            creatorProfile = normalized;
            if (normalized.portfolioURIs.length > 0) {
              try {
                const metaUrl = toGatewayUrl(normalized.portfolioURIs[0]);
                if (metaUrl) {
                  const res = await fetch(metaUrl);
                  const text = await res.text();
                  try {
                    const parsed = JSON.parse(text) as Partial<ProfileMetadata>;
                    creatorProfileMeta = parsed || null;
                  } catch {}
                }
              } catch {}
            }
          }
        } catch {}

        // Fetch rating + all reviews for the creator (lazy-parse in chunks)
        try {
          const rating = await contract!.getAverageRating(l.creator);
          setAvgRating(Number(rating));
          const rlist = (await contract!.getReviews(
            l.creator
          )) as ReviewWithTimestamp[];
          const ordered = (rlist || []).slice().reverse(); // newest first
          setRawReviews(ordered);
          // Preload first page
          const initialSlice = ordered.slice(0, reviewsPageSize);
          const initialParsed = await Promise.all(
            initialSlice.map((r) => parseReviewItem(r))
          );
          setParsedReviews(initialParsed);
        } catch {}

        const categoryLabel = getCategoryLabel(Number(l.category));
        const isBoosted =
          Number(l.boostExpiry) >= Math.floor(Date.now() / 1000);
        const createdAgo = timeAgo(Number(l.createdAt));

        const metaRec = asRecord(meta);
        const title = meta?.title || `Gig #${resolvedParams.id}`;
        const description =
          asString(metaRec?.shortDescription) ||
          asString(metaRec?.summary) ||
          meta?.description ||
          "No description provided.";

        const skills =
          meta?.requirements ||
          asStringArray(metaRec?.skills) ||
          asStringArray(metaRec?.tags) ||
          [];

        const price: string | number | undefined =
          asNumber(metaRec?.price) ??
          asNumber(metaRec?.amount) ??
          asString(metaRec?.price) ??
          asString(metaRec?.amount) ??
          undefined;
        const tokenSymbol =
          asString(metaRec?.tokenSymbol) ||
          asString(metaRec?.currency) ||
          asString(metaRec?.token) ||
          undefined;
        const rateUnit =
          asString(metaRec?.rateUnit) ||
          asString(metaRec?.rate) ||
          asString(metaRec?.unit) ||
          undefined;
        const deliveryTime =
          asString(metaRec?.deliveryTime) ||
          meta?.timeline ||
          asString(metaRec?.duration);

        const portfolio: PortfolioItem[] = Array.isArray(metaRec?.portfolio)
          ? (metaRec!.portfolio as unknown[])
              .map((p) => asRecord(p))
              .filter(Boolean)
              .map((r) => {
                const rec = r as Record<string, unknown>;
                return {
                  image: asString(rec.image),
                  title: asString(rec.title),
                  description: asString(rec.description),
                };
              })
          : [];

        const packages: ServicePackage[] = Array.isArray(metaRec?.packages)
          ? (metaRec!.packages as unknown[])
              .map((p) => asRecord(p))
              .filter(Boolean)
              .map((r) => {
                const rec = r as Record<string, unknown>;
                return {
                  name: asString(rec.name),
                  price:
                    asNumber(rec.price) ?? asString(rec.price) ?? undefined,
                  currency: asString(rec.currency) || tokenSymbol || "ETH",
                  description: asString(rec.description),
                  deliveryTime: asString(rec.deliveryTime),
                  revisions: asNumber(rec.revisions),
                  includes: asStringArray(rec.includes) || [],
                } as ServicePackage;
              })
          : [];

        // Derive a primary file/attachment URL if present (type-safe)
        const candidateKeys = [
          "file",
          "attachment",
          "attachmentUrl",
          "attachmentURI",
          "contentUrl",
          "external_url",
          "url",
          "link",
          "website",
        ];

        let primaryLinkRaw: string | null = null;
        if (metaRec) {
          // Check known string fields
          for (const k of candidateKeys) {
            const v = asString(metaRec[k]);
            if (v) {
              primaryLinkRaw = v;
              break;
            }
          }
          // Check files array for first string entry
          if (!primaryLinkRaw) {
            const filesVal = metaRec["files"];
            if (Array.isArray(filesVal)) {
              const firstStr = filesVal.find((x) => typeof x === "string");
              if (firstStr && typeof firstStr === "string") {
                primaryLinkRaw = firstStr;
              }
            }
          }
        }
        // Also consider attachments from typed metadata
        if (!primaryLinkRaw && meta?.attachments && meta.attachments.length) {
          primaryLinkRaw = meta.attachments[0] || null;
        }

        const metadataLink = toGatewayUrl(l.metadataURI);
        let primaryLink = toGatewayUrl(primaryLinkRaw);
        if (!primaryLink) primaryLink = metadataLink || null;

        setState({
          ...l,
          title,
          description,
          cover,
          categoryLabel,
          isBoosted,
          createdAgo,
          skills,
          price,
          tokenSymbol,
          rateUnit,
          deliveryTime,
          portfolio,
          packages,
          metadata: meta,
          primaryLink,
          metadataLink,
        });

        setProfile(creatorProfile);
        setProfileMetadata(creatorProfileMeta);

        // Fetch dynamic listing boost price & duration
        try {
          const price = await contract!.currentListingBoostPrice();
          setBoostPrice(price);
        } catch {}
        try {
          const params = await contract!.getBoostParams();
          const days = Math.round(Number(params.duration ?? 0) / 86400);
          setBoostDurationDays(days);
        } catch {}

        // After listing is set, load current user's offer for this gig
        if (address) {
          try {
            const PAGE = 100;
            let offset = 0;
            let latest: Offer | null = null;
            for (let i = 0; i < 50; i++) {
              const page = await contract!.getOffersForListing(
                id,
                offset,
                PAGE
              );
              if (!page || page.length === 0) break;
              // filter to current user proposer
              const mine = page
                .filter(
                  (o) => o.proposer?.toLowerCase?.() === address.toLowerCase()
                )
                .sort((a, b) => Number(b.createdAt - a.createdAt));
              if (mine.length > 0 && !latest) latest = mine[0];
              if (page.length < PAGE || latest) break;
              offset += PAGE;
            }
            setMyOffer(latest);
            if (latest && latest.accepted) {
              try {
                const esc = await contract!.getEscrow(latest.id);
                setMyEscrow(esc);
              } catch {}
            } else {
              setMyEscrow(null);
            }
          } catch {}
        } else {
          setMyOffer(null);
          setMyEscrow(null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [chainId, resolvedParams.id, address, contract]);

  // UI primitives -----------------------------------------------------------
  const badgeBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide";
  const badgeVariants: Record<string, string> = {
    neutral: "bg-gray-800/70 text-gray-300",
    outline: "border border-white/10 text-gray-300",
    boosted: "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30",
    inactive: "bg-red-500/15 text-red-400",
    success: "bg-green-500/15 text-green-400",
    warning: "bg-yellow-500/15 text-yellow-400",
  };
  const Badge = ({
    children,
    variant = "neutral",
    className = "",
  }: {
    children: React.ReactNode;
    variant?: keyof typeof badgeVariants | string;
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

  const SectionCard = ({
    title,
    icon,
    actions,
    children,
    className = "",
  }: {
    title?: React.ReactNode;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={`container-panel p-6 space-y-4 ${className}`.trim()}>
      {(title || actions) && (
        <div className="flex items-center gap-2 mb-1">
          {icon && (
            <span className="text-gray-400 w-4 h-4 flex items-center justify-center">
              {icon}
            </span>
          )}
          {title && (
            <h3 className="font-medium text-sm tracking-wide text-gray-200">
              {title}
            </h3>
          )}
          {actions && (
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );

  const InfoRow = ({
    label,
    value,
  }: {
    label: string;
    value: React.ReactNode;
  }) => (
    <div className="flex justify-between text-xs text-gray-400">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 ml-4">{value}</span>
    </div>
  );

  const OfferStatusBadge = ({ offer }: { offer: Offer }) => {
    if (offer.accepted) return <Badge variant="success">Accepted</Badge>;
    if (offer.cancelled) return <Badge variant="inactive">Cancelled</Badge>;
    return <Badge variant="warning">Pending</Badge>;
  };

  const handleBookService = async () => {
    if (!address || !state || submitting) return;

    const receipt = await execute(async () => {
      if (!contract) throw new Error("Contract not ready");

      const symbol = bookingDetails.token || "ETH";

      // Resolve payment token address
      let paymentToken = ethers.ZeroAddress as string;
      if (symbol !== "ETH") {
        if (symbol === "DOP") {
          paymentToken = tokenAddresses.DOP || (await contract.getDopToken());
        } else if (symbol === "USDC") {
          paymentToken = tokenAddresses.USDC || (await contract.getUsdcToken());
        }
        if (!paymentToken || paymentToken === "") {
          throw new Error(`${symbol} token address is not configured`);
        }
      }

      // Parse amount using appropriate decimals
      if (!bookingDetails.budget || Number(bookingDetails.budget) <= 0) {
        throw new Error("Please enter a valid budget amount");
      }
      let amount: bigint;
      if (symbol === "ETH") {
        amount = ethers.parseEther(bookingDetails.budget);
      } else {
        const decimals = knownDecimalsFor(paymentToken, tokenAddresses) ?? 18;
        amount = ethers.parseUnits(bookingDetails.budget, decimals);
      }

      // Create the offer (metadata can be sent off-chain via chat; on-chain stores terms)
      return await contract.makeOffer(
        BigInt(resolvedParams.id),
        amount,
        paymentToken
      );
    });

    if (receipt) {
      setShowBookingForm(false);
      setBookingDetails({
        description: "",
        timeline: "",
        budget: "",
        token: "ETH",
      });
      notifyReceipt(
        "Booking Successful",
        "Your booking request has been sent to the service provider.",
        receipt
      );
    }
  };

  const handleCancelMyOffer = async () => {
    if (!address || !myOffer || offerActionLoading) return;
    setConfirm({
      open: true,
      title: "Cancel Offer",
      message: "Cancel your pending offer?",
      action: async () => {
        setConfirm((c) => ({ ...c, open: false }));
        try {
          setOfferActionLoading("cancel");
          if (!contract) throw new Error("Contract not ready");
          const receipt = await contract.cancelOffer(myOffer.id);
          notifyReceipt(
            "Offer cancelled",
            "Your offer has been cancelled.",
            receipt
          );
          // refresh my offer
          setMyOffer({ ...myOffer, cancelled: true });
        } catch (e) {
          toast.showContractError("Cancel failed", e);
        } finally {
          setOfferActionLoading(null);
        }
      },
    });
  };

  const handleDisputeMyOffer = async () => {
    if (!address || !myOffer || !myEscrow || offerActionLoading) return;
    // Client in GIG is proposer (current user) → Request Refund label
    setConfirm({
      open: true,
      title: "Request Refund",
      message: "Request refund by opening a dispute?",
      action: async () => {
        setConfirm((c) => ({ ...c, open: false }));
        try {
          setOfferActionLoading("dispute");
          if (!contract) throw new Error("Contract not ready");
          const receipt = await contract.openDispute(myEscrow.offerId);
          notifyReceipt("Dispute opened", "Refund request submitted.", receipt);
        } catch (e) {
          toast.showContractError("Dispute failed", e);
        } finally {
          setOfferActionLoading(null);
        }
      },
    });
  };

  const renderPortfolio = () => {
    if (!state?.portfolio?.length) return null;
    return (
      <SectionCard title="Portfolio" icon={<Package className="w-4 h-4" />}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {state.portfolio.map((item: PortfolioItem, index: number) => (
            <div key={index} className="space-y-2 group">
              {item.image && (
                <Image
                  src={toGatewayUrl(item.image) || item.image}
                  alt={item.title || `Portfolio item ${index + 1}`}
                  width={400}
                  height={200}
                  className="w-full h-32 object-cover rounded border border-white/10 bg-gray-900 group-hover:opacity-90 transition"
                  unoptimized
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              {item.title && (
                <h4 className="text-xs font-medium tracking-wide">
                  {item.title}
                </h4>
              )}
              {item.description && (
                <p className="text-[11px] leading-relaxed text-gray-400">
                  {truncateText(item.description, 80)}
                </p>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    );
  };

  const renderPackages = () => {
    if (!state?.packages?.length) return null;
    return (
      <SectionCard
        title="Service Packages"
        icon={<Package className="w-4 h-4" />}
      >
        <div className="space-y-4">
          {state.packages.map((pkg: ServicePackage, index: number) => (
            <div
              key={index}
              className="rounded-lg border border-white/10 p-4 bg-gray-900/40"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium text-sm tracking-wide">
                  {pkg.name || `Package ${index + 1}`}
                </h4>
                <span className="text-base font-semibold text-green-400">
                  {pkg.price} {pkg.currency || state.tokenSymbol || "ETH"}
                </span>
              </div>
              {pkg.description && (
                <p className="text-xs text-gray-300 mb-3 leading-relaxed">
                  {pkg.description}
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
                {pkg.deliveryTime && (
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="w-3 h-3" />
                    {pkg.deliveryTime}
                  </span>
                )}
                {pkg.revisions && (
                  <span className="inline-flex items-center gap-1">
                    🔄 {pkg.revisions} revisions
                  </span>
                )}
                {pkg.includes && Array.isArray(pkg.includes) && (
                  <div className="w-full mt-1 space-y-1">
                    <strong className="text-[11px] text-gray-300 font-medium">
                      Includes:
                    </strong>
                    <ul className="list-disc list-inside space-y-0.5">
                      {pkg.includes.map((item: string, i: number) => (
                        <li key={i} className="text-gray-400">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    );
  };

  const handleBoostListing = async () => {
    if (!address || !state || !isOwner) return;
    if (!boostPrice || boostPrice <= BigInt(0)) return;
    try {
      const dop = tokenAddresses.DOP || (await contract!.getDopToken());
      if (!dop) throw new Error("DOP token address not configured");
      const erc20 = contract!.getErc20(dop) as unknown as Erc20;
      const owner = address;
      const spender = contract!.contractAddress;
      const current = await erc20.allowance(owner, spender);
      if (current < boostPrice) {
        const tx0 = await erc20.approve(spender, boostPrice);
        const approvalReceipt = (await tx0.wait?.()) ?? tx0;
        notifyReceipt(
          "Approval complete",
          "Token allowance updated for boosting",
          approvalReceipt
        );
      }
      const receipt = await contract!.buyBoost(state.id, boostPrice);
      notifyReceipt("Listing boosted", undefined, receipt);
      // refresh UI
      setState((s) => (s ? { ...s, isBoosted: true } : s));
      try {
        const price = await contract!.currentListingBoostPrice({ force: true });
        setBoostPrice(price);
      } catch {}
    } catch (e) {
      toast.showContractError("Boost failed", e);
    }
  };

  const renderBookingForm = () => {
    if (!showBookingForm) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-md w-full p-6">
          <h3 className="text-lg font-medium mb-4">Book This Service</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Project Description *
              </label>
              <textarea
                value={bookingDetails.description}
                onChange={(e) =>
                  setBookingDetails((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                rows={3}
                placeholder="Describe what you need..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Timeline
              </label>
              <input
                type="text"
                value={bookingDetails.timeline}
                onChange={(e) =>
                  setBookingDetails((prev) => ({
                    ...prev,
                    timeline: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                placeholder="e.g., 1-2 weeks"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Budget ({bookingDetails.token || "ETH"})
              </label>
              <input
                type="text"
                value={bookingDetails.budget}
                onChange={(e) =>
                  setBookingDetails((prev) => ({
                    ...prev,
                    budget: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                placeholder={bookingDetails.token === "USDC" ? "100" : "0.1"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Payment Token
              </label>
              <select
                value={bookingDetails.token || "ETH"}
                onChange={(e) =>
                  setBookingDetails((prev) => ({
                    ...prev,
                    token: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ETH">ETH (native)</option>
                {tokenAddresses.DOP && <option value="DOP">DOP</option>}
                {tokenAddresses.USDC && <option value="USDC">USDC</option>}
              </select>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowBookingForm(false)}
              className="flex-1 px-4 py-2 text-gray-300 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <LoadingButton
              onClick={handleBookService}
              loading={submitting}
              disabled={!bookingDetails.description || !bookingDetails.budget}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Book Service
            </LoadingButton>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />

      <div className="flex items-center justify-between">
        <Link
          href="/gigs"
          className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      {loading ? (
        <SectionCard>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading gig...
          </div>
          <div className="h-48 w-full bg-gray-900/60 rounded animate-pulse" />
        </SectionCard>
      ) : error ? (
        <SectionCard className="text-sm text-red-400">{error}</SectionCard>
      ) : state ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Main Content */}
            <SectionCard>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge variant="outline">Gig</Badge>
                <Badge variant="outline">
                  <TagIcon className="w-3.5 h-3.5" />
                  {state.categoryLabel}
                </Badge>
                {state.isBoosted && (
                  <Badge variant="boosted">
                    <Sparkles className="w-3.5 h-3.5" />
                    Boosted
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-gray-400 flex items-center gap-1">
                  <Clock3 className="w-3.5 h-3.5" />
                  {state.createdAgo}
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-4 leading-snug">
                {state.title}
              </h1>
              {state.cover && (
                <div className="relative mb-5 rounded-lg overflow-hidden border border-white/10 group">
                  <Image
                    src={state.cover}
                    alt={state.title || "cover"}
                    width={1200}
                    height={480}
                    className="w-full object-cover max-h-96 group-hover:opacity-95 transition"
                    unoptimized
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 ring-1 ring-white/10" />
                </div>
              )}
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mb-5">
                {state.description}
              </p>
              {!!state.skills?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {state.skills.map((s: string, i: number) => (
                    <Badge
                      key={`sk-${i}`}
                      variant="neutral"
                      className="text-[10px] py-0.5 px-2"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Portfolio */}
            {renderPortfolio()}

            {/* Service Packages */}
            {renderPackages()}
          </div>

          <aside className="space-y-4">
            {/* Service Provider Info (with username & avatar fallback) */}
            <SectionCard
              title="Service Provider"
              icon={<User2 className="w-4 h-4" />}
            >
              {profile ? (
                <>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/profile/${state.creator}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/profile/${state.creator}`);
                      }
                    }}
                    className="flex items-center gap-3 mb-3 hover:text-gray-300 transition-colors cursor-pointer"
                  >
                    {profile.profilePicCID ? (
                      <Image
                        src={
                          toGatewayUrl(profile.profilePicCID) ||
                          profile.profilePicCID.replace(
                            /^ipfs:\/\//,
                            "https://ipfs.io/ipfs/"
                          )
                        }
                        alt="Avatar"
                        width={48}
                        height={48}
                        className="w-12 h-12 rounded-full border border-white/10 object-cover"
                        unoptimized
                      />
                    ) : profileMetadata?.avatar ? (
                      <Image
                        src={
                          toGatewayUrl(profileMetadata.avatar) ||
                          profileMetadata.avatar
                        }
                        alt="Avatar"
                        width={48}
                        height={48}
                        className="w-12 h-12 rounded-full border border-white/10 object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full border border-white/10 bg-gray-800 flex items-center justify-center">
                        <UserCircle2 className="w-7 h-7 text-gray-500" />
                      </div>
                    )}
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-medium text-sm leading-tight truncate">
                        {profile.username
                          ? `@${profile.username}`
                          : profileMetadata?.name ||
                            formatAddress(state.creator)}
                      </div>
                      {profile.username && profileMetadata?.name && (
                        <div className="text-[11px] text-gray-500 truncate">
                          {profileMetadata.name}
                        </div>
                      )}
                      <div className="text-[11px] text-gray-400">
                        {profile.userType === 1
                          ? "Developer"
                          : profile.userType === 2
                          ? "Artist"
                          : profile.userType === 3
                          ? "KOL"
                          : "User"}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {profile.isVerified && (
                          <Badge
                            variant="success"
                            className="text-[10px] px-2 py-0.5"
                          >
                            Verified
                          </Badge>
                        )}
                        {avgRating !== null && (
                          <Badge
                            variant="warning"
                            className="text-[10px] px-2 py-0.5 flex items-center gap-1"
                          >
                            <Star className="w-3 h-3" />
                            {avgRating.toFixed(1)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </span>
                  {profile.bio && (
                    <p className="text-xs text-gray-300 leading-relaxed mb-3">
                      {profile.bio}
                    </p>
                  )}
                  {profileSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {profileSkills.slice(0, 3).map((skill, index) => (
                        <Badge
                          key={index}
                          variant="neutral"
                          className="text-[10px] px-2 py-0.5"
                        >
                          {skill}
                        </Badge>
                      ))}
                      {profileSkills.length > 3 && (
                        <span className="text-[11px] text-gray-500">
                          +{profileSkills.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                  {parsedReviews.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {parsedReviews.map((r, idx) => (
                        <div
                          key={idx}
                          className="text-[11px] border border-white/10 rounded p-2 space-y-1 bg-gray-900/40"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-yellow-300 flex items-center gap-0.5">
                              {"★".repeat(r.rating)}
                            </span>
                            <span className="text-gray-500">
                              {r.timestamp
                                ? timeAgo(Math.floor(r.timestamp))
                                : ""}
                            </span>
                          </div>
                          {r.text && (
                            <p className="text-gray-300 line-clamp-3">
                              {truncateText(r.text, 120)}
                            </p>
                          )}
                        </div>
                      ))}
                      {hasMoreReviews && (
                        <button
                          onClick={loadMoreReviews}
                          disabled={reviewsLoadingMore}
                          className="w-full text-[11px] border border-white/10 rounded px-2 py-1 hover:bg-white/5 disabled:opacity-50"
                        >
                          {reviewsLoadingMore ? "Loading..." : "Load more"}
                        </button>
                      )}
                    </div>
                  )}
                  <Link
                    href={`/profile/${state.creator}`}
                    className="block w-full text-center text-xs px-4 py-2 border border-white/10 rounded hover:bg-white/5 transition-colors"
                  >
                    View Full Profile
                  </Link>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full border border-white/10 bg-gray-800 flex items-center justify-center">
                      <UserCircle2 className="w-7 h-7 text-gray-500" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-medium text-sm leading-tight">
                        {formatAddress(state.creator)}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        Profile not created yet
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/profile/${state.creator}`}
                    className="block w-full text-center text-xs px-4 py-2 border border-white/10 rounded hover:bg-white/5 transition-colors"
                  >
                    View Profile Page
                  </Link>
                </div>
              )}
            </SectionCard>

            {/* Pricing */}
            <SectionCard title="Pricing" icon={<Star className="w-4 h-4" />}>
              {state.price ? (
                <div className="space-y-3 mb-2">
                  <div className="text-2xl font-semibold text-green-400 tracking-tight">
                    {state.price}
                    {state.tokenSymbol ? ` ${state.tokenSymbol}` : " ETH"}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    {state.rateUnit && <span>per {state.rateUnit}</span>}
                    {state.deliveryTime && (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="w-3.5 h-3.5" />
                        {state.deliveryTime}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400 mb-2">Custom pricing</div>
              )}
              {!isOwner && address && state.active && (
                <LoadingButton
                  onClick={() => setShowBookingForm(true)}
                  loading={submitting}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                >
                  Book This Service
                </LoadingButton>
              )}
              {!address && (
                <div className="text-xs text-center text-gray-400 p-3 border border-white/10 rounded">
                  Connect wallet to book this service
                </div>
              )}
              {isOwner && (
                <div className="text-xs text-center text-blue-300 p-3 border border-blue-800/40 rounded">
                  This is your gig
                </div>
              )}
            </SectionCard>

            {isOwner && (
              <SectionCard
                title="Boost Listing"
                icon={<Sparkles className="w-4 h-4" />}
              >
                <div className="space-y-2 text-xs text-gray-400">
                  <InfoRow
                    label="Current price"
                    value={
                      boostPrice != null
                        ? `${ethers.formatUnits(
                            boostPrice,
                            knownDecimalsFor(
                              tokenAddresses.DOP || ethers.ZeroAddress,
                              tokenAddresses
                            ) ?? 18
                          )} DOP`
                        : "-"
                    }
                  />
                  <InfoRow
                    label="Duration"
                    value={
                      boostDurationDays != null ? `${boostDurationDays} d` : "-"
                    }
                  />
                  <button
                    onClick={handleBoostListing}
                    disabled={!boostPrice}
                    className="w-full mt-2 px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 disabled:opacity-50"
                  >
                    Boost Now
                  </button>
                </div>
              </SectionCard>
            )}

            {/* Your Offer (for current wallet) */}
            {address && myOffer && (
              <SectionCard
                title="Your Offer"
                icon={<FileText className="w-4 h-4" />}
              >
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <Badge variant="outline">#{String(myOffer.id)}</Badge>
                  <OfferStatusBadge offer={myOffer} />
                  <Link
                    href={`/offers/${String(myOffer.id)}`}
                    className="ml-auto text-blue-400 hover:underline"
                  >
                    View
                  </Link>
                </div>
                {!myOffer.accepted && !myOffer.cancelled && (
                  <button
                    onClick={handleCancelMyOffer}
                    disabled={offerActionLoading === "cancel"}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm"
                  >
                    {offerActionLoading === "cancel"
                      ? "Cancelling..."
                      : "Cancel Offer"}
                  </button>
                )}
                {myOffer.accepted &&
                  myEscrow &&
                  myEscrow.status === EscrowStatus.IN_PROGRESS && (
                    <button
                      onClick={handleDisputeMyOffer}
                      disabled={offerActionLoading === "dispute"}
                      className="w-full mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm"
                    >
                      {offerActionLoading === "dispute"
                        ? "Submitting..."
                        : "Request Refund"}
                    </button>
                  )}
              </SectionCard>
            )}

            {/* On-chain Info */}
            <SectionCard
              title="On-chain Details"
              icon={<FileText className="w-4 h-4" />}
            >
              <div className="space-y-2">
                <InfoRow label="Listing ID" value={String(state.id)} />
                <InfoRow label="Creator" value={formatAddress(state.creator)} />
                <InfoRow label="Active" value={state.active ? "Yes" : "No"} />
                <InfoRow label="Created" value={state.createdAgo} />
              </div>
            </SectionCard>

            {/* Attachments */}
            <SectionCard
              title="Attachments"
              icon={<FileText className="w-4 h-4" />}
            >
              {state.primaryLink ? (
                <a
                  href={state.primaryLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-300 hover:underline break-all inline-flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Attachment
                </a>
              ) : (
                <div className="text-xs text-gray-400">No attachments</div>
              )}
            </SectionCard>
          </aside>
        </div>
      ) : null}

      {renderBookingForm()}

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
