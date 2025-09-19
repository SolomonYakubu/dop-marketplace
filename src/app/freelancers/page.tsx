"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Filter as FilterIcon,
  Sparkles,
  UserCircle2,
  Star,
  Briefcase,
  Users,
  Search,
} from "lucide-react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";

import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { OnchainUserProfile, UserType } from "@/types/marketplace";
import { toGatewayUrl, formatAddress, getRpcUrl, timeAgo } from "@/lib/utils";
import { LoadingCard } from "@/components/Loading";

interface FreelancerProfile {
  address: string;
  profile: OnchainUserProfile;
  rating: number;
  completedMissions: number;
  isBoosted: boolean;
}

const getUserTypeLabel = (userType: UserType): string => {
  switch (userType) {
    case UserType.DEVELOPER:
      return "Developer";
    case UserType.ARTIST:
      return "Artist";
    case UserType.KOL:
      return "KOL";
    case UserType.PROJECT_OWNER:
      return "Project Owner";
    default:
      return "Unknown";
  }
};

const getUserTypeColor = (userType: UserType): string => {
  switch (userType) {
    case UserType.DEVELOPER:
      return "bg-blue-500/10 text-blue-300 border-blue-500/20";
    case UserType.ARTIST:
      return "bg-purple-500/10 text-purple-300 border-purple-500/20";
    case UserType.KOL:
      return "bg-pink-500/10 text-pink-300 border-pink-500/20";
    case UserType.PROJECT_OWNER:
      return "bg-green-500/10 text-green-300 border-green-500/20";
    default:
      return "bg-gray-500/10 text-gray-300 border-gray-500/20";
  }
};

