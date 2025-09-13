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
import {
  ArrowLeft,
  UserCircle2,
  BadgeCheck,
  Star,
  Award,
  Target,
  History,
  Rocket,
  Briefcase,
  MessageSquareQuote,
  Link as LinkIcon,
} from "lucide-react";

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
  const [isBoosted, setIsBoosted] = useState(false);
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
    Array<{ listing: Listing; title: string; cover?: string | null }>
  >([]);
  const [allReviewsRaw, setAllReviewsRaw] = useState<RawReview[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [myListingRefs, setMyListingRefs] = useState<Listing[]>([]);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);
  const [boostParams, setBoostParams] = useState<{
    price: bigint;
    duration: bigint;
  } | null>(null);
  const [dopToken, setDopToken] = useState("");
  const [dopDecimals, setDopDecimals] = useState(18);

  const profileSkills = useMemo(
    () => (Array.isArray(profile?.skills) ? (profile!.skills as string[]) : []),
    [profile]
  );
  const isOwner =
    !!address &&
    !!resolvedParams.address &&
    address.toLowerCase() === resolvedParams.address.toLowerCase();
  const REVIEWS_PAGE_SIZE = 10;
  const LISTINGS_PAGE_SIZE = 6;

  const parseReview = async (r: RawReview) => {
    let text: string | undefined;
    const uri = r.reviewURI;
    try {
      if (uri?.startsWith("data:")) {
        const [, rest] = uri.split(",");
        if (rest) {
          const jsonStr = atob(rest);
          const obj = JSON.parse(jsonStr) as Record<string, unknown>;
          text =
            (obj["text"] as string) ||
            (obj["comment"] as string) ||
            (obj["review"] as string) ||
            undefined;
        }
      } else if (uri) {
        const url = toGatewayUrl(uri) || uri;
        const res = await fetch(url);
        const t = await res.text();
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          text =
            (obj["text"] as string) ||
            (obj["comment"] as string) ||
            (obj["review"] as string) ||
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
    if (loadingMoreReviews || reviews.length >= allReviewsRaw.length) return;
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
                (meta["title"] as string) || (meta["name"] as string) || title;
              const img =
                (meta["image"] as string) || (meta["cover"] as string) || null;
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
    if (loadingMoreListings || listings.length >= myListingRefs.length) return;
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
    (async function load() {
      setLoading(true);
      setError(null);
      try {
        const user = resolvedParams.address;
        let p: OnchainUserProfile | null = null;
        try {
          const raw = (await contract!.getProfile(
            user
          )) as unknown as OnchainUserProfile;
          if (raw) {
            const rawAny = raw as unknown as {
              skills?: unknown;
              portfolioURIs?: unknown;
            };
            const normalized: OnchainUserProfile = {
              ...raw,
              skills: Array.isArray(rawAny.skills)
                ? (rawAny.skills as string[])
                : [],
              portfolioURIs: Array.isArray(rawAny.portfolioURIs)
                ? (rawAny.portfolioURIs as string[])
                : [],
            };
            p = normalized;
            setProfile(normalized);
          }
        } catch {}
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
        try {
          const boosted = await contract!.isProfileBoosted(user);
          setIsBoosted(!!boosted);
        } catch {}
        try {
          const rating = await contract!.getAverageRating(user);
          setAvgRating(Number(rating));
          const rlist = (await contract!.getReviews(user)) as RawReview[];
          const all = (rlist || []).slice().reverse();
          setAllReviewsRaw(all);
          setReviewsTotal(all.length);
          const initial = all.slice(0, REVIEWS_PAGE_SIZE);
          const parsed = await Promise.all(initial.map(parseReview));
          setReviews(parsed);
        } catch {}
        try {
          const m = await contract!.getMissionHistory(user);
          setMissions(m);
        } catch {}
        try {
          const b = await contract!.getUserBadges(user);
          setBadges(b);
        } catch {}
        try {
          const userListings = await contract!.getListingsByCreator(
            user,
            0,
            120
          );
          setMyListingRefs(userListings);
          const topRefs = userListings.slice(0, LISTINGS_PAGE_SIZE);
          const enriched = await enrichListingsSlice(topRefs);
          setListings(enriched);
        } catch {}
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
        setError(
          typeof e === "string"
            ? e
            : (e as Error)?.message || "Failed to load profile"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [chainId, contract, provider, resolvedParams.address, tokenAddresses.DOP]);

  async function handleBuyBoost() {
    if (!isOwner) {
      toast.showError("Not allowed", "You can only boost your own profile.");
      return;
    }
    if (!boostParams?.price) {
      toast.showError("Unavailable", "Boost parameters not available.");
      return;
    }
    const result = await execute(async () => {
      let dop = dopToken;
      if (!dop) {
        try {
          dop = await contract!.getDopToken();
        } catch {}
      }
      if (!dop) throw new Error("DOP token address is not configured");
      const erc20 = contract!.getErc20(dop) as unknown as Erc20;
      const owner = address!;
      const spender = contract!.contractAddress;
      const current: bigint = await erc20.allowance(owner, spender);
      if (current < boostParams.price) {
        const tx = await erc20.approve(spender, boostParams.price);
        await tx.wait?.();
      }
      await contract!.buyProfileBoost(boostParams.price);
    });
    if (result !== null) {
      toast.showSuccess("Profile Boosted", "Your profile boost is now active.");
      setIsBoosted(true);
    }
  }

  const disputes = useMemo(
    () => missions.filter((m) => m.wasDisputed).length,
    [missions]
  );
  const successRate = useMemo(
    () =>
      missions.length
        ? Math.round(((missions.length - disputes) / missions.length) * 100)
        : 0,
    [missions, disputes]
  );
  const skillCount = profileSkills.length;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <Link
          href="/gigs"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-800/60 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>
      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="h-8 bg-gray-800/50 rounded w-1/3" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="h-72 rounded-xl bg-gray-800/30" />
            <div className="h-72 rounded-xl bg-gray-800/20 lg:col-span-2" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-6 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2 space-y-8">
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-5">
              <div className="flex items-start gap-4">
                {profile?.profilePicCID ? (
                  <Image
                    src={
                      toGatewayUrl(profile.profilePicCID) ||
                      profile.profilePicCID.replace(
                        /^ipfs:\/\//,
                        "https://ipfs.io/ipfs/"
                      )
                    }
                    alt="Profile avatar"
                    width={72}
                    height={72}
                    className="w-18 h-18 rounded-full border border-white/10 object-cover"
                    unoptimized
                  />
                ) : profileMeta?.avatar ? (
                  <Image
                    src={toGatewayUrl(profileMeta.avatar) || profileMeta.avatar}
                    alt="Profile avatar"
                    width={72}
                    height={72}
                    className="w-18 h-18 rounded-full border border-white/10 object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="w-18 h-18 rounded-full border border-white/10 bg-gray-800 flex items-center justify-center">
                    <UserCircle2 className="w-10 h-10 text-gray-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight flex flex-wrap items-center gap-3">
                    <span className="truncate max-w-[260px]">
                      {profile?.username
                        ? `@${profile.username}`
                        : profileMeta?.name ||
                          formatAddress(resolvedParams.address)}
                    </span>
                    {profile?.isVerified && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-300 text-[11px] inline-flex items-center gap-1">
                        <BadgeCheck className="w-3.5 h-3.5" />
                        Verified
                      </span>
                    )}
                    {isBoosted && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] inline-flex items-center gap-1">
                        <Rocket className="w-3.5 h-3.5" />
                        Boosted
                      </span>
                    )}
                  </h1>
                  {profile?.username && profileMeta?.name && (
                    <p className="text-xs text-gray-500 truncate max-w-[280px]">
                      {profileMeta.name}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                    <span className="px-2 py-0.5 rounded-full bg-gray-800/70">
                      {skillCount} skills
                    </span>
                    {avgRating !== null && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-800/70 inline-flex items-center gap-1 text-yellow-300">
                        <Star className="w-3 h-3" />
                        {avgRating.toFixed(2)}
                      </span>
                    )}
                    {profile?.portfolioURIs &&
                      profile.portfolioURIs.length > 0 && (
                        <Link
                          href={
                            toGatewayUrl(profile.portfolioURIs[0]) ||
                            profile.portfolioURIs[0]
                          }
                          target="_blank"
                          className="px-2 py-0.5 rounded-full bg-gray-800/70 inline-flex items-center gap-1 hover:text-white"
                        >
                          <LinkIcon className="w-3 h-3" />
                          Portfolio
                        </Link>
                      )}
                  </div>
                </div>
              </div>
              {profile?.bio && (
                <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {profile.bio}
                </p>
              )}
              {profileSkills.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {profileSkills.slice(0, 12).map((s, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full bg-gray-800/60 text-[10px] text-gray-300"
                    >
                      {s}
                    </span>
                  ))}
                  {profileSkills.length > 12 && (
                    <span className="text-[10px] text-gray-500">
                      +{profileSkills.length - 12}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <Briefcase className="w-4 h-4" /> Recent Gigs
                </div>
                {listings.length > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {listings.length}/{myListingRefs.length}
                  </span>
                )}
              </div>
              {listings.length === 0 ? (
                <p className="text-xs text-gray-500">No gigs yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {listings.map((item, idx) => (
                      <Link
                        key={idx}
                        href={`/gigs/${String(item.listing.id)}`}
                        className="group rounded-lg border border-white/10 bg-gray-950/40 hover:border-white/20 transition-colors overflow-hidden flex flex-col"
                      >
                        {item.cover && (
                          <Image
                            src={item.cover}
                            alt={item.title}
                            width={640}
                            height={160}
                            unoptimized
                            className="w-full h-36 object-cover border-b border-white/10 group-hover:opacity-90 transition"
                          />
                        )}
                        <div className="p-3 space-y-1">
                          <p className="font-medium text-sm truncate text-gray-200">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            Created {timeAgo(Number(item.listing.createdAt))}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {listings.length < myListingRefs.length && (
                    <div className="pt-2">
                      <LoadingButton
                        onClick={loadMoreListings}
                        loading={loadingMoreListings}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-950/70 px-4 py-2 text-xs font-medium hover:bg-gray-900 disabled:opacity-40"
                      >
                        Load more gigs
                      </LoadingButton>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <MessageSquareQuote className="w-4 h-4" /> Reviews
                </div>
                {reviewsTotal > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {reviews.length}/{reviewsTotal}
                  </span>
                )}
              </div>
              {reviews.length === 0 ? (
                <p className="text-xs text-gray-500">No reviews yet.</p>
              ) : (
                <>
                  <div className="space-y-3">
                    {reviews.map((r, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-white/10 bg-gray-950/50 p-4 text-xs space-y-2"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1 text-yellow-300">
                            <Star className="w-4 h-4 fill-yellow-300 text-yellow-300" />
                            <span className="font-medium">{r.rating}</span>
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {r.timestamp
                              ? timeAgo(Math.floor(r.timestamp))
                              : ""}
                          </div>
                        </div>
                        {r.text && (
                          <p className="text-gray-300 leading-relaxed">
                            {truncateText(r.text, 180)}
                          </p>
                        )}
                        <div className="text-[10px] text-gray-500">
                          Reviewer {formatAddress(r.reviewer)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {reviews.length < reviewsTotal && (
                    <div className="pt-2">
                      <LoadingButton
                        onClick={loadMoreReviews}
                        loading={loadingMoreReviews}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-950/70 px-4 py-2 text-xs font-medium hover:bg-gray-900 disabled:opacity-40"
                      >
                        Load more reviews
                      </LoadingButton>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <aside className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <Target className="w-4 h-4" /> Mission Stats
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-medium text-gray-200">
                    {missions.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Disputed</span>
                  <span className="font-medium text-red-300">{disputes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Success</span>
                  <span className="font-medium text-emerald-300">
                    {successRate}%
                  </span>
                </div>
              </div>
              {missions.length > 0 && (
                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500">
                    <History className="w-3 h-3" /> Recent
                  </div>
                  <div className="space-y-1">
                    {missions.slice(0, 3).map((m, i) => (
                      <div
                        key={i}
                        className="flex justify-between text-[10px] text-gray-400"
                      >
                        <span className="truncate">
                          Escrow #{m.escrowId.toString()}
                        </span>
                        <span className="text-gray-500">
                          {timeAgo(Number(m.completedAt))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <Award className="w-4 h-4" /> Badges
              </div>
              {badges.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {badges.map((badge, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full bg-yellow-600/30 text-yellow-200 text-[10px] tracking-wide"
                    >
                      {Badge[badge] || "NONE"}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-500">No badges yet.</p>
              )}
            </div>
            {isOwner && (
              <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <Rocket className="w-4 h-4" /> Boost Profile
                </div>
                {boostParams ? (
                  <div className="text-[11px] space-y-1 text-gray-400">
                    <div>
                      Price{" "}
                      <span className="text-gray-200 font-medium">
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
                      Duration{" "}
                      <span className="text-gray-200 font-medium">
                        {boostParams.duration
                          ? Math.round(Number(boostParams.duration) / 86400)
                          : 0}{" "}
                        d
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500">
                    Loading parameters…
                  </p>
                )}
                <LoadingButton
                  onClick={handleBuyBoost}
                  loading={boosting}
                  disabled={!boostParams || boosting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {boosting ? "Processing…" : "Buy Boost"}
                </LoadingButton>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Boost increases profile visibility for the duration.
                </p>
              </div>
            )}
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <UserCircle2 className="w-4 h-4" /> Contact
              </div>
              <p className="text-[11px] text-gray-400">
                Wallet {formatAddress(resolvedParams.address)}
              </p>
              <div className="flex gap-2">
                <Link
                  href={`/chat/${encodeURIComponent(resolvedParams.address)}`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600/90 hover:bg-blue-600 transition-colors px-4 py-2 text-xs font-medium text-white"
                >
                  Message
                </Link>
                <Link
                  href={`/create?prefill=brief&to=${encodeURIComponent(
                    resolvedParams.address
                  )}`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500/90 hover:bg-indigo-500 transition-colors px-4 py-2 text-xs font-medium text-white"
                >
                  Request Quote
                </Link>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
