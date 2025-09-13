"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Filter as FilterIcon,
  X as XIcon,
  Sparkles,
  Tag as TagIcon,
  Briefcase,
  Hammer,
  Clock3,
  UserCircle2,
  Layers,
} from "lucide-react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";

import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { ListingType, EnrichedListing } from "@/types/marketplace";
import {
  toGatewayUrl,
  formatAddress,
  truncateText,
  getRpcUrl,
  timeAgo,
  loadListingMetadataFromURI,
  getCategoryLabel,
} from "@/lib/utils";
import { LoadingCard } from "@/components/Loading";

export default function BrowsePage() {
  const { chain } = useAccount();
  const { contract } = useMarketplaceContract();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [filteredListings, setFilteredListings] = useState<EnrichedListing[]>(
    []
  );
  const [activeTab, setActiveTab] = useState<"all" | "briefs" | "gigs">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "boosted">(
    "newest"
  );
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Minimal cached profiles for creators (username + profilePicCID)
  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; profilePicCID?: string }>
  >({});

  const chainId =
    chain?.id ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124);
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );

  useEffect(() => {
    async function loadListings() {
      setLoading(true);
      try {
        // Use id-based/view pagination to load all listings
        let all = await contract!.fetchAllListingsByIndex({});
        if (!all || all.length === 0) {
          // Robust fallback to id scan (still view-based)
          all = await contract!.fetchAllListingsByIdScan({});
        }

        const enriched: EnrichedListing[] = await Promise.all(
          all.map(async (listing) => {
            const metadata = await loadListingMetadataFromURI(
              listing.metadataURI,
              listing
            );
            const isBoosted =
              Number(listing.boostExpiry) >= Math.floor(Date.now() / 1000);
            return { ...listing, metadata, isBoosted } as EnrichedListing;
          })
        );

        setListings(enriched);
      } catch (error) {
        console.error("Failed to load listings:", error);
      } finally {
        setLoading(false);
      }
    }

    loadListings();
  }, [chainId, contract, provider]);

  // Fetch minimal profiles for creators (batch, no re-fetch if cached)
  useEffect(() => {
    if (!contract || listings.length === 0) return;
    const creators = Array.from(
      new Set(listings.map((l) => l.creator.toLowerCase()))
    );
    const toFetch = creators.filter((c) => !profiles[c]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<
        string,
        { username?: string; profilePicCID?: string }
      > = {};
      await Promise.all(
        toFetch.map(async (addr) => {
          try {
            interface RawProfile {
              joinedAt: bigint;
              username?: string;
              profilePicCID?: string;
            }
            const p: RawProfile = await (
              contract as unknown as {
                getProfile: (a: string) => Promise<RawProfile>;
              }
            ).getProfile(addr);
            if (p && p.joinedAt && Number(p.joinedAt) > 0) {
              updates[addr] = {
                username: p.username || undefined,
                profilePicCID: p.profilePicCID || undefined,
              };
            }
          } catch {}
        })
      );
      if (!cancelled && Object.keys(updates).length) {
        setProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contract, listings, profiles]);

  const Identity = ({ addr }: { addr: string }) => {
    const router = useRouter();
    const lower = addr.toLowerCase();
    const p = profiles[lower];
    const avatarUrl = p?.profilePicCID ? toGatewayUrl(p.profilePicCID) : null;
    const display = p?.username ? `@${p.username}` : formatAddress(addr);
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/profile/${addr}`);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            router.push(`/profile/${addr}`);
          }
        }}
        className="inline-flex cursor-pointer items-center gap-1.5 max-w-[140px] group/avatar"
      >
        {avatarUrl ? (
          <span className="relative w-5 h-5 rounded-full overflow-hidden bg-gray-800 ring-1 ring-white/10 flex-shrink-0">
            <Image
              src={avatarUrl}
              alt={display}
              fill
              sizes="20px"
              className="object-cover"
              unoptimized
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
        ) : (
          <UserCircle2 className="w-5 h-5 text-gray-500" />
        )}
        <span
          className={
            p?.username
              ? "truncate font-medium text-gray-100"
              : "truncate text-gray-400"
          }
        >
          {display}
        </span>
      </span>
    );
  };

  // Filter and sort listings
  useEffect(() => {
    let filtered = [...listings];

    // Filter by tab
    if (activeTab !== "all") {
      const listingType =
        activeTab === "briefs" ? ListingType.BRIEF : ListingType.GIG;
      filtered = filtered.filter((l) => l.listingType === listingType);
    }

    // Filter by active status
    if (showActiveOnly) {
      filtered = filtered.filter((l) => l.active);
    }

    // Filter by category
    if (selectedCategory !== null) {
      filtered = filtered.filter(
        (l) => Number(l.category) === selectedCategory
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((l) => {
        const title = l.metadata?.title || "";
        const description = l.metadata?.description || "";
        const categoryLabel = getCategoryLabel(Number(l.category));
        const skills = l.metadata?.requirements || [];
        return (
          title.toLowerCase().includes(query) ||
          description.toLowerCase().includes(query) ||
          categoryLabel.toLowerCase().includes(query) ||
          skills.some((skill) => skill.toLowerCase().includes(query)) ||
          l.creator.toLowerCase().includes(query)
        );
      });
    }

    // Sort listings
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return Number(b.createdAt) - Number(a.createdAt);
        case "oldest":
          return Number(a.createdAt) - Number(b.createdAt);
        case "boosted":
          if (a.isBoosted && !b.isBoosted) return -1;
          if (!a.isBoosted && b.isBoosted) return 1;
          return Number(b.createdAt) - Number(a.createdAt);
        default:
          return 0;
      }
    });

    setFilteredListings(filtered);
  }, [
    listings,
    activeTab,
    searchQuery,
    selectedCategory,
    sortBy,
    showActiveOnly,
  ]);

  // Active filter summary (exclude defaults)
  const { activeFilterCount, activeFilterPills } = useMemo(() => {
    const pills: string[] = [];
    if (selectedCategory !== null) pills.push(`Cat: ${selectedCategory}`);
    if (!showActiveOnly) pills.push("Inactive incl.");
    if (sortBy !== "newest") pills.push(`Sort: ${sortBy}`);
    if (searchQuery.trim())
      pills.push(
        `Search: ${searchQuery.trim().slice(0, 12)}${
          searchQuery.trim().length > 12 ? "…" : ""
        }`
      );
    return { activeFilterCount: pills.length, activeFilterPills: pills };
  }, [selectedCategory, showActiveOnly, sortBy, searchQuery]);

  // UI primitives ----------------------------------------------------------
  const badgeBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide";
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

  // Card renderer (refactored) --------------------------------------------
  const renderListing = (listing: EnrichedListing) => {
    if (!listing.id || listing.id === BigInt(0)) return null;
    const href =
      listing.listingType === ListingType.BRIEF
        ? `/briefs/${String(listing.id)}`
        : `/gigs/${String(listing.id)}`;
    const title =
      listing.metadata?.title ||
      `${listing.listingType === ListingType.BRIEF ? "Brief" : "Gig"} #${String(
        listing.id
      )}`;
    const description =
      listing.metadata?.description || "No description provided.";
    const cover = toGatewayUrl(listing.metadata?.image || null);
    const skills = listing.metadata?.requirements || [];
    const categoryLabel = getCategoryLabel(Number(listing.category));
    const createdAgo = timeAgo(Number(listing.createdAt));
    const budget = listing.metadata?.budget;
    const priceDisplay = budget
      ? budget.min != null && budget.max != null
        ? `$${budget.min} - $${budget.max} ${budget.currency || "USD"}`
        : budget.min != null
        ? `$${budget.min}+ ${budget.currency || "USD"}`
        : budget.max != null
        ? `Up to $${budget.max} ${budget.currency || "USD"}`
        : undefined
      : undefined;

    return (
      <Link
        href={href}
        className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 rounded-xl"
      >
        <div
          className={`rounded-xl border border-white/5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 p-5 flex gap-5 transition-shadow hover:shadow-md ${
            listing.isBoosted ? "ring-1 ring-yellow-500/30" : ""
          }`}
        >
          {cover && (
            <div className="relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden border border-white/10 bg-gray-900">
              <Image
                src={cover}
                alt={title}
                fill
                sizes="96px"
                className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
                unoptimized
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="absolute inset-0 ring-1 ring-white/5" />
            </div>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge
                variant="outline"
                className="capitalize inline-flex items-center gap-1"
              >
                {listing.listingType === ListingType.BRIEF ? (
                  <Briefcase className="w-3.5 h-3.5" />
                ) : (
                  <Hammer className="w-3.5 h-3.5" />
                )}
                {listing.listingType === ListingType.BRIEF ? "Brief" : "Gig"}
              </Badge>
              <Badge variant="category">
                <TagIcon className="w-3.5 h-3.5" />
                {categoryLabel}
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
              {!listing.active && <Badge variant="inactive">Inactive</Badge>}
              <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-1">
                <Clock3 className="w-3.5 h-3.5" />
                {createdAgo}
              </span>
            </div>
            <h3 className="font-semibold mb-2 line-clamp-2 leading-snug tracking-tight text-sm sm:text-base group-hover:text-gray-200 transition-colors">
              {title}
            </h3>
            <p className="text-xs text-gray-400 mb-3 line-clamp-2 leading-relaxed">
              {truncateText(description, 140)}
            </p>
            <div className="mt-auto flex items-end justify-between gap-3">
              <div className="flex flex-wrap gap-1 max-w-[60%]">
                {skills.slice(0, 3).map((skill, idx) => (
                  <Badge
                    key={idx}
                    variant="neutral"
                    className="text-[9px] px-2 py-0.5"
                  >
                    {skill}
                  </Badge>
                ))}
                {skills.length > 3 && (
                  <span className="text-[10px] text-gray-500">
                    +{skills.length - 3}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-right space-y-1 min-w-[140px]">
                {priceDisplay && (
                  <div className="text-green-400 font-medium truncate">
                    {priceDisplay}
                  </div>
                )}
                <div className="text-gray-500 flex items-center justify-end gap-1">
                  <Identity addr={listing.creator} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Browse Marketplace
        </h1>
        <p className="text-gray-400 max-w-2xl mx-auto text-sm leading-relaxed">
          Find briefs that need talent or gigs offered by creators. Filter,
          compare and dive in.
        </p>
      </div>

      {/* Search + Collapsible Filters */}
      <div className="container-panel p-5 space-y-4">
        {/* Top row: search + filter toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search listings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 pl-9 bg-gray-800/80 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-white/10 bg-gray-900 hover:bg-gray-800 text-gray-200 transition-colors"
            >
              <FilterIcon className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 text-[10px] rounded bg-white/10 px-1.5 py-0.5">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory(null);
                  setShowActiveOnly(true);
                  setSortBy("newest");
                }}
                className="text-[11px] px-3 py-2 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        {/* Active pills when collapsed */}
        {!filtersOpen && activeFilterPills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilterPills.slice(0, 6).map((pill) => (
              <span
                key={pill}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300 border border-white/10"
              >
                {pill}
              </span>
            ))}
            {activeFilterPills.length > 6 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                +{activeFilterPills.length - 6}
              </span>
            )}
          </div>
        )}
        {/* Collapsible filter body */}
        {filtersOpen && (
          <div className="space-y-4 pt-1 border-t border-white/5">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-gray-500">
                  Category
                </label>
                <select
                  value={selectedCategory ?? ""}
                  onChange={(e) =>
                    setSelectedCategory(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 bg-gray-800/70 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Categories</option>
                  <option value="0">Project Owner</option>
                  <option value="1">Developer</option>
                  <option value="2">Artist</option>
                  <option value="3">KOL</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-gray-500">
                  Sort By
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="w-full px-3 py-2 bg-gray-800/70 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="boosted">Boosted First</option>
                </select>
              </div>
              <div className="flex items-center gap-3 pt-6 md:pt-7">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-300">
                  <input
                    type="checkbox"
                    checked={showActiveOnly}
                    onChange={(e) => setShowActiveOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-white/10 bg-gray-900 text-white focus:ring-white/20"
                  />
                  Active only
                </label>
              </div>
            </div>
            {searchQuery && (
              <div className="text-[11px] text-gray-500 flex items-center gap-2">
                <span>Search:</span>
                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300 text-[10px]">
                  {searchQuery}
                </span>
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-gray-400 hover:text-gray-200"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 overflow-x-auto scrollbar-none">
        {[
          {
            key: "all",
            label: "All",
            count: listings.filter((l) => (showActiveOnly ? l.active : true))
              .length,
          },
          {
            key: "briefs",
            label: "Briefs",
            count: listings.filter(
              (l) =>
                l.listingType === ListingType.BRIEF &&
                (showActiveOnly ? l.active : true)
            ).length,
          },
          {
            key: "gigs",
            label: "Gigs",
            count: listings.filter(
              (l) =>
                l.listingType === ListingType.GIG &&
                (showActiveOnly ? l.active : true)
            ).length,
          },
        ].map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`relative px-5 py-2.5 text-xs font-medium tracking-wide transition-colors ${
                active ? "text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {tab.key === "all" && <Layers className="w-3.5 h-3.5" />}
                {tab.key === "briefs" && <Briefcase className="w-3.5 h-3.5" />}
                {tab.key === "gigs" && <Hammer className="w-3.5 h-3.5" />}
                {tab.label}
                <span
                  className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                    active
                      ? "bg-white/15 text-gray-200"
                      : "bg-white/5 text-gray-400"
                  }`}
                >
                  {tab.count}
                </span>
              </span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 bg-gradient-to-r from-blue-500/80 via-blue-400 to-blue-500/80 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <LoadingCard key={i} showImage />
          ))}
        </div>
      ) : filteredListings.length > 0 ? (
        <div className="grid gap-4">
          {filteredListings.map((listing, index) => (
            <div key={`${String(listing.id)}-${index}`}>
              {renderListing(listing)}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 p-12 text-center bg-gradient-to-b from-gray-900/70 to-gray-900/30">
          <div className="text-gray-400 mb-6 flex flex-col items-center gap-4">
            <svg
              className="w-14 h-14"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <div>
              <h3 className="text-base font-semibold text-white mb-1">
                No listings found
              </h3>
              <p className="text-xs text-gray-500">
                Adjust your search or filters to see more results.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/create"
              className={
                "px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:opacity-90"
              }
            >
              Create Listing
            </Link>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory(null);
                setActiveTab("all");
                setShowActiveOnly(true);
              }}
              className="px-4 py-2 border border-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/5 transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid md:grid-cols-3 gap-4">
        <Link
          href="/create?type=brief"
          className="rounded-xl border border-white/5 p-5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 hover:border-blue-500/30 transition-colors group"
        >
          <h4 className="font-medium mb-1 flex items-center gap-2 text-sm">
            <Briefcase className="w-4 h-4 text-blue-400" />
            Post a Brief
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Need talent? Create a project brief and receive offers.
          </p>
        </Link>
        <Link
          href="/create?type=gig"
          className="rounded-xl border border-white/5 p-5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 hover:border-green-500/30 transition-colors group"
        >
          <h4 className="font-medium mb-1 flex items-center gap-2 text-sm">
            <Hammer className="w-4 h-4 text-green-400" />
            Create a Gig
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Offer your services directly to project owners.
          </p>
        </Link>
        <Link
          href="/offers"
          className="rounded-xl border border-white/5 p-5 bg-gradient-to-b from-gray-900/70 to-gray-900/30 hover:border-purple-500/30 transition-colors group"
        >
          <h4 className="font-medium mb-1 flex items-center gap-2 text-sm">
            <Layers className="w-4 h-4 text-purple-400" />
            Manage Offers
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Track and manage your offers & active work.
          </p>
        </Link>
      </div>
    </div>
  );
}
