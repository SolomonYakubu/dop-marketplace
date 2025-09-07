"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { getTokenAddresses } from "@/lib/contract";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import {
  OnchainUserProfile,
  Listing,
  Mission,
  Badge,
  ProfileMetadata,
} from "@/types/marketplace";
import {
  toGatewayUrl,
  formatAddress,
  truncateText,
  formatTokenAmountWithSymbol,
  timeAgo,
  getRpcUrl,
} from "@/lib/utils";
import { useToast, useAsyncOperation } from "@/hooks/useErrorHandling";
import { LoadingButton } from "@/components/Loading";
import Image from "next/image";

// Minimal ERC-20 interface
interface Erc20 {
  decimals(): Promise<number | bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(
    spender: string,
    amount: bigint
  ): Promise<{ wait?: () => Promise<unknown> } & object>;
}

// Raw review as returned by contract
type RawReview = {
  rating: number | bigint;
  reviewer: string;
  reviewURI: string;
  timestamp?: number | bigint;
};

export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const resolvedParams = use(params);
  const { address, chain } = useAccount();
  const chainId = chain?.id ?? 11124;
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );
  const { contract } = useMarketplaceContract();

  const tokenAddresses = useMemo(() => getTokenAddresses(chainId), [chainId]);
  const toast = useToast();
  const { loading: boosting, execute } = useAsyncOperation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<OnchainUserProfile | null>(null);
  const [profileMeta, setProfileMeta] = useState<ProfileMetadata | null>(null);
  const [isBoosted, setIsBoosted] = useState<boolean>(false);

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviews, setReviews] = useState<
    Array<{
      rating: number;
      reviewer: string;
      text?: string;
      timestamp?: number;
    }>
  >([]);

  const [missions, setMissions] = useState<Mission[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);

  const [listings, setListings] = useState<
    Array<{
      listing: Listing;
      title: string;
      cover?: string | null;
    }>
  >([]);
  // Pagination state
  const REVIEWS_PAGE_SIZE = 10;
  const LISTINGS_PAGE_SIZE = 6;
  const [allReviewsRaw, setAllReviewsRaw] = useState<RawReview[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState<number>(0);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [myListingRefs, setMyListingRefs] = useState<Listing[]>([]);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);

  // Profile boost params and token info
  const [boostParams, setBoostParams] = useState<{
    price: bigint;
    duration: bigint;
  } | null>(null);
  const [dopToken, setDopToken] = useState<string>("");
  const [dopDecimals, setDopDecimals] = useState<number>(18);

  // Normalize profile skills
  const profileSkills = useMemo(
    () => (Array.isArray(profile?.skills) ? (profile!.skills as string[]) : []),
    [profile]
  );

  const isOwner =
    !!address &&
    !!resolvedParams.address &&
    address.toLowerCase() === resolvedParams.address.toLowerCase();

  // Helper to parse a single review (handles data: and ipfs/http URIs)
  const parseReview = async (r: RawReview) => {
    let text: string | undefined = undefined;
    const uri: string = r.reviewURI;
    try {
      if (uri && uri.startsWith("data:")) {
        const [, rest] = uri.split(",");
        if (rest) {
          const jsonStr = atob(rest);
          const obj = JSON.parse(jsonStr) as Record<string, unknown>;
          text =
            (obj?.["text"] as string | undefined) ||
            (obj?.["comment"] as string | undefined) ||
            (obj?.["review"] as string | undefined) ||
            undefined;
        }
      } else if (uri) {
        const url = toGatewayUrl(uri) || uri;
        const res = await fetch(url);
        const t = await res.text();
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          text =
            (obj?.["text"] as string | undefined) ||
            (obj?.["comment"] as string | undefined) ||
            (obj?.["review"] as string | undefined) ||
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
      timestamp: r.timestamp ? Number(r.timestamp) : undefined,
    };
  };

  async function loadMoreReviews() {
    if (loadingMoreReviews) return;
    if (reviews.length >= allReviewsRaw.length) return;
    setLoadingMoreReviews(true);
    try {
      const start = reviews.length;
      const end = Math.min(start + REVIEWS_PAGE_SIZE, allReviewsRaw.length);
      const next = allReviewsRaw.slice(start, end);
      const parsed = await Promise.all(next.map(parseReview));
      setReviews((prev) => [...prev, ...parsed]);
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  async function enrichListingsSlice(refs: Listing[]) {
    const enriched = await Promise.all(
      refs.map(async (l) => {
        let title = `Gig #${String(l.id)}`;
        let cover: string | null = null;
        try {
          const url = toGatewayUrl(l.metadataURI);
          if (url) {
            const res = await fetch(url);
            const text = await res.text();
            try {
              const meta = JSON.parse(text) as Record<string, unknown>;
              title =
                (meta?.["title"] as string) ||
                (meta?.["name"] as string) ||
                title;
              const img =
                (meta?.["image"] as string | undefined) ||
                (meta?.["cover"] as string | undefined) ||
                null;
              cover = toGatewayUrl(img || "") || img || null;
            } catch {}
          }
        } catch {}
        return { listing: l, title, cover };
      })
    );
    return enriched;
  }

  async function loadMoreListings() {
    if (loadingMoreListings) return;
    if (listings.length >= myListingRefs.length) return;
    setLoadingMoreListings(true);
    try {
      const start = listings.length;
      const end = Math.min(start + LISTINGS_PAGE_SIZE, myListingRefs.length);
      const nextRefs = myListingRefs.slice(start, end);
      const next = await enrichListingsSlice(nextRefs);
      setListings((prev) => [...prev, ...next]);
    } finally {
      setLoadingMoreListings(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const user = resolvedParams.address;

        // Profile
        let p: OnchainUserProfile | null = null;
        try {
          const raw = (await contract!.getProfile(
            user
          )) as unknown as OnchainUserProfile;
          if (raw) {
            const normalized: OnchainUserProfile = {
              ...raw,
              skills: Array.isArray(
                (raw as unknown as { skills?: unknown }).skills
              )
                ? (raw as unknown as { skills?: string[] }).skills ?? []
                : [],
              portfolioURIs: Array.isArray(
                (raw as unknown as { portfolioURIs?: unknown }).portfolioURIs
              )
                ? (raw as unknown as { portfolioURIs?: string[] })
                    .portfolioURIs ?? []
                : [],
              // ...existing fields preserved via spread
            };
            p = normalized;
            setProfile(normalized);
          }
        } catch {}

        console.log("profile", p);
        // Profile metadata (name/avatar/portfolio)
        if (p && Array.isArray(p.portfolioURIs) && p.portfolioURIs.length > 0) {
          try {
            const metaUrl = toGatewayUrl(p.portfolioURIs[0]);
            if (metaUrl) {
              const res = await fetch(metaUrl);
              const text = await res.text();
              try {
                const meta = JSON.parse(text) as ProfileMetadata;
                setProfileMeta(meta);
              } catch {}
            }
          } catch {}
        } else {
          setProfileMeta(null);
        }

        // Boosted status
        try {
          const boosted = await contract!.isProfileBoosted(user);
          setIsBoosted(!!boosted);
        } catch {}

        // Rating + reviews
        try {
          const rating = await contract!.getAverageRating(user);
          setAvgRating(Number(rating));
          const rlist = (await contract!.getReviews(user)) as RawReview[];
          // Newest first
          const all = (rlist || []).slice().reverse();
          setAllReviewsRaw(all);
          setReviewsTotal(all.length);
          const initial = all.slice(0, REVIEWS_PAGE_SIZE);
          const parsed = await Promise.all(initial.map(parseReview));
          setReviews(parsed);
        } catch {}

        // Missions and badges
        try {
          const m = await contract!.getMissionHistory(user);
          setMissions(m);
        } catch {}
        try {
          const b = await contract!.getUserBadges(user);
          setBadges(b);
        } catch {}

        // Listings created by user
        try {
          const userListings = await contract!.getListingsByCreator(
            user,
            0,
            120
          );
          setMyListingRefs(userListings);
          // Enrich first page
          const topRefs = userListings.slice(0, LISTINGS_PAGE_SIZE);
          const enriched = await enrichListingsSlice(topRefs);
          setListings(enriched);
        } catch {}

        // Fetch boost params and DOP token info
        try {
          const params = await contract!.getProfileBoostParams();
          setBoostParams(params);
          let dop = tokenAddresses.DOP;
          if (!dop) {
            try {
              dop = await contract!.getDopToken();
            } catch {}
          }
          if (dop) {
            setDopToken(dop);
            try {
              const erc20 = contract!.getErc20(dop) as unknown as Erc20;
              const dec = await erc20.decimals();
              setDopDecimals(Number(dec));
            } catch {
              setDopDecimals(18);
            }
          }
        } catch {}
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Failed to load profile";
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [chainId, contract, provider, resolvedParams.address, tokenAddresses.DOP]);

  async function handleBuyBoost() {
    if (!isOwner) {
      toast.showError("Not allowed", "You can only boost your own profile.");
      return;
    }
    if (!boostParams || !boostParams.price) {
      toast.showError("Unavailable", "Boost parameters not available.");
      return;
    }

    const result = await execute(async () => {
      // Use browser wallet for write

      // Resolve DOP token address
      let dop = dopToken;
      if (!dop) {
        try {
          dop = await contract!.getDopToken();
        } catch {}
      }
      if (!dop) throw new Error("DOP token address is not configured");

      // Ensure allowance
      const erc20 = contract!.getErc20(dop) as unknown as Erc20;
      const owner = address;
      const spender = contract!.contractAddress;
      const current: bigint = await erc20.allowance(owner, spender);
      if (current < boostParams.price) {
        const tx = await erc20.approve(spender, boostParams.price);
        await tx.wait?.();
      }

      // Buy boost
      await contract!.buyProfileBoost(boostParams.price);
    });

    if (result !== null) {
      toast.showSuccess("Profile Boosted", "Your profile boost is now active.");
      setIsBoosted(true);
    }
  }

  return (
    <div className="space-y-6">
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
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Profile Header */}
            <div className="container-panel p-6 space-y-4">
              <div className="flex items-center gap-3">
                {profileMeta?.avatar && (
                  <Image
                    src={toGatewayUrl(profileMeta.avatar) || profileMeta.avatar}
                    alt="Avatar"
                    width={64}
                    height={64}
                    className="w-16 h-16 rounded-full border border-gray-700"
                    unoptimized
                  />
                )}
                <div>
                  <h1 className="text-2xl font-semibold">
                    {profileMeta?.name || formatAddress(resolvedParams.address)}
                  </h1>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    {profile?.isVerified && (
                      <span className="text-green-400">✓ Verified</span>
                    )}
                    {isBoosted && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-400/20 px-2 py-0.5 text-amber-300 text-[11px]">
                        Boosted
                      </span>
                    )}
                    {avgRating !== null && (
                      <span className="text-yellow-300">
                        ★ {avgRating.toFixed(2)} avg
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {profile?.bio && <p className="text-gray-300">{profile.bio}</p>}
              {profileSkills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {profileSkills.map((s, i) => (
                    <span
                      key={`sk-${i}`}
                      className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-400"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Portfolio (rich) */}

              {profile?.portfolioURIs && profile.portfolioURIs.length > 0 && (
                <Link
                  href={
                    toGatewayUrl(profile.portfolioURIs[0]) ||
                    profile.portfolioURIs[0]
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                >
                  View Portfolio
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </Link>
              )}
            </div>

            {/* Recent Gigs */}
            <div className="container-panel p-6">
              <h3 className="font-medium mb-4">Recent Gigs</h3>
              {listings.length === 0 ? (
                <div className="text-sm text-gray-400">No gigs yet.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {listings.map((item, idx) => (
                      <Link
                        key={idx}
                        href={`/gigs/${String(item.listing.id)}`}
                        className="border border-gray-800 rounded hover:border-gray-700 transition-colors overflow-hidden"
                      >
                        {item.cover && (
                          <Image
                            src={item.cover}
                            alt={item.title}
                            width={600}
                            height={144}
                            className="w-full h-36 object-cover border-b border-gray-800"
                            unoptimized
                          />
                        )}
                        <div className="p-3">
                          <div className="font-medium truncate">
                            {item.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Created {timeAgo(Number(item.listing.createdAt))}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {listings.length < myListingRefs.length && (
                    <div className="mt-4 flex justify-center">
                      <LoadingButton
                        onClick={loadMoreListings}
                        loading={loadingMoreListings}
                        className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                      >
                        Load more gigs
                      </LoadingButton>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Reviews */}
            <div className="container-panel p-6">
              <h3 className="font-medium mb-4">Reviews</h3>
              {reviews.length === 0 ? (
                <div className="text-sm text-gray-400">No reviews yet.</div>
              ) : (
                <>
                  <div className="space-y-3">
                    {reviews.map((r, i) => (
                      <div
                        key={i}
                        className="border border-gray-800 rounded p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-yellow-300">
                            {"★".repeat(r.rating)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {r.timestamp
                              ? timeAgo(Math.floor(r.timestamp))
                              : ""}
                          </div>
                        </div>
                        {r.text && (
                          <p className="text-sm text-gray-300 mt-1">
                            {truncateText(r.text, 180)}
                          </p>
                        )}
                        <div className="text-xs text-gray-500 mt-1">
                          Reviewer: {formatAddress(r.reviewer)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {reviews.length < reviewsTotal && (
                    <div className="mt-4 flex justify-center">
                      <LoadingButton
                        onClick={loadMoreReviews}
                        loading={loadingMoreReviews}
                        className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                      >
                        Load more reviews
                      </LoadingButton>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Mission Stats */}
            <div className="container-panel p-6">
              <h3 className="text-lg font-semibold mb-4">Mission Stats</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Missions:</span>
                  <span className="font-semibold">{missions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Disputed:</span>
                  <span className="font-semibold text-red-400">
                    {missions.filter((m) => m.wasDisputed).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Success Rate:</span>
                  <span className="font-semibold text-green-400">
                    {missions.length > 0
                      ? Math.round(
                          ((missions.length -
                            missions.filter((m) => m.wasDisputed).length) /
                            missions.length) *
                            100
                        )
                      : 0}
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* Badges */}
            <div className="container-panel p-6">
              <h3 className="text-lg font-semibold mb-4">Badges</h3>
              {badges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {badges.map((badge, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-gradient-to-r from-yellow-600 to-orange-600 text-white text-xs rounded-full"
                    >
                      {Badge[badge] || "NONE"}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No badges earned yet</p>
              )}
            </div>

            {/* Boost Profile (owner only) */}
            {isOwner && (
              <div className="container-panel p-6 space-y-3">
                <h3 className="text-lg font-semibold">Boost Profile</h3>
                {boostParams ? (
                  <div className="text-sm text-gray-400">
                    <div>
                      Price:{" "}
                      <span className="text-white font-medium">
                        {boostParams.price
                          ? formatTokenAmountWithSymbol(
                              boostParams.price,
                              dopToken ||
                                tokenAddresses.DOP ||
                                ethers.ZeroAddress,
                              { tokens: tokenAddresses, decimals: dopDecimals }
                            )
                          : "-"}
                      </span>
                    </div>
                    <div>
                      Duration:{" "}
                      <span className="text-white font-medium">
                        {boostParams.duration
                          ? Math.round(Number(boostParams.duration) / 86400)
                          : 0}{" "}
                        days
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">
                    Loading boost parameters…
                  </div>
                )}
                <LoadingButton
                  onClick={handleBuyBoost}
                  loading={boosting}
                  disabled={!boostParams || boosting}
                  className="w-full px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors font-medium disabled:opacity-50"
                >
                  Buy Boost
                </LoadingButton>
                <p className="text-xs text-gray-500">
                  Boost increases your profile visibility for the listed
                  duration.
                </p>
              </div>
            )}

            {/* Contact / CTA */}
            <div className="container-panel p-6 space-y-3">
              <h3 className="text-lg font-semibold">Contact</h3>
              <div className="text-sm text-gray-400">
                Wallet: {formatAddress(resolvedParams.address)}
              </div>
              <Link
                href={`/create?prefill=brief&to=${encodeURIComponent(
                  resolvedParams.address
                )}`}
                className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
              >
                Request Quote
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
