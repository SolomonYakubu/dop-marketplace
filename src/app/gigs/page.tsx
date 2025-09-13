"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CONTRACT_ADDRESSES } from "@/lib/contract";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import {
  Listing,
  ListingType,
  type EnrichedListing,
  type ListingMetadata,
} from "@/types/marketplace";
import {
  formatAddress,
  toGatewayUrl,
  getRpcUrl,
  timeAgo,
  getCategoryLabel,
  fetchWithTimeout,
} from "@/lib/utils";
import { useChainModal } from "@rainbow-me/rainbowkit";
import {
  RefreshCcw,
  Sparkles,
  Tag as TagIcon,
  Filter as FilterIcon,
  Clock3,
  CircleOff,
  ArrowRight,
  Loader2,
  ChevronRight,
  UserCircle2,
} from "lucide-react";
import clsx from "clsx";

// UI primitives (file-local)
const badgeBase =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide";
const badgeVariants: Record<string, string> = {
  neutral: "bg-gray-800/70 text-gray-300",
  boosted: "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30",
  inactive: "bg-red-500/15 text-red-400",
  category: "bg-gray-700/50 text-gray-200",
};
function Badge({
  variant = "neutral",
  children,
}: {
  variant?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        badgeBase,
        badgeVariants[variant] || badgeVariants.neutral
      )}
    >
      {children}
    </span>
  );
}
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export default function GigsPage() {
  const router = useRouter();
  const { contract } = useMarketplaceContract();
  const { chain } = useAccount();
  const { openChainModal } = useChainModal();

  const currentChainId = chain?.id;
  const hasMainnetAddr =
    !!CONTRACT_ADDRESSES[2741 as keyof typeof CONTRACT_ADDRESSES];
  const hasTestnetAddr =
    !!CONTRACT_ADDRESSES[11124 as keyof typeof CONTRACT_ADDRESSES];
  const readChainId = useMemo(() => {
    if (!currentChainId) return 11124;
    const addr =
      CONTRACT_ADDRESSES[currentChainId as keyof typeof CONTRACT_ADDRESSES];
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) return currentChainId;
    if (hasTestnetAddr) return 11124;
    return currentChainId;
  }, [currentChainId, hasTestnetAddr]);

  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    category: "all",
    serviceType: "all",
    priceRange: "all",
    showActiveOnly: true,
    showBoostedFirst: true,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cache of creator profiles (minimal)
  const [creatorProfiles, setCreatorProfiles] = useState<
    Record<
      string,
      { username?: string; profilePicCID?: string; loaded: boolean }
    >
  >({});

  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(readChainId)),
    [readChainId]
  );

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let allListings: Listing[] = [];
      try {
        allListings = await (
          contract as unknown as {
            fetchAllListingsByIndex: () => Promise<Listing[]>;
          }
        ).fetchAllListingsByIndex?.();
      } catch {}
      if (!allListings || allListings.length === 0) {
        try {
          allListings = await (
            contract as unknown as {
              fetchAllListingsByIdScan: () => Promise<Listing[]>;
            }
          ).fetchAllListingsByIdScan?.();
        } catch {}
      }
      const gigs = (allListings || []).filter(
        (l) => Number(l.listingType) === ListingType.GIG
      );
      const METADATA_TIMEOUT = 4000;
      const enriched: EnrichedListing[] = await Promise.all(
        gigs.map(async (listing) => {
          try {
            let metadata: ListingMetadata | undefined;
            if (listing.metadataURI) {
              const gateway = toGatewayUrl(listing.metadataURI);
              if (gateway) {
                try {
                  const resp = await fetchWithTimeout(
                    gateway,
                    METADATA_TIMEOUT
                  );
                  const txt = await resp.text();
                  try {
                    metadata = JSON.parse(txt) as ListingMetadata;
                  } catch {
                    metadata = {
                      title: `Gig #${listing.id.toString()}`,
                      description: txt,
                      category: Number(listing.category),
                      type: ListingType.GIG,
                    } as ListingMetadata;
                  }
                } catch {
                  metadata = {
                    title: `Gig #${listing.id.toString()}`,
                    description: "",
                    category: Number(listing.category),
                    type: ListingType.GIG,
                  } as ListingMetadata;
                }
              }
            }
            let isBoosted = false;
            try {
              isBoosted =
                Number(listing.boostExpiry) >= Math.floor(Date.now() / 1000);
            } catch {}
            return {
              ...listing,
              metadata,
              isBoosted,
            } satisfies EnrichedListing;
          } catch {
            return {
              ...listing,
              metadata: undefined,
              isBoosted: false,
            } as EnrichedListing;
          }
        })
      );
      setListings(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gigs");
    } finally {
      setLoading(false);
    }
  }, [contract]);

  useEffect(() => {
    loadListings();
  }, [loadListings, readChainId, provider]);

  // Fetch minimal profiles (username + avatar) for creators
  useEffect(() => {
    if (!contract) return;
    const creators = Array.from(
      new Set(listings.map((l) => l.creator.toLowerCase()))
    );
    const toFetch = creators.filter((c) => !creatorProfiles[c]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          toFetch.map(async (addr) => {
            try {
              const p = (await contract.getProfile(addr)) as unknown as {
                joinedAt?: bigint;
                username?: string;
                profilePicCID?: string;
              };
              if (!p || !p.joinedAt || p.joinedAt === BigInt(0)) {
                return [addr, { loaded: true }] as const;
              }
              return [
                addr,
                {
                  username: p.username,
                  profilePicCID: p.profilePicCID,
                  loaded: true,
                },
              ] as const;
            } catch {
              return [addr, { loaded: true }] as const;
            }
          })
        );
        if (cancelled) return;
        setCreatorProfiles((prev) => {
          const next = { ...prev };
          for (const [addr, data] of results) next[addr] = data;
          return next;
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [contract, listings, creatorProfiles]);

  const filteredListings = useMemo(() => {
    let filtered = [...listings];
    if (filters.category !== "all") {
      const cat = parseInt(filters.category);
      filtered = filtered.filter((l) => l.category === BigInt(cat));
    }
    if (filters.serviceType !== "all")
      filtered = filtered.filter(
        (l) => l.metadata?.serviceType === filters.serviceType
      );
    if (filters.priceRange !== "all") {
      filtered = filtered.filter((l) => {
        const price = l.metadata?.price?.amount;
        if (price == null) return true;
        switch (filters.priceRange) {
          case "0-100":
            return price <= 100;
          case "100-500":
            return price > 100 && price <= 500;
          case "500-2000":
            return price > 500 && price <= 2000;
          case "2000+":
            return price > 2000;
          default:
            return true;
        }
      });
    }
    if (filters.showActiveOnly) filtered = filtered.filter((l) => l.active);
    filtered.sort((a, b) => {
      if (filters.showBoostedFirst) {
        if (a.isBoosted && !b.isBoosted) return -1;
        if (!a.isBoosted && b.isBoosted) return 1;
      }
      return Number(b.createdAt - a.createdAt);
    });
    return filtered;
  }, [listings, filters]);

  // Derive active filter summary (excluding defaults)
  const { activeCount, activePills } = useMemo(() => {
    const pills: string[] = [];
    if (filters.category !== "all") pills.push(`Cat: ${filters.category}`);
    if (filters.serviceType !== "all")
      pills.push(`Type: ${filters.serviceType}`);
    if (filters.priceRange !== "all")
      pills.push(`Price: ${filters.priceRange}`);
    if (!filters.showActiveOnly) pills.push("Inactive incl.");
    if (!filters.showBoostedFirst) pills.push("No boost sort");
    return { activeCount: pills.length, activePills: pills };
  }, [filters]);

  const showingFallback = Boolean(
    currentChainId &&
      currentChainId !== readChainId &&
      !hasMainnetAddr &&
      hasTestnetAddr
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading gigs...
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{error}</p>
          <div className="flex items-center justify-center gap-3 mb-4">
            {openChainModal && (
              <button
                onClick={openChainModal}
                className="px-4 py-2 border border-white/10 rounded-lg hover:bg-white/5"
              >
                Switch Network
              </button>
            )}
            <button
              onClick={loadListings}
              className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
            >
              Retry
            </button>
          </div>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Ensure correct contract addresses are configured for this network.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {showingFallback && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-600/40 bg-yellow-500/10 text-yellow-300 text-xs">
          Unsupported wallet network. Showing data from fallback network.
        </div>
      )}
      <div className="flex flex-col gap-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Gigs</h1>
            <p className="text-sm text-gray-400">
              Browse available services from creators.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className={clsx(
                btnBase,
                "border border-white/10 bg-gray-900 px-3 py-2 text-gray-200 hover:bg-gray-800"
              )}
            >
              <FilterIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
              {activeCount > 0 && (
                <span className="ml-1 text-[10px] rounded bg-white/10 px-1.5 py-0.5">
                  {activeCount}
                </span>
              )}
            </button>
            <button
              onClick={loadListings}
              className={clsx(
                btnBase,
                "border border-white/10 bg-gray-900 px-4 py-2 text-gray-200 hover:bg-gray-800"
              )}
            >
              <RefreshCcw className="w-4 h-4" /> Refresh
            </button>
            <Link
              href="/create"
              className={clsx(
                btnBase,
                "bg-white text-black px-4 py-2 hover:opacity-90"
              )}
            >
              <ArrowRight className="w-4 h-4" /> Create
            </Link>
          </div>
        </div>

        {/* Collapsible Filters */}
        <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 overflow-hidden">
          {/* Summary / header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
              <FilterIcon className="w-4 h-4" /> Filters
              {activePills.length > 0 && !filtersOpen && (
                <div className="flex flex-wrap gap-1 ml-2 max-w-[70vw]">
                  {activePills.slice(0, 4).map((p) => (
                    <span
                      key={p}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300 border border-white/10"
                    >
                      {p}
                    </span>
                  ))}
                  {activePills.length > 4 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                      +{activePills.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className="text-[11px] text-gray-400 hover:text-gray-200 inline-flex items-center gap-1"
              aria-label={filtersOpen ? "Hide filters" : "Show filters"}
            >
              {filtersOpen ? "Hide" : "Show"}
            </button>
          </div>
          {filtersOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-white/5">
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Category</label>
                  <select
                    value={filters.category}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, category: e.target.value }))
                    }
                    className="w-full rounded-md border border-white/10 bg-gray-950/60 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/10"
                  >
                    <option value="all">All Categories</option>
                    <option value="1">Developer</option>
                    <option value="2">Artist</option>
                    <option value="3">KOL</option>
                    <option value="0">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Service Type</label>
                  <select
                    value={filters.serviceType}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, serviceType: e.target.value }))
                    }
                    className="w-full rounded-md border border-white/10 bg-gray-950/60 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/10"
                  >
                    <option value="all">All Types</option>
                    <option value="one-time">One-time</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Price Range</label>
                  <select
                    value={filters.priceRange}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, priceRange: e.target.value }))
                    }
                    className="w-full rounded-md border border-white/10 bg-gray-950/60 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/10"
                  >
                    <option value="all">All Prices</option>
                    <option value="0-100">$0 - $100</option>
                    <option value="100-500">$100 - $500</option>
                    <option value="500-2000">$500 - $2,000</option>
                    <option value="2000+">$2,000+</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-300 pt-5 md:pt-0">
                  <input
                    type="checkbox"
                    checked={filters.showActiveOnly}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        showActiveOnly: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-white/10 bg-gray-900 text-white focus:ring-white/20"
                  />
                  Active only
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-300 pt-0 md:pt-5 xl:pt-0">
                  <input
                    type="checkbox"
                    checked={filters.showBoostedFirst}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        showBoostedFirst: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-white/10 bg-gray-900 text-white focus:ring-white/20"
                  />
                  Boosted first
                </label>
              </div>
              {activeCount > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {activePills.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300 border border-white/10"
                    >
                      {p}
                    </span>
                  ))}
                  <button
                    onClick={() =>
                      setFilters({
                        category: "all",
                        serviceType: "all",
                        priceRange: "all",
                        showActiveOnly: true,
                        showBoostedFirst: true,
                      })
                    }
                    className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mb-4 text-sm text-gray-400">
        {filteredListings.length} gig{filteredListings.length === 1 ? "" : "s"}{" "}
        found
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredListings.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-400 mb-4">
              No gigs found matching your criteria.
            </p>
            <Link
              href="/create"
              className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
            >
              Create the first gig
            </Link>
          </div>
        ) : (
          filteredListings.map((listing) => {
            const cover = toGatewayUrl(listing.metadata?.image || null);
            return (
              <div
                key={listing.id.toString()}
                className={clsx(
                  "rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-5 flex flex-col h-full transition-shadow hover:shadow-md",
                  listing.isBoosted && "ring-1 ring-yellow-500/30"
                )}
              >
                <div className="flex flex-col h-full">
                  {cover && (
                    <div className="relative mb-4 w-full h-40 sm:h-44 rounded-lg overflow-hidden border border-white/10 bg-gray-900">
                      <Image
                        src={cover}
                        alt={
                          listing.metadata?.title ||
                          `Gig #${listing.id.toString()}`
                        }
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        unoptimized
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                      <div className="absolute inset-0 ring-1 ring-white/10" />
                      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />
                    </div>
                  )}
                  <div className="mb-4">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {listing.isBoosted && (
                        <Badge variant="boosted">
                          <Sparkles className="w-3.5 h-3.5" />
                          Boosted
                        </Badge>
                      )}
                      <Badge variant="category">
                        <TagIcon className="w-3.5 h-3.5" />
                        {getCategoryLabel(Number(listing.category))}
                      </Badge>
                      {!listing.active && (
                        <Badge variant="inactive">
                          <CircleOff className="w-3.5 h-3.5" />
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold mb-2 line-clamp-2 leading-snug">
                      <Link
                        href={`/gigs/${listing.id.toString()}`}
                        className="hover:text-gray-300 transition-colors"
                      >
                        {listing.metadata?.title ||
                          `Gig #${listing.id.toString()}`}
                      </Link>
                    </h3>
                    <p className="text-gray-400 text-sm line-clamp-3 mb-3">
                      {listing.metadata?.description ||
                        "No description available"}
                    </p>
                  </div>
                  {listing.metadata?.tags &&
                    listing.metadata.tags.length > 0 && (
                      <div className="mb-4">
                        <div className="flex flex-wrap gap-1">
                          {listing.metadata.tags.slice(0, 4).map((tag, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-gray-900 text-gray-300 text-xs rounded"
                            >
                              {tag}
                            </span>
                          ))}
                          {listing.metadata.tags.length > 4 && (
                            <span className="px-2 py-1 bg-gray-900 text-gray-400 text-xs rounded">
                              +{listing.metadata.tags.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  <div className="mb-4">
                    {listing.metadata?.price && (
                      <div className="mb-2">
                        <p className="text-lg font-bold text-green-400">
                          ${listing.metadata.price.amount}
                          {listing.metadata.price.per && (
                            <span className="text-sm text-gray-400">
                              /{listing.metadata.price.per}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>
                        {listing.metadata?.serviceType && (
                          <span className="capitalize">
                            {listing.metadata.serviceType}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1">
                        {listing.metadata?.deliveryTime && (
                          <>
                            <Clock3 className="w-3.5 h-3.5" />
                            {listing.metadata.deliveryTime} delivery
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/profile/${listing.creator}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            router.push(`/profile/${listing.creator}`);
                          }
                        }}
                        className="inline-flex items-center gap-2 min-w-0 hover:text-gray-300 transition-colors"
                      >
                        {(() => {
                          const key = listing.creator.toLowerCase();
                          const prof = creatorProfiles[key];
                          if (prof?.profilePicCID) {
                            const src =
                              toGatewayUrl(prof.profilePicCID) ||
                              prof.profilePicCID.replace(
                                /^ipfs:\/\//,
                                "https://ipfs.io/ipfs/"
                              );
                            return (
                              <div className="relative h-7 w-7 rounded-full overflow-hidden border border-white/10 shrink-0">
                                <Image
                                  src={src}
                                  alt={
                                    prof.username
                                      ? `@${prof.username}`
                                      : "profile avatar"
                                  }
                                  fill
                                  sizes="28px"
                                  className="object-cover"
                                  unoptimized
                                />
                              </div>
                            );
                          }
                          return (
                            <div className="h-7 w-7 rounded-full border border-white/10 bg-gray-800 flex items-center justify-center shrink-0">
                              <UserCircle2 className="w-4.5 h-4.5 text-gray-500" />
                            </div>
                          );
                        })()}
                        <span className="truncate max-w-[120px]">
                          {(() => {
                            const key = listing.creator.toLowerCase();
                            const prof = creatorProfiles[key];
                            if (!prof || !prof.loaded) return "Loading…";
                            if (prof.username) return `@${prof.username}`;
                            return formatAddress(listing.creator);
                          })()}
                        </span>
                      </span>
                      <span>{timeAgo(Number(listing.createdAt))}</span>
                    </div>
                    <Link
                      href={`/gigs/${listing.id.toString()}`}
                      className={clsx(
                        btnBase,
                        "w-full border border-white/10 hover:border-gray-400/40 px-4 py-2 text-gray-200 hover:text-white bg-transparent"
                      )}
                    >
                      View Details <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {filteredListings.length >= 50 && (
        <div className="text-center mt-8">
          <button
            onClick={loadListings}
            className="px-6 py-2 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
