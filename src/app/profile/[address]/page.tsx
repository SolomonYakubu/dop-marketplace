"use client";

import Link from "next/link";
import {
  use,
  useEffect,
  useMemo,
  useState,
  useCallback,
  ChangeEvent,
} from "react";
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
  UserType,
} from "@/types/marketplace";
import { getBadgeLabel } from "@/lib/utils";
import {
  toGatewayUrl,
  formatAddress,
  truncateText,
  formatTokenAmountWithSymbol,
  timeAgo,
  getRpcUrl,
} from "@/lib/utils";
import { createReceiptNotifier } from "@/lib/txReceipt";
import { useToast, useAsyncOperation } from "@/hooks/useErrorHandling";
import { LoadingButton } from "@/components/Loading";
import Image from "next/image";
import {
  ArrowLeft,
  UserCircle2,
  BadgeCheck,
  Star,
  Target,
  History,
  Rocket,
  Briefcase,
  MessageSquareQuote,
  Link as LinkIcon,
  Loader2,
  X as XIcon,
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
  const notifyReceipt = useMemo(
    () => createReceiptNotifier(toast, { chain, chainId }),
    [toast, chain, chainId]
  );

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
  const [dynamicProfilePrice, setDynamicProfilePrice] = useState<bigint | null>(
    null
  );
  const [dopToken, setDopToken] = useState("");
  const [dopDecimals, setDopDecimals] = useState(18);
  const [listingBoostPrice, setListingBoostPrice] = useState<bigint | null>(
    null
  );
  const [listingBoostDurationDays, setListingBoostDurationDays] = useState<
    number | null
  >(null);
  const [boostingListingId, setBoostingListingId] = useState<bigint | null>(
    null
  );
  // Edit panel state (unified)
  const [editOpen, setEditOpen] = useState(false);
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioUri, setPortfolioUri] = useState("");
  const [userType, setUserType] = useState<UserType>(UserType.DEVELOPER);
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  // Modal mount helper to prevent SSR mismatch on portal-like UI
  const [mounted, setMounted] = useState(false);

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
          const norm = Array.isArray(b) ? b.map((x) => Number(x)) : [];
          setBadges(norm as unknown as Badge[]);
        } catch {}
        // Seed edit form with loaded profile (owner only prefill)
        try {
          if (p) {
            setBio(p.bio || "");
            setSkills(
              Array.isArray(p.skills) ? (p.skills as string[]).join(", ") : ""
            );
            setPortfolioUri(p.portfolioURIs?.[0] || "");
            const ut = (p as unknown as { userType?: UserType }).userType;
            setUserType(ut ?? UserType.DEVELOPER);
            setUsername(p.username || "");
            if (p.profilePicCID) {
              const gw = toGatewayUrl(p.profilePicCID) || p.profilePicCID;
              setAvatarPreview(gw);
            } else {
              setAvatarPreview("");
            }
          } else {
            // No profile yet
            setBio("");
            setSkills("");
            setPortfolioUri("");
            setUserType(UserType.DEVELOPER);
            setUsername("");
            setAvatarPreview("");
          }
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
          // Fetch dynamic price (can change as others boost)
          try {
            const dyn = await contract!.currentProfileBoostPrice();
            setDynamicProfilePrice(dyn);
          } catch {}
          // Listing boost dynamic price and duration for UI
          try {
            const p = await contract!.currentListingBoostPrice();
            setListingBoostPrice(p);
          } catch {}
          try {
            const lp = await contract!.getBoostParams();
            setListingBoostDurationDays(
              Math.round(Number(lp.duration ?? 0) / 86400)
            );
          } catch {}
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

  // Mark mounted for modal rendering safety
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-open edit for new owners without profile/username
  useEffect(() => {
    if (loading) return;
    if (!isOwner) return;
    const noProfile = !profile;
    const zeroJoin =
      profile?.joinedAt === undefined || profile?.joinedAt === BigInt(0);
    const emptyCore =
      !profile?.username &&
      !profile?.bio &&
      (!Array.isArray(profile?.skills) ||
        (profile?.skills as string[]).length === 0);
    if (noProfile || zeroJoin || emptyCore) {
      setEditOpen(true);
    }
  }, [loading, isOwner, profile]);

  async function handleBuyBoost() {
    if (!isOwner) {
      toast.showError("Not allowed", "You can only boost your own profile.");
      return;
    }
    const toPay = dynamicProfilePrice ?? boostParams?.price;
    if (!toPay) {
      toast.showError("Unavailable", "Boost price not available.");
      return;
    }
    const receipt = await execute(async () => {
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
      if (current < toPay) {
        const tx = await erc20.approve(spender, toPay);
        const approvalReceipt = (await tx.wait?.()) ?? tx;
        notifyReceipt(
          "Approval complete",
          "Token allowance updated for boosting",
          approvalReceipt
        );
      }
      return await contract!.buyProfileBoost(toPay);
    });
    if (receipt) {
      notifyReceipt(
        "Profile Boosted",
        "Your profile boost is now active.",
        receipt
      );
      setIsBoosted(true);
      // refresh dynamic price cache for UI
      try {
        const dyn = await contract!.currentProfileBoostPrice({ force: true });
        setDynamicProfilePrice(dyn);
      } catch {}
    }
  }

  async function boostListing(listingId: bigint) {
    if (!isOwner) {
      toast.showError("Not allowed", "You can only boost your own listing.");
      return;
    }
    if (!listingBoostPrice || listingBoostPrice <= BigInt(0)) {
      toast.showError("Unavailable", "Boost price not available.");
      return;
    }
    const receipt = await execute(async () => {
      setBoostingListingId(listingId);
      try {
        let dop = dopToken;
        if (!dop) dop = await contract!.getDopToken();
        if (!dop) throw new Error("DOP token address is not configured");
        const erc20 = contract!.getErc20(dop) as unknown as Erc20;
        const owner = address!;
        const spender = contract!.contractAddress;
        const current: bigint = await erc20.allowance(owner, spender);
        if (current < listingBoostPrice) {
          const tx0 = await erc20.approve(spender, listingBoostPrice);
          const approvalReceipt = (await tx0.wait?.()) ?? tx0;
          notifyReceipt(
            "Approval complete",
            "Token allowance updated for boosting",
            approvalReceipt
          );
        }
        const boostReceipt = await contract!.buyBoost(
          listingId,
          listingBoostPrice
        );
        try {
          const p = await contract!.currentListingBoostPrice({ force: true });
          setListingBoostPrice(p);
        } catch {}
        return boostReceipt;
      } finally {
        setBoostingListingId(null);
      }
    });
    if (receipt) {
      notifyReceipt("Listing boosted", undefined, receipt);
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
  const editSkillCount = useMemo(
    () => skills.split(",").filter((s) => s.trim()).length,
    [skills]
  );
  const bioRemaining = 600 - bio.length;

  function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setAvatarFile(file);
    if (file) setAvatarPreview(URL.createObjectURL(file));
  }

  const handleAvatarUploadIfNeeded = useCallback(async (): Promise<
    string | undefined
  > => {
    if (!avatarFile) return profile?.profilePicCID;
    try {
      setUploadingAvatar(true);
      const form = new FormData();
      form.append("file", avatarFile);
      form.append("type", "avatar");
      const res = await fetch("/api/ipfs", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json();
      const cid = json.cid || json.Hash || json.CID;
      if (!cid) throw new Error("CID missing in response");
      return `ipfs://${cid}`;
    } finally {
      setUploadingAvatar(false);
    }
  }, [avatarFile, profile?.profilePicCID]);

  const saveProfile = useCallback(async () => {
    if (!address) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    try {
      setSaving(true);
      const skillsArr = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const avatarCid = await handleAvatarUploadIfNeeded();
      let profileReceipt: unknown;
      if (profile && profile.joinedAt && profile.joinedAt !== BigInt(0)) {
        profileReceipt = await contract!.updateProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          avatarCid
        );
        // Optional username update
        if (username && username !== (profile.username || "")) {
          try {
            type UsernameCapable = {
              setUsername?: (u: string) => Promise<unknown>;
            };
            const underlying: UsernameCapable | undefined = (
              contract as unknown as { contract?: UsernameCapable }
            ).contract;
            if (underlying?.setUsername) {
              const usernameTx = await underlying.setUsername(username);
              const waited =
                typeof (usernameTx as { wait?: () => Promise<unknown> })
                  .wait === "function"
                  ? await (
                      usernameTx as unknown as { wait: () => Promise<unknown> }
                    ).wait()
                  : undefined;
              notifyReceipt(
                "Username updated",
                undefined,
                waited ?? usernameTx
              );
            }
          } catch (err) {
            console.warn("Username update failed", err);
          }
        }
      } else {
        if (!username.trim())
          throw new Error("Username required for new profile");
        profileReceipt = await contract!.createProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          userType,
          username,
          avatarCid || ""
        );
      }
      notifyReceipt(
        "Profile saved",
        "Profile saved successfully!",
        profileReceipt
      );
      // Refresh view
      try {
        const refreshed = (await contract!.getProfile(
          address
        )) as unknown as OnchainUserProfile;
        if (refreshed) setProfile(refreshed);
      } catch {}
      setEditOpen(false);
    } catch (e: unknown) {
      toast.showContractError?.("Error", e, "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [
    address,
    bio,
    contract,
    portfolioUri,
    profile,
    skills,
    toast,
    userType,
    username,
    notifyReceipt,
    handleAvatarUploadIfNeeded,
  ]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <Link
            href="/gigs"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-800/60 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        </div>
        {/* Removed top-right Edit; actions moved to header card */}
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
              <div className="flex flex-col sm:flex-row items-start gap-4">
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
                  <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap w-full">
                    <div className="min-w-0 space-y-1 flex-1">
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
                    <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto sm:justify-end">
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setEditOpen(true)}
                          className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-gray-900/60 hover:bg-gray-900 text-gray-200 px-3 py-2 text-xs w-fit md:w-full sm:w-auto"
                        >
                          Edit Profile
                        </button>
                      )}

                      <Link
                        href={`/chat/${encodeURIComponent(
                          resolvedParams.address
                        )}`}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600/90 hover:bg-blue-600 transition-colors px-3 py-2 text-xs font-medium text-white w-fit md:w-full sm:w-auto"
                      >
                        <MessageSquareQuote className="w-3.5 h-3.5" />
                        Message
                      </Link>
                    </div>
                  </div>
                  {/* Badges row under profile with label */}
                  <div className="mt-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">
                      Badges
                    </div>
                    {badges.length > 0 ? (
                      <div className="-mx-1 sm:mx-0 overflow-x-auto sm:overflow-visible whitespace-nowrap sm:whitespace-normal flex sm:flex-wrap items-center gap-1 px-1">
                        {badges.slice(0, 12).map((badge, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-full bg-yellow-600/30 text-yellow-200 text-[10px] tracking-wide"
                          >
                            {getBadgeLabel(badge)}
                          </span>
                        ))}
                        {badges.length > 12 && (
                          <span className="text-[10px] text-gray-500">
                            +{badges.length - 12}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-gray-500">
                        No badges yet.
                      </p>
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
              {isOwner && (
                <LoadingButton
                  onClick={handleBuyBoost}
                  loading={boosting}
                  disabled={!boostParams || boosting}
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-amber-400/90 hover:bg-amber-400 text-black px-3 py-2 text-xs font-medium w-full sm:w-auto"
                >
                  {boosting
                    ? "Boosting…"
                    : dynamicProfilePrice ?? boostParams?.price
                    ? `Boost • ${formatTokenAmountWithSymbol(
                        (dynamicProfilePrice ?? boostParams!.price) as bigint,
                        dopToken || tokenAddresses.DOP || ethers.ZeroAddress,
                        {
                          tokens: tokenAddresses,
                          decimals: dopDecimals,
                        }
                      )}`
                    : "Boost"}
                </LoadingButton>
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
                          {isOwner && (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  boostListing(item.listing.id);
                                }}
                                disabled={
                                  !listingBoostPrice ||
                                  boostingListingId === item.listing.id
                                }
                                className="inline-flex items-center gap-2 rounded border border-white/10 bg-yellow-500 text-black text-[11px] px-2.5 py-1 hover:bg-yellow-400 disabled:opacity-50"
                              >
                                {boostingListingId === item.listing.id
                                  ? "Boosting…"
                                  : listingBoostPrice
                                  ? `Boost • ${formatTokenAmountWithSymbol(
                                      listingBoostPrice,
                                      dopToken ||
                                        tokenAddresses.DOP ||
                                        ethers.ZeroAddress,
                                      {
                                        tokens: tokenAddresses,
                                        decimals: dopDecimals,
                                      }
                                    )}`
                                  : "Boost"}
                              </button>
                              {listingBoostDurationDays != null && (
                                <span className="ml-2 text-[10px] text-gray-500">
                                  {listingBoostDurationDays} d
                                </span>
                              )}
                            </div>
                          )}
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
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <History className="w-4 h-4" /> Recent Missions
                </div>
                {missions.length > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {Math.min(5, missions.length)}/{missions.length}
                  </span>
                )}
              </div>
              {missions.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No missions completed yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {missions
                    .slice()
                    .sort(
                      (a, b) => Number(b.completedAt) - Number(a.completedAt)
                    )
                    .slice(0, 5)
                    .map((m, i) => {
                      const isUSDC =
                        tokenAddresses.USDC &&
                        m.token.toLowerCase() ===
                          tokenAddresses.USDC.toLowerCase();
                      const isDOP =
                        tokenAddresses.DOP &&
                        m.token.toLowerCase() ===
                          tokenAddresses.DOP.toLowerCase();
                      const decimals = isUSDC ? 6 : dopDecimals;
                      const symbol = isUSDC ? "USDC" : isDOP ? "DOP" : "TOKEN";
                      const amt = (() => {
                        try {
                          return ethers.formatUnits(m.amount, decimals);
                        } catch {
                          return m.amount.toString();
                        }
                      })();
                      const me = resolvedParams.address?.toLowerCase();
                      const counterparty =
                        me && m.client?.toLowerCase() === me
                          ? m.provider
                          : m.client;
                      return (
                        <div
                          key={i}
                          className="rounded-lg border border-white/10 bg-gray-950/50 p-4 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-gray-300">
                              <span className="font-medium">
                                Escrow #{m.escrowId.toString()}
                              </span>
                              {m.wasDisputed && (
                                <span className="px-1.5 py-0.5 rounded bg-red-600/20 text-red-300 text-[10px]">
                                  Disputed
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500">
                              {timeAgo(Number(m.completedAt))}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-gray-400">
                            <span className="inline-flex items-baseline gap-1">
                              <span className="text-gray-300 font-medium">
                                {amt}
                              </span>
                              <span>{symbol}</span>
                            </span>
                            <span className="text-gray-600">•</span>
                            <span className="inline-flex items-center gap-1">
                              with
                              <Link
                                href={`/profile/${encodeURIComponent(
                                  counterparty
                                )}`}
                                className="text-gray-200 hover:underline"
                              >
                                {formatAddress(counterparty)}
                              </Link>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
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
            {/* Edit Profile aside card removed; edit now opens in a modal */}
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
            {/* Badges and Boost Profile aside cards removed; included in header actions */}
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <UserCircle2 className="w-4 h-4" /> Contact
              </div>
              <p className="text-[11px] text-gray-400">
                Wallet {formatAddress(resolvedParams.address)}
              </p>
              <div className="flex gap-2">
                {/* Message button moved to header; keep Request Quote here */}
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
      {/* Edit Profile Modal */}
      {mounted && editOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setEditOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-white/10 bg-gray-950/90 backdrop-blur p-4 sm:p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <UserCircle2 className="w-4 h-4" /> Edit Profile
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="inline-flex items-center justify-center rounded-md p-1 text-gray-400 hover:text-white hover:bg-white/10"
                aria-label="Close"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400">User Type</label>
                <select
                  value={userType}
                  onChange={(e) =>
                    setUserType(Number(e.target.value) as UserType)
                  }
                  disabled={
                    !!profile?.joinedAt && profile.joinedAt !== BigInt(0)
                  }
                  className="w-full rounded-md border border-white/10 bg-gray-950/70 px-2 py-1.5 text-xs"
                >
                  <option value={UserType.PROJECT_OWNER}>Project Owner</option>
                  <option value={UserType.DEVELOPER}>Developer</option>
                  <option value={UserType.ARTIST}>Artist</option>
                  <option value={UserType.KOL}>KOL</option>
                </select>
                {!!profile?.joinedAt && profile.joinedAt !== BigInt(0) && (
                  <p className="text-[10px] text-gray-500">
                    User type is permanent after creation.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400 flex items-center justify-between">
                  Username{" "}
                  <span className="text-[10px] text-gray-500">Changeable</span>
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="unique handle (3-32 chars)"
                  maxLength={32}
                  className="w-full rounded-md border border-white/10 bg-gray-950/70 px-2 py-1.5 text-xs"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400 flex items-center justify-between">
                  Bio{" "}
                  <span className="text-[10px] text-gray-500">
                    {bioRemaining}
                  </span>
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={600}
                  rows={4}
                  className="w-full rounded-md border border-white/10 bg-gray-950/70 px-2 py-1.5 text-xs resize-none"
                  placeholder="Tell people what you do, experience, interests…"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400">
                  Skills (comma separated)
                </label>
                <input
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="React, TypeScript, Solidity, Web3…"
                  className="w-full rounded-md border border-white/10 bg-gray-950/70 px-2 py-1.5 text-xs"
                />
                {editSkillCount > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {skills
                      .split(",")
                      .filter((s) => s.trim())
                      .slice(0, 8)
                      .map((s, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full bg-gray-800/60 text-[10px] text-gray-300"
                        >
                          {s.trim()}
                        </span>
                      ))}
                    {editSkillCount > 8 && (
                      <span className="text-[10px] text-gray-400">
                        +{editSkillCount - 8}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400">
                  Portfolio (URL / IPFS)
                </label>
                <input
                  value={portfolioUri}
                  onChange={(e) => setPortfolioUri(e.target.value)}
                  placeholder="https:// or ipfs://"
                  className="w-full rounded-md border border-white/10 bg-gray-950/70 px-2 py-1.5 text-xs"
                />
                {portfolioUri && (
                  <p className="text-[10px] text-gray-500 break-all flex items-center gap-1">
                    <LinkIcon className="w-3 h-3" />
                    {portfolioUri}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[11px] text-gray-400 flex items-center gap-2">
                  Avatar{" "}
                  {uploadingAvatar && (
                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> uploading
                    </span>
                  )}
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onAvatarChange}
                  className="w-full text-[11px] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-white file:text-black hover:file:opacity-90"
                />
                {avatarPreview && (
                  <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-white/10">
                    <Image
                      src={avatarPreview}
                      alt="avatar preview"
                      width={64}
                      height={64}
                      className="object-cover w-16 h-16"
                    />
                  </div>
                )}
                <p className="text-[10px] text-gray-500">
                  PNG/JPG, &lt;2MB recommended.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditOpen(false)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-gray-900/60 hover:bg-gray-900 text-gray-200 px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveProfile}
                  disabled={
                    saving || uploadingAvatar || (!profile && !username.trim())
                  }
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving
                    ? "Saving…"
                    : profile?.joinedAt && profile.joinedAt !== BigInt(0)
                    ? "Update Profile"
                    : "Create Profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
