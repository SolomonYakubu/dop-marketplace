"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { getMarketplaceContract } from "@/lib/contract";
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

  const chainId = chain?.id ?? 11124;
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );

  useEffect(() => {
    async function loadListings() {
      setLoading(true);
      try {
        const contract = getMarketplaceContract(chainId, provider);
        // Use id-based/view pagination to load all listings
        let all = await contract.fetchAllListingsByIndex({});
        if (!all || all.length === 0) {
          // Robust fallback to id scan (still view-based)
          all = await contract.fetchAllListingsByIdScan({});
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
  }, [chainId, provider]);

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

  const renderListing = (listing: EnrichedListing) => {
    // Ensure we have a valid listing ID
    if (!listing.id || listing.id === BigInt(0)) {
      console.warn("Invalid listing ID:", listing);
      return null;
    }

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

    // Optional budget display (shared metadata shape)
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
      <Link href={href} className="block">
        <div className="container-panel p-6 hover:border-blue-500/30 transition-colors">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                {listing.listingType === ListingType.BRIEF ? "Brief" : "Gig"}
              </span>
              <span className="text-[11px] rounded-full border border-gray-800 px-2 py-0.5 text-gray-300">
                {categoryLabel}
              </span>
              {listing.isBoosted && (
                <span className="text-[11px] rounded-full border border-amber-500/30 bg-amber-400/20 px-2 py-0.5 text-amber-300">
                  Boosted
                </span>
              )}
              {!listing.active && (
                <span className="text-[11px] rounded-full border border-red-500/30 bg-red-400/20 px-2 py-0.5 text-red-300">
                  Inactive
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400">{createdAgo}</span>
          </div>

          <div className="flex gap-4">
            {cover && (
              // Use next/image for optimization (unoptimized to avoid remotePatterns constraints)
              <Image
                src={cover!}
                alt={title}
                width={80}
                height={80}
                className="w-20 h-20 object-cover rounded border border-gray-800 flex-shrink-0"
                unoptimized
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}

            <div className="flex-1 min-w-0">
              <h3 className="font-medium mb-2 line-clamp-2">{title}</h3>
              <p className="text-sm text-gray-300 mb-3 line-clamp-2">
                {truncateText(description, 120)}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {skills.slice(0, 3).map((skill, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded"
                    >
                      {skill}
                    </span>
                  ))}
                  {skills.length > 3 && (
                    <span className="text-[10px] text-gray-500">
                      +{skills.length - 3}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-sm">
                  {priceDisplay && (
                    <span className="text-green-400 font-medium">
                      {priceDisplay}
                    </span>
                  )}
                  <span className="text-gray-400">
                    by {formatAddress(listing.creator)}
                  </span>
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
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Browse Marketplace</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Discover briefs from project owners seeking talent, or gigs from
          service providers offering their expertise.
        </p>
      </div>

      {/* Search and Filters */}
      <div className="container-panel p-6 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search by title, description, skills, or creator address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-10 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
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

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Category:</label>
            <select
              value={selectedCategory ?? ""}
              onChange={(e) =>
                setSelectedCategory(
                  e.target.value ? Number(e.target.value) : null
                )
              }
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Categories</option>
              <option value="0">Project Owner</option>
              <option value="1">Developer</option>
              <option value="2">Artist</option>
              <option value="3">KOL</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="boosted">Boosted First</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-400">Active only</span>
          </label>

          {(searchQuery || selectedCategory !== null || !showActiveOnly) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory(null);
                setShowActiveOnly(true);
              }}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
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
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
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
          {filteredListings
            .map((listing, index) => {
              const renderedListing = renderListing(listing);
              if (!renderedListing) return null;

              return (
                <div key={`${String(listing.id)}-${index}`}>
                  {renderedListing}
                </div>
              );
            })
            .filter(Boolean)}
        </div>
      ) : (
        <div className="container-panel p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg
              className="w-16 h-16 mx-auto mb-4"
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
            <h3 className="text-lg font-medium text-white mb-2">
              No listings found
            </h3>
            <p>Try adjusting your search criteria or filters.</p>
          </div>
          <div className="flex justify-center gap-3">
            <Link
              href="/create"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
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
              className="px-4 py-2 border border-gray-700 text-gray-300 rounded hover:bg-gray-800 transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="container-panel p-6">
        <h3 className="font-medium mb-4">Quick Actions</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <Link
            href="/create?type=brief"
            className="p-4 border border-gray-800 rounded hover:border-blue-500/30 transition-colors"
          >
            <h4 className="font-medium mb-2">Post a Brief</h4>
            <p className="text-sm text-gray-400">
              Looking for talent? Create a project brief and get offers from
              service providers.
            </p>
          </Link>
          <Link
            href="/create?type=gig"
            className="p-4 border border-gray-800 rounded hover:border-green-500/30 transition-colors"
          >
            <h4 className="font-medium mb-2">Create a Gig</h4>
            <p className="text-sm text-gray-400">
              Offer your services to project owners by creating a gig listing.
            </p>
          </Link>
          <Link
            href="/offers"
            className="p-4 border border-gray-800 rounded hover:border-purple-500/30 transition-colors"
          >
            <h4 className="font-medium mb-2">Manage Offers</h4>
            <p className="text-sm text-gray-400">
              View and manage your active offers and ongoing projects.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
