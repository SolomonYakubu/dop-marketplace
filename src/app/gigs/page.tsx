"use client";

import { useEffect, useState, useMemo } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import Link from "next/link";
import Image from "next/image";
import { getMarketplaceContract, CONTRACT_ADDRESSES } from "@/lib/contract";
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

export default function GigsPage() {
  const { chain } = useAccount();
  const { openChainModal } = useChainModal();
  // Determine an effective chain for reads: if current chain isn't configured, fall back to testnet when available
  const currentChainId = chain?.id;
  const hasMainnetAddr =
    !!CONTRACT_ADDRESSES[2741 as keyof typeof CONTRACT_ADDRESSES];
  const hasTestnetAddr =
    !!CONTRACT_ADDRESSES[11124 as keyof typeof CONTRACT_ADDRESSES];
  const readChainId = useMemo(() => {
    if (!currentChainId) return 11124; // default testnet
    const addr =
      CONTRACT_ADDRESSES[currentChainId as keyof typeof CONTRACT_ADDRESSES];
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) return currentChainId;
    // Fallback to testnet if configured
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

  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(readChainId)),
    [readChainId]
  );

  async function loadListings() {
    setLoading(true);
    setError(null);

    try {
      const contract = getMarketplaceContract(readChainId, provider);
      // Use view/id-based enumeration of all listings with robust fallback
      let allListings: Listing[] = [];
      try {
        allListings = await (
          contract as unknown as {
            fetchAllListingsByIndex: (args?: unknown) => Promise<Listing[]>;
          }
        ).fetchAllListingsByIndex?.({});
      } catch (err) {
        console.warn("fetchAllListingsByIndex failed:", err);
      }
      if (!allListings || allListings.length === 0) {
        try {
          allListings = await (
            contract as unknown as {
              fetchAllListingsByIdScan: (args?: unknown) => Promise<Listing[]>;
            }
          ).fetchAllListingsByIdScan?.({});
        } catch (err) {
          console.warn("fetchAllListingsByIdScan failed:", err);
        }
      }

      // Filter for gigs only
      const gigs = (allListings || []).filter(
        (listing) => Number(listing.listingType) === ListingType.GIG
      );

      // Load metadata and boost status for each listing with a timeout to prevent hanging
      const METADATA_TIMEOUT = 4000; // 4s safety timeout per item
      const enrichedListings: EnrichedListing[] = await Promise.all(
        gigs.map(async (listing) => {
          try {
            // Load metadata (tolerant parser)
            let metadata: ListingMetadata | undefined;
            if (listing.metadataURI) {
              const gatewayUrl = toGatewayUrl(listing.metadataURI);
              if (gatewayUrl) {
                try {
                  const response = await fetchWithTimeout(
                    gatewayUrl,
                    METADATA_TIMEOUT
                  );
                  const text = await response.text();
                  try {
                    const parsed = JSON.parse(text) as unknown;
                    if (parsed && typeof parsed === "object") {
                      metadata = parsed as ListingMetadata;
                    }
                  } catch {
                    // fallback minimal shape
                    metadata = {
                      title: `Gig #${listing.id.toString()}`,
                      description: text,
                      category: Number(listing.category),
                      type: ListingType.GIG,
                    };
                  }
                } catch {
                  // Timeout or fetch fail -> non-blocking fallback metadata
                  metadata = {
                    title: `Gig #${listing.id.toString()}`,
                    description: "",
                    category: Number(listing.category),
                    type: ListingType.GIG,
                  };
                }
              }
            }

            // Compute boost status via expiry timestamp (avoid extra RPC)
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
      console.error("Failed to load gigs:", e);
      const msg = e instanceof Error ? e.message : "Failed to load gigs";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readChainId, provider]);

  const filteredListings = useMemo(() => {
    let filtered = [...listings];

    // Filter by category
    if (filters.category !== "all") {
      const categoryNum = parseInt(filters.category);
      filtered = filtered.filter(
        (listing) => listing.category === BigInt(categoryNum)
      );
    }

    // Filter by service type
    if (filters.serviceType !== "all") {
      filtered = filtered.filter(
        (listing) => listing.metadata?.serviceType === filters.serviceType
      );
    }

    // Filter by price range
    if (filters.priceRange !== "all") {
      filtered = filtered.filter((listing) => {
        const price = listing.metadata?.price?.amount;
        if (price == null) return true; // keep if unknown

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

  // Whether we are falling back to testnet due to missing mainnet address
  const showingFallback = Boolean(
    currentChainId &&
      currentChainId !== readChainId &&
      !hasMainnetAddr &&
      hasTestnetAddr
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-800 rounded w-1/3"></div>
          <div className="grid gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-800 rounded"></div>
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
      {showingFallback && (
        <div className="mb-4 p-3 rounded border border-yellow-700/50 bg-yellow-500/10 text-yellow-300 text-sm">
          Your wallet is on an unsupported network for this app configuration.
          Showing data from Abstract Sepolia. Use the button to switch networks.
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Gigs</h1>
          <p className="text-gray-400">Browse available services</p>
        </div>
        <Link
          href="/create"
          className="px-4 py-2 bg-white text-black rounded-lg hover:opacity-90"
        >
          Create a Gig
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 p-4 container-panel rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, category: e.target.value }))
              }
              className="w-full rounded border border-gray-800 bg-black px-3 py-2 text-sm focus:border-gray-600"
            >
              <option value="all">All Categories</option>
              <option value="1">Developer</option>
              <option value="2">Artist</option>
              <option value="3">KOL</option>
              <option value="0">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Service Type
            </label>
            <select
              value={filters.serviceType}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, serviceType: e.target.value }))
              }
              className="w-full rounded border border-gray-800 bg-black px-3 py-2 text-sm focus:border-gray-600"
            >
              <option value="all">All Types</option>
              <option value="one-time">One-time</option>
              <option value="ongoing">Ongoing</option>
              <option value="hourly">Hourly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Price Range
            </label>
            <select
              value={filters.priceRange}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, priceRange: e.target.value }))
              }
              className="w-full rounded border border-gray-800 bg-black px-3 py-2 text-sm focus:border-gray-600"
            >
              <option value="all">All Prices</option>
              <option value="0-100">$0 - $100</option>
              <option value="100-500">$100 - $500</option>
              <option value="500-2000">$500 - $2,000</option>
              <option value="2000+">$2,000+</option>
            </select>
          </div>

          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filters.showActiveOnly}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    showActiveOnly: e.target.checked,
                  }))
                }
                className="mr-2"
              />
              <span className="text-sm text-gray-300">Active only</span>
            </label>
          </div>

          <div className="flex items-center">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filters.showBoostedFirst}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    showBoostedFirst: e.target.checked,
                  }))
                }
                className="mr-2"
              />
              <span className="text-sm text-gray-300">Boosted first</span>
            </label>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="mb-4 text-sm text-gray-400">
        {filteredListings.length} gig{filteredListings.length !== 1 ? "s" : ""}{" "}
        found
      </div>

      {/* Listings Grid */}
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
                className={`container-panel p-6 hover:border-gray-600 transition-colors ${
                  listing.isBoosted
                    ? "ring-2 ring-yellow-500/20 border-yellow-500/30"
                    : ""
                }`}
              >
                <div className="flex flex-col h-full">
                  {/* Media */}
                  {cover && (
                    <div className="relative mb-4 w-full h-40 sm:h-44 rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                      <Image
                        src={cover}
                        alt={
                          listing.metadata?.title ||
                          `Gig #${listing.id.toString()}`
                        }
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        className="object-cover"
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

                  {/* Header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      {listing.isBoosted && (
                        <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
                          ⚡ Boosted
                        </span>
                      )}
                      <span className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded-full">
                        {getCategoryLabel(Number(listing.category))}
                      </span>
                      {!listing.active && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
                          Inactive
                        </span>
                      )}
                    </div>

                    <h3 className="text-lg font-semibold mb-2 line-clamp-2">
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

                  {/* Tags */}
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

                  {/* Price and Service Type */}
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

                    <div className="flex items-center justify-between text-sm text-gray-400">
                      <span>
                        {listing.metadata?.serviceType && (
                          <span className="capitalize">
                            {listing.metadata.serviceType}
                          </span>
                        )}
                      </span>
                      <span>
                        {listing.metadata?.deliveryTime &&
                          `${listing.metadata.deliveryTime} delivery`}
                      </span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-sm text-gray-400 mb-3">
                      <span>By {formatAddress(listing.creator)}</span>
                      <span>{timeAgo(Number(listing.createdAt))}</span>
                    </div>

                    <Link
                      href={`/gigs/${listing.id.toString()}`}
                      className="block w-full text-center px-4 py-2 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
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
            className="px-6 py-2 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