export default function FreelancersPage() {
  const { chain } = useAccount();
  const { contract } = useMarketplaceContract();
  const [loading, setLoading] = useState(true);
  const [freelancers, setFreelancers] = useState<FreelancerProfile[]>([]);
  const [filteredFreelancers, setFilteredFreelancers] = useState<
    FreelancerProfile[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserType, setSelectedUserType] = useState<UserType | null>(
    null
  );
  const [sortBy, setSortBy] = useState<
    "boosted" | "rating" | "missions" | "newest"
  >("boosted");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const chainId =
    chain?.id ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124);
  const provider = useMemo(
    () => new ethers.JsonRpcProvider(getRpcUrl(chainId)),
    [chainId]
  );

  useEffect(() => {
    async function loadFreelancers() {
      if (!contract) return;

      setLoading(true);
      try {
        // Since there's no getAllRegisteredUsers, we'll need to get users from listings
        // and chat data or implement event-based discovery
        // For now, let's get creators from all listings as a proxy for active freelancers
        const allListings = await contract.fetchAllListingsByIndex({});
        const creatorAddresses = Array.from(
          new Set(allListings.map((listing) => listing.creator.toLowerCase()))
        );

        const freelancerProfiles: FreelancerProfile[] = [];

        for (const address of creatorAddresses) {
          try {
            const profile = await contract.getProfile(address);

            // Check if profile exists (has joined)
            if (!profile || Number(profile.joinedAt) === 0) continue;

            // Check if profile is boosted
            const isBoosted = await contract.isProfileBoosted(address);

            // Get reviews to calculate average rating
            let rating = 0;
            try {
              const reviews = await contract.getReviews(address);
              if (reviews && reviews.length > 0) {
                const totalRating = reviews.reduce(
                  (sum: number, review: { rating: number }) =>
                    sum + Number(review.rating),
                  0
                );
                rating = totalRating / reviews.length;
              }
            } catch (error) {
              console.log("Error fetching reviews for", address, error);
            }

            // Get mission history to count completed missions
            let completedMissions = 0;
            try {
              const missions = await contract.getMissionHistory(address);
              completedMissions = missions?.length || 0;
            } catch (error) {
              console.log("Error fetching missions for", address, error);
            }

            freelancerProfiles.push({
              address,
              profile,
              rating,
              completedMissions,
              isBoosted,
            });
          } catch (error) {
            console.log("Error loading profile for", address, error);
          }
        }

        setFreelancers(freelancerProfiles);
      } catch (error) {
        console.error("Failed to load freelancers:", error);
      } finally {
        setLoading(false);
      }
    }

    loadFreelancers();
  }, [chainId, contract, provider]);

  // Filter and sort freelancers
  useEffect(() => {
    let filtered = [...freelancers];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (freelancer) =>
          freelancer.profile.username?.toLowerCase().includes(query) ||
          freelancer.profile.bio.toLowerCase().includes(query) ||
          freelancer.profile.skills.some((skill) =>
            skill.toLowerCase().includes(query)
          ) ||
          freelancer.address.toLowerCase().includes(query)
      );
    }

    // Apply user type filter
    if (selectedUserType !== null) {
      filtered = filtered.filter(
        (freelancer) => freelancer.profile.userType === selectedUserType
      );
    }

    // Sort freelancers
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "boosted":
          // Boosted profiles first, then by rating
          if (a.isBoosted && !b.isBoosted) return -1;
          if (!a.isBoosted && b.isBoosted) return 1;
          return b.rating - a.rating;
        case "rating":
          return b.rating - a.rating;
        case "missions":
          return b.completedMissions - a.completedMissions;
        case "newest":
          return Number(b.profile.joinedAt) - Number(a.profile.joinedAt);
        default:
          return 0;
      }
    });

    setFilteredFreelancers(filtered);
  }, [freelancers, searchQuery, selectedUserType, sortBy]);

  const FreelancerCard = ({
    freelancer,
  }: {
    freelancer: FreelancerProfile;
  }) => (
    <Link
      href={`/profile/${freelancer.address}`}
      className="group block bg-gray-900/50 border border-gray-800 rounded-xl p-6 hover:border-gray-700 hover:bg-gray-900/70 transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {freelancer.profile.profilePicCID ? (
            <Image
              src={toGatewayUrl(freelancer.profile.profilePicCID) || ""}
              alt={
                freelancer.profile.username || formatAddress(freelancer.address)
              }
              width={64}
              height={64}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
              <UserCircle2 className="w-8 h-8 text-gray-400" />
            </div>
          )}

          {/* Boost indicator */}
          {freelancer.isBoosted && (
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-black" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                {freelancer.profile.username ||
                  formatAddress(freelancer.address)}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getUserTypeColor(
                    freelancer.profile.userType
                  )}`}
                >
                  {getUserTypeLabel(freelancer.profile.userType)}
                </span>
                {freelancer.profile.isVerified && (
                  <div className="flex items-center text-xs text-blue-400">
                    <Star className="w-3 h-3 mr-1" />
                    Verified
                  </div>
                )}
              </div>
            </div>

            {/* Rating */}
            {freelancer.rating > 0 && (
              <div className="flex items-center text-yellow-400">
                <Star className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">
                  {freelancer.rating.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          {/* Bio */}
          <p className="text-gray-300 text-sm mb-3 line-clamp-2">
            {freelancer.profile.bio || "No bio available"}
          </p>

          {/* Skills */}
          {freelancer.profile.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {freelancer.profile.skills.slice(0, 3).map((skill, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-gray-800 text-gray-300"
                >
                  {skill}
                </span>
              ))}
              {freelancer.profile.skills.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-gray-800 text-gray-400">
                  +{freelancer.profile.skills.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <div className="flex items-center">
              <Briefcase className="w-3 h-3 mr-1" />
              {freelancer.completedMissions} missions
            </div>
            <div>Joined {timeAgo(Number(freelancer.profile.joinedAt))}</div>
          </div>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
          Find Freelancers
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Discover talented freelancers ready to work on your projects. Boosted
          profiles appear first.
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search freelancers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
          >
            <FilterIcon className="w-4 h-4" />
            Filters
          </button>

          <div className="flex items-center gap-4">
            <div className="flex items-center text-sm text-gray-400">
              <Users className="w-4 h-4 mr-2" />
              {filteredFreelancers.length} freelancer
              {filteredFreelancers.length !== 1 ? "s" : ""}
            </div>

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as "boosted" | "rating" | "missions" | "newest"
                )
              }
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="boosted">Boosted First</option>
              <option value="rating">Highest Rated</option>
              <option value="missions">Most Missions</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>

        {/* Expanded Filters */}
        {filtersOpen && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Freelancer Type
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedUserType(null)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    selectedUserType === null
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  All Types
                </button>
                {Object.values(UserType)
                  .filter((value) => typeof value === "number")
                  .map((type) => (
                    <button
                      key={type}
                      onClick={() => setSelectedUserType(type as UserType)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        selectedUserType === type
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      {getUserTypeLabel(type as UserType)}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Freelancers Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <LoadingCard key={i} />
          ))}
        </div>
      ) : filteredFreelancers.length === 0 ? (
        <div className="text-center py-12">
          <UserCircle2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            No freelancers found
          </h3>
          <p className="text-gray-400">
            {searchQuery || selectedUserType !== null
              ? "Try adjusting your search or filters"
              : "No freelancers have registered yet"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFreelancers.map((freelancer) => (
            <FreelancerCard key={freelancer.address} freelancer={freelancer} />
          ))}
        </div>
      )}
    </div>
  );
}
