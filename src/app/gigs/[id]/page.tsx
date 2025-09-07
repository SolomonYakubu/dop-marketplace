"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, use } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { getMarketplaceContract, getTokenAddresses } from "@/lib/contract";
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
  getRpcUrl,
  timeAgo,
  loadListingMetadataFromURI,
  getCategoryLabel,
  asRecord,
  asString,
  asStringArray,
  asNumber,
} from "@/lib/utils";
import { useToast, useAsyncOperation } from "@/hooks/useErrorHandling";
import { ToastContainer } from "@/components/Toast";
import { LoadingButton } from "@/components/Loading";
import { EscrowStatus } from "@/types/marketplace";
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

export default function GigDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const tokenAddresses = useMemo(() => getTokenAddresses(chainId), [chainId]);

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

        // Fetch creator profile
        let creatorProfile: OnchainUserProfile | null = null;
        let creatorProfileMeta: Partial<ProfileMetadata> | null = null;
        try {
          const prof = (await contract!.getProfile(
            l.creator
          )) as OnchainUserProfile;
          if (
            prof?.bio ||
            (Array.isArray(prof?.skills) && prof.skills.length > 0)
          ) {
            const normalized: OnchainUserProfile = {
              ...prof,
              skills: Array.isArray(prof.skills) ? prof.skills : [],
              portfolioURIs: Array.isArray(prof.portfolioURIs)
                ? prof.portfolioURIs
                : [],
            };
            creatorProfile = normalized;
            // Try to fetch metadata for profile picture and name
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
  }, [chainId, provider, resolvedParams.id, address]);

  const handleBookService = async () => {
    if (!address || !state || submitting) return;

    const result = await execute(async () => {
      // Use browser wallet for write

      const web3 = new ethers.BrowserProvider(window.ethereum);
      const signer = await web3.getSigner();
      const contract = getMarketplaceContract(chainId, web3).connect(signer);

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
        const erc20 = contract.getErc20(paymentToken) as unknown as {
          decimals: () => Promise<number | bigint | string>;
        };
        const dec = await erc20.decimals();
        const decimals = Number(dec);
        amount = ethers.parseUnits(bookingDetails.budget, decimals);
      }

      // Create the offer (metadata can be sent off-chain via chat; on-chain stores terms)
      await contract.makeOffer(BigInt(resolvedParams.id), amount, paymentToken);
    });

    if (result !== null) {
      setShowBookingForm(false);
      setBookingDetails({
        description: "",
        timeline: "",
        budget: "",
        token: "ETH",
      });
      toast.showSuccess(
        "Booking Successful",
        "Your booking request has been sent to the service provider."
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
          const web3 = new ethers.BrowserProvider(window.ethereum);
          const signer = await web3.getSigner();
          const contract = getMarketplaceContract(chainId, web3).connect(
            signer
          );
          const tx = await contract.cancelOffer(myOffer.id);
          await tx;
          toast.showSuccess(
            "Offer cancelled",
            "Your offer has been cancelled."
          );
          // refresh my offer
          setMyOffer({ ...myOffer, cancelled: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to cancel offer";
          toast.showError("Cancel failed", msg);
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
          const web3 = new ethers.BrowserProvider(window.ethereum);
          const signer = await web3.getSigner();
          const contract = getMarketplaceContract(chainId, web3).connect(
            signer
          );
          const tx = await contract.openDispute(myEscrow.offerId);
          await tx;
          toast.showSuccess("Dispute opened", "Refund request submitted.");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to open dispute";
          toast.showError("Dispute failed", msg);
        } finally {
          setOfferActionLoading(null);
        }
      },
    });
  };

  const renderPortfolio = () => {
    if (!state?.portfolio?.length) return null;

    return (
      <div className="container-panel p-6">
        <h3 className="font-medium mb-4">Portfolio</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {state.portfolio.map((item: PortfolioItem, index: number) => (
            <div key={index} className="space-y-2">
              {item.image && (
                <Image
                  src={toGatewayUrl(item.image) || item.image}
                  alt={item.title || `Portfolio item ${index + 1}`}
                  width={400}
                  height={200}
                  className="w-full h-32 object-cover rounded border border-gray-800"
                  unoptimized
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              {item.title && (
                <h4 className="text-sm font-medium">{item.title}</h4>
              )}
              {item.description && (
                <p className="text-xs text-gray-400">
                  {truncateText(item.description, 80)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPackages = () => {
    if (!state?.packages?.length) return null;

    return (
      <div className="container-panel p-6">
        <h3 className="font-medium mb-4">Service Packages</h3>
        <div className="space-y-4">
          {state.packages.map((pkg: ServicePackage, index: number) => (
            <div key={index} className="border border-gray-800 rounded p-4">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">
                  {pkg.name || `Package ${index + 1}`}
                </h4>
                <span className="text-lg font-semibold text-green-400">
                  {pkg.price} {pkg.currency || state.tokenSymbol || "ETH"}
                </span>
              </div>
              {pkg.description && (
                <p className="text-sm text-gray-300 mb-3">{pkg.description}</p>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                {pkg.deliveryTime && <span>⏱️ {pkg.deliveryTime}</span>}
                {pkg.revisions && <span>🔄 {pkg.revisions} revisions</span>}
                {pkg.includes && Array.isArray(pkg.includes) && (
                  <div className="w-full mt-2">
                    <strong>Includes:</strong>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      {pkg.includes.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
        <Link href="/gigs" className="text-sm text-gray-400 hover:text-white">
          ← Back to Gigs
        </Link>
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
          <div className="lg:col-span-2 space-y-6">
            {/* Main Content */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                  Gig
                </span>
                <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                  {state.categoryLabel}
                </span>
                {state.isBoosted && (
                  <span className="text-[11px] rounded-full border border-amber-500/30 bg-amber-400/20 px-2 py-0.5 text-amber-300">
                    Boosted
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  {state.createdAgo}
                </span>
              </div>

              <h1 className="text-2xl font-semibold mb-4">{state.title}</h1>

              {state.cover ? (
                <Image
                  src={state.cover}
                  alt={state.title || "cover"}
                  width={1200}
                  height={480}
                  className="w-full rounded border border-gray-800 object-cover max-h-96 mb-4"
                  unoptimized
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}

              <p className="text-gray-300 whitespace-pre-wrap mb-4">
                {state.description}
              </p>

              {!!state.skills?.length && (
                <div className="flex flex-wrap gap-2">
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
            </div>

            {/* Portfolio */}
            {renderPortfolio()}

            {/* Service Packages */}
            {renderPackages()}
          </div>

          <aside className="space-y-4">
            {/* Service Provider Info */}
            {profile && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="font-medium">Service Provider</h3>
                <div className="flex items-center gap-3">
                  {profileMetadata?.avatar && (
                    <Image
                      src={
                        toGatewayUrl(profileMetadata.avatar) ||
                        profileMetadata.avatar
                      }
                      alt="Profile"
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full border border-gray-700"
                      unoptimized
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <div>
                    <div className="font-medium">
                      {profileMetadata?.name || formatAddress(state.creator)}
                    </div>
                    <div className="text-sm text-gray-400">
                      {profile.userType === 1
                        ? "Developer"
                        : profile.userType === 2
                        ? "Artist"
                        : profile.userType === 3
                        ? "KOL"
                        : "User"}
                    </div>
                    {profile.isVerified && (
                      <div className="text-xs text-green-400">✓ Verified</div>
                    )}
                    {avgRating !== null && (
                      <div className="text-xs text-yellow-300 mt-1">
                        ★ {avgRating.toFixed(2)} avg
                      </div>
                    )}
                  </div>
                </div>
                {profile.bio && (
                  <p className="text-sm text-gray-300">{profile.bio}</p>
                )}
                {profileSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {profileSkills.slice(0, 3).map((skill, index) => (
                      <span
                        key={index}
                        className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded"
                      >
                        {skill}
                      </span>
                    ))}
                    {profileSkills.length > 3 && (
                      <span className="text-xs text-gray-400">
                        +{profileSkills.length - 3} more
                      </span>
                    )}
                  </div>
                )}
                {parsedReviews.length > 0 && (
                  <div className="mt-2">
                    <h4 className="text-sm font-medium mb-1">Recent Reviews</h4>
                    <div className="space-y-2">
                      {parsedReviews.map((r, idx) => (
                        <div
                          key={idx}
                          className="text-xs border border-gray-800 rounded p-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-yellow-300">
                              {"★".repeat(r.rating)}
                            </span>
                            <span className="text-gray-500">
                              {r.timestamp
                                ? timeAgo(Math.floor(r.timestamp))
                                : ""}
                            </span>
                          </div>
                          {r.text && (
                            <p className="text-gray-300 mt-1">
                              {truncateText(r.text, 120)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    {hasMoreReviews && (
                      <button
                        onClick={loadMoreReviews}
                        disabled={reviewsLoadingMore}
                        className="mt-2 w-full text-xs border border-gray-800 rounded px-2 py-1 hover:bg-gray-800 disabled:opacity-50"
                      >
                        {reviewsLoadingMore ? "Loading..." : "Load more"}
                      </button>
                    )}
                  </div>
                )}
                <Link
                  href={`/profile/${state.creator}`}
                  className="block w-full text-center px-4 py-2 border border-gray-700 rounded hover:bg-gray-800 transition-colors text-sm"
                >
                  View Full Profile
                </Link>
              </div>
            )}

            {/* Pricing */}
            <div className="container-panel p-6 space-y-3">
              <h3 className="font-medium">Pricing</h3>
              {state.price ? (
                <div className="space-y-2">
                  <div className="text-2xl font-bold text-green-400">
                    {state.price}
                    {state.tokenSymbol ? ` ${state.tokenSymbol}` : " ETH"}
                  </div>
                  {state.rateUnit && (
                    <div className="text-sm text-gray-400">
                      per {state.rateUnit}
                    </div>
                  )}
                  {state.deliveryTime && (
                    <div className="text-sm text-gray-400">
                      ⏱️ Delivery: {state.deliveryTime}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-400">Custom pricing</div>
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
                <div className="text-sm text-center text-gray-400 p-3 border border-gray-800 rounded">
                  Connect wallet to book this service
                </div>
              )}

              {isOwner && (
                <div className="text-sm text-center text-blue-400 p-3 border border-blue-800 rounded">
                  This is your gig
                </div>
              )}
            </div>

            {/* Your Offer (for current wallet) */}
            {address && myOffer && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="font-medium">Your Offer</h3>
                <div className="text-sm text-gray-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded border border-gray-800">
                      #{String(myOffer.id)}
                    </span>
                    {myOffer.accepted ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                        Accepted
                      </span>
                    ) : myOffer.cancelled ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                        Cancelled
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/offers/${String(myOffer.id)}`}
                      className="text-blue-400 hover:underline"
                    >
                      View details
                    </Link>
                  </div>
                </div>

                {!myOffer.accepted && !myOffer.cancelled && (
                  <button
                    onClick={handleCancelMyOffer}
                    disabled={offerActionLoading === "cancel"}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
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
                      className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {offerActionLoading === "dispute"
                        ? "Submitting..."
                        : "Request Refund"}
                    </button>
                  )}
              </div>
            )}

            {/* On-chain Info */}
            <div className="container-panel p-6 space-y-3">
              <h3 className="font-medium">On-chain Details</h3>
              <div className="text-sm text-gray-400 space-y-2">
                <div>
                  <span className="text-gray-500">Listing ID:</span>{" "}
                  {String(state.id)}
                </div>
                <div>
                  <span className="text-gray-500">Creator:</span>{" "}
                  {formatAddress(state.creator)}
                </div>
                <div>
                  <span className="text-gray-500">Active:</span>{" "}
                  {state.active ? "✅ Yes" : "❌ No"}
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>{" "}
                  {state.createdAgo}
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="container-panel p-6 space-y-3">
              <h3 className="font-medium">Attachments</h3>
              {state.primaryLink ? (
                <a
                  href={state.primaryLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-cyan-300 hover:underline break-all block"
                >
                  📎 View Attachment
                </a>
              ) : (
                <div className="text-sm text-gray-400">No attachments</div>
              )}
            </div>
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
