export interface UserProfile {
  bio: string;
  skills: string;
  portfolioURI: string;
  userType: UserType;
  isVerified: boolean;
  totalEarned: bigint;
  completedMissions: bigint;
  successRate: bigint;
}

export enum UserType {
  PROJECT_OWNER = 0,
  DEVELOPER = 1,
  ARTIST = 2,
  KOL = 3,
}

export enum ListingType {
  BRIEF = 0,
  GIG = 1,
}

export enum EscrowStatus {
  NONE = 0,
  IN_PROGRESS = 1,
  COMPLETED = 2,
  DISPUTED = 3,
  RESOLVED = 4,
  CANCELLED = 5,
}

export enum DisputeOutcome {
  NONE = 0,
  PROVIDER_WINS = 1,
  CLIENT_WINS = 2,
  SPLIT = 3,
}

// Mirrors Solidity enum MarketplaceUpgradeable.Badge order
export enum Badge {
  ROOKIE = 0,
  EXPERIENCED = 1,
  EXPERT = 2,
  MASTER = 3,
  RELIABLE = 4,
  MEDIATOR = 5,
  // Admin-assignable specials
  STAR = 6,
  MVP = 7,
  AMBASSADOR = 8,
}

export interface Listing {
  id: bigint;
  listingType: ListingType;
  creator: string;
  metadataURI: string;
  createdAt: bigint;
  active: boolean;
  boostExpiry: bigint;
  category: bigint; // 0..3 maps to UserType-like categories
}

export interface Offer {
  id: bigint;
  listingId: bigint;
  proposer: string;
  amount: bigint;
  paymentToken: string;
  createdAt: bigint;
  accepted: boolean;
  cancelled: boolean;
}

export interface Escrow {
  offerId: bigint;
  client: string;
  provider: string;
  paymentToken: string;
  amount: bigint;
  feeAmount: bigint;
  status: EscrowStatus;
  clientValidated: boolean;
  providerValidated: boolean;
  disputeOutcome: DisputeOutcome;
}

export interface OnchainUserProfile {
  bio: string;
  skills: string[];
  portfolioURIs: string[];
  joinedAt: bigint;
  userType: UserType;
  isVerified: boolean;
  // Added: optional profile picture CID
  profilePicCID?: string;
  // Added: username
  username?: string;
}

export interface Mission {
  escrowId: bigint;
  client: string;
  provider: string;
  amount: bigint;
  token: string;
  completedAt: bigint;
  wasDisputed: boolean;
}

export interface Reputation {
  completedMissions: bigint;
  disputedMissions: bigint;
  score: bigint;
}

// New: Review type for UI rendering
export interface Review {
  reviewer: string;
  reviewee: string;
  rating: number; // 1..5
  reviewURI: string; // IPFS or data: URI
}

// Metadata interfaces for off-chain data
export interface ListingMetadata {
  title: string;
  description: string;
  // Optional extras commonly found in listing json
  image?: string;
  category?: number;
  type?: ListingType;
  requirements?: string[];
  deliverables?: string[];
  timeline?: string;
  budget?: {
    min?: number;
    max?: number;
    currency: string;
  };
  attachments?: string[];
  // Gig-specific optional fields
  serviceType?: "one-time" | "ongoing" | "hourly";
  price?: {
    amount: number;
    currency: string;
    per?: "hour" | "day" | "week" | "month" | "project";
  };
  deliveryTime?: string;
  tags?: string[];
}

export interface ProfileMetadata {
  name: string;
  avatar?: string;
  location?: string;
  timezone?: string;
  languages?: string[];
  experience?: number; // years
  hourlyRate?: number;
  availability?: "full-time" | "part-time" | "project-based";
}

// Shared enriched listing type for UI pages
export type EnrichedListing = Listing & {
  metadata?: ListingMetadata;
  isBoosted?: boolean;
};
