"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Filter as FilterIcon,
  Sparkles,
  Tag as TagIcon,
  Briefcase,
  CircleOff,
  Clock3,
  ChevronRight,
  UserCircle2,
} from "lucide-react";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { Listing, ListingType, EnrichedListing } from "@/types/marketplace";
import {
  formatAddress,
  timeAgo,
  getCategoryLabel,
  loadListingMetadataFromURI,
  toGatewayUrl,
} from "@/lib/utils";
import { useChainModal } from "@rainbow-me/rainbowkit";

export default function BriefsPage() {
  const router = useRouter();
  const { openChainModal } = useChainModal();
  const { contract } = useMarketplaceContract();

  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    category: "all",
    showActiveOnly: true,
    showBoostedFirst: true,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Minimal creator profile cache
  const [creatorProfiles, setCreatorProfiles] = useState<
    Record<
      string,
      { username?: string; profilePicCID?: string; loaded: boolean }
    >
  >({});

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let allListings: Listing[] = [];
      try {
        allListings = (await contract?.fetchAllListingsByIndex?.({})) ?? [];
      } catch (err) {
        console.warn("fetchAllListingsByIndex failed:", err);
      }
      if (!allListings || allListings.length === 0) {
        try {
          allListings = (await contract?.fetchAllListingsByIdScan?.({})) ?? [];
        } catch (err) {
          console.warn("fetchAllListingsByIdScan failed:", err);
        }
      }

      const briefs = (allListings || []).filter(
        (listing) => Number(listing.listingType) === ListingType.BRIEF
      );

      const enrichedListings = await Promise.all(
        briefs.map(async (listing) => {
          try {
            const metadata = await loadListingMetadataFromURI(
              listing.metadataURI,
              listing
            );

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
          } catch (e) {
            console.warn("Failed to enrich listing:", e);
            return {
              ...listing,
              metadata: undefined,
              isBoosted: false,
            } satisfies EnrichedListing;
          }
        })
      );

      setListings(enrichedListings);
    } catch (e: unknown) {
      console.error("Failed to load briefs:", e);
      setError(e instanceof Error ? e.message : "Failed to load briefs");
    } finally {
      setLoading(false);
    }
  }, [contract]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  // Fetch minimal profile data for creators (username + avatar)
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
              if (!p || !p.joinedAt || p.joinedAt === BigInt(0))
                return [addr, { loaded: true }] as const;
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
          for (const [k, v] of results) next[k] = v;
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

    // Filter by category
    if (filters.category !== "all") {
      const categoryNum = parseInt(filters.category);
      filtered = filtered.filter(
        (listing) => listing.category === BigInt(categoryNum)
      );
    }

    // Filter by active status
    if (filters.showActiveOnly) {
      filtered = filtered.filter((listing) => listing.active);
    }

    // Sort boosted first if enabled
    if (filters.showBoostedFirst) {
      filtered.sort((a, b) => {
        if (a.isBoosted && !b.isBoosted) return -1;
        if (!a.isBoosted && b.isBoosted) return 1;
        return Number(b.createdAt - a.createdAt); // Most recent first
      });
    } else {
      filtered.sort((a, b) => Number(b.createdAt - a.createdAt));
    }

    return filtered;
  }, [listings, filters]);

  // UI primitives ----------------------------------------------------------
  const badgeBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide";
  const badgeVariants: Record<string, string> = {
    neutral: "bg-gray-800/70 text-gray-300",
    outline: "border border-white/10 text-gray-300",
    boosted: "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30",
    inactive: "bg-red-500/15 text-red-400",
    category: "bg-gray-700/50 text-gray-200",
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
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  const { activeCount, pills } = useMemo(() => {
    const p: string[] = [];
    if (filters.category !== "all") p.push(`Cat: ${filters.category}`);
    if (!filters.showActiveOnly) p.push("Inactive incl.");
    if (!filters.showBoostedFirst) p.push("No boost sort");
    return { activeCount: p.length, pills: p };
  }, [filters]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="space-y-6">
          <div className="h-8 w-1/3 rounded bg-gray-800/60 animate-pulse" />
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-60 rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 animate-pulse"
              />
            ))}
          </div>
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
                className="px-4 py-2 border border-gray-700 rounded-lg hover:border-gray-600"
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
          <p className="text-sm text-gray-500">
            If the issue persists, ensure the correct contract address is set
            for the selected network.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Briefs</h1>
          <p className="text-sm text-gray-400">
            Browse project opportunities from owners.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`${btnBase} border border-white/10 bg-gray-900 px-3 py-2 text-gray-200 hover:bg-gray-800`}
          >
            <FilterIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className="ml-1 text-[10px] rounded bg-white/10 px-1.5 py-0.5">
                {activeCount}
              </span>
            )}
          </button>
          <Link
            href="/create"
            className={`${btnBase} bg-white text-black px-4 py-2 hover:opacity-90`}
          >
            <Briefcase className="w-4 h-4" />
            Post Brief
          </Link>
        </div>
      </div>

      {/* Collapsible Filters */}
      <div className="rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
            <FilterIcon className="w-4 h-4" /> Filters{" "}
            {!filtersOpen && activeCount > 0 && (
              <span className="text-[10px] text-gray-400 ml-1">
                ({activeCount})
              </span>
            )}
          </div>
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="text-[11px] text-gray-400 hover:text-gray-200"
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
          >
            {filtersOpen ? "Hide" : "Show"}
          </button>
        </div>
        {!filtersOpen && pills.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1">
            {pills.slice(0, 5).map((p) => (
              <span
                key={p}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300 border border-white/10"
              >
                {p}
              </span>
            ))}
            {pills.length > 5 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                +{pills.length - 5}
              </span>
            )}
          </div>
        )}
        {filtersOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-white/5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <option value="0">Project Owner</option>
                  <option value="1">Developer</option>
                  <option value="2">Artist</option>
                  <option value="3">KOL</option>
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
              <label className="flex items-center gap-2 text-xs font-medium text-gray-300 pt-0 md:pt-5">
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
              <button
                onClick={() =>
                  setFilters({
                    category: "all",
                    showActiveOnly: true,
                    showBoostedFirst: true,
                  })
                }
                className="text-[11px] text-red-300 hover:text-red-200"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="mb-4 text-sm text-gray-400">
        {filteredListings.length} brief
        {filteredListings.length === 1 ? "" : "s"} found
      </div>

      {/* Listings Grid */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredListings.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-400 mb-4">
              No briefs found matching your criteria.
            </p>
            <Link
              href="/create"
              className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
            >
              Post the first brief
            </Link>
          </div>
        ) : (
          filteredListings.map((listing) => {
            const cover = toGatewayUrl(listing.metadata?.image || null);
            const title =
              listing.metadata?.title || `Brief #${listing.id.toString()}`;
            return (
              <div
                key={listing.id.toString()}
                className={`rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-5 flex flex-col h-full transition-shadow hover:shadow-md ${
                  listing.isBoosted ? "ring-1 ring-yellow-500/30" : ""
                }`}
              >
                {cover && (
                  <div className="relative mb-4 w-full h-40 sm:h-44 rounded-lg overflow-hidden border border-white/10 bg-gray-900">
                    <Image
                      src={cover}
                      alt={title}
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
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1"
                  >
                    <Briefcase className="w-3.5 h-3.5" />
                    Brief
                  </Badge>
                  <Badge variant="category">
                    <TagIcon className="w-3.5 h-3.5" />
                    {getCategoryLabel(Number(listing.category))}
                  </Badge>
                  {listing.isBoosted && (
                    <Badge
                      variant="boosted"
                      className="inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Boosted
                    </Badge>
                  )}
                  {!listing.active && (
                    <Badge
                      variant="inactive"
                      className="inline-flex items-center gap-1"
                    >
                      <CircleOff className="w-3.5 h-3.5" />
                      Inactive
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-1">
                    <Clock3 className="w-3.5 h-3.5" />
                    {timeAgo(Number(listing.createdAt))}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2 line-clamp-2 leading-snug tracking-tight">
                  <Link
                    href={`/briefs/${listing.id.toString()}`}
                    className="hover:text-gray-300 transition-colors"
                  >
                    {title}
                  </Link>
                </h3>
                <p className="text-gray-400 text-sm line-clamp-3 mb-4">
                  {listing.metadata?.description || "No description available"}
                </p>
                {listing.metadata?.requirements &&
                  listing.metadata.requirements.length > 0 && (
                    <div className="mb-4">
                      <div className="flex flex-wrap gap-1">
                        {listing.metadata.requirements
                          .slice(0, 4)
                          .map((req, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-gray-900 text-gray-300 text-xs rounded"
                            >
                              {req}
                            </span>
                          ))}
                        {listing.metadata.requirements.length > 4 && (
                          <span className="px-2 py-1 bg-gray-900 text-gray-400 text-xs rounded">
                            +{listing.metadata.requirements.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                {listing.metadata?.budget && (
                  <div className="mb-4 space-y-1 text-xs">
                    <span className="text-gray-500">Budget</span>
                    <p className="text-sm font-semibold text-gray-200">
                      {listing.metadata.budget.min &&
                      listing.metadata.budget.max
                        ? `$${listing.metadata.budget.min} - $${listing.metadata.budget.max}`
                        : listing.metadata.budget.min
                        ? `$${listing.metadata.budget.min}+`
                        : listing.metadata.budget.max
                        ? `Up to $${listing.metadata.budget.max}`
                        : "TBD"}
                    </p>
                  </div>
                )}
                <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-gray-500 mb-3">
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
                    className="flex items-center gap-2 min-w-0 hover:text-gray-300 transition-colors"
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
                                prof.username ? `@${prof.username}` : "avatar"
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
                </div>
                <Link
                  href={`/briefs/${listing.id.toString()}`}
                  className={`${btnBase} w-full border border-white/10 hover:border-gray-400/40 px-4 py-2 text-gray-200 hover:text-white bg-transparent text-sm justify-center`}
                >
                  View Details <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            );
          })
        )}
      </div>

      {/* Load more button if we have many results */}
      {filteredListings.length >= 50 && (
        <div className="text-center mt-8">
          <button
            onClick={loadListings}
            className="px-6 py-2 border border-white/10 rounded-lg hover:bg-white/5 transition-colors text-sm"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
