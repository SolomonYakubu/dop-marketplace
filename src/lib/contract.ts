import { ethers } from "ethers";
import {
  Listing,
  Offer,
  OnchainUserProfile,
  Escrow,
  Mission,
  Badge,
  UserType,
  EscrowStatus,
  DisputeOutcome,
} from "@/types/marketplace";
import MarketplaceABI from "./abi/abi.json";

export const TOKENS = {
  2741: {
    DOP: process.env.NEXT_PUBLIC_DOP_ADDRESS || "",
    USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || "",
  },
  11124: {
    DOP: process.env.NEXT_PUBLIC_DOP_ADDRESS || "",
    USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || "",
  },
} as const;

// Minimal ERC20 ABI for approvals and balances
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  // Added for display convenience
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// Using the complete ABI from the JSON file
const MARKETPLACE_ABI: ethers.InterfaceAbi =
  MarketplaceABI as ethers.InterfaceAbi;

// Simple cache types
type CacheValue<T = unknown> = { value: T; expiresAt: number };
type CacheOptions = { ttlMs?: number; force?: boolean };

// On-chain struct shapes (as decoded by ethers v6)
interface ListingStruct {
  id: bigint;
  listingType: bigint; // enum/uint8
  creator: string;
  metadataURI: string;
  createdAt: bigint;
  active: boolean;
  boostExpiry: bigint;
  category: bigint;
}

interface OfferStruct {
  id: bigint;
  listingId: bigint;
  proposer: string;
  amount: bigint;
  paymentToken: string;
  createdAt: bigint;
  accepted: boolean;
  cancelled: boolean;
}

interface ProfileStruct {
  bio: string;
  skills: string[];
  portfolioURIs: string[];
  joinedAt: bigint;
  userType: bigint; // enum/uint8
  isVerified: boolean;
}

interface EscrowStruct {
  offerId: bigint;
  client: string;
  provider: string;
  paymentToken: string;
  amount: bigint;
  feeAmount: bigint;
  status: bigint; // enum/uint8
  clientValidated: boolean;
  providerValidated: boolean;
  disputeOutcome: bigint; // enum/uint8
}

interface MissionStruct {
  escrowId: bigint;
  client: string;
  provider: string;
  amount: bigint;
  token: string;
  completedAt: bigint;
  wasDisputed: boolean;
}

interface ReviewStruct {
  offerId: bigint;
  reviewer: string;
  reviewee: string;
  rating: bigint;
  reviewURI: string;
  timestamp: bigint;
}

// Dispute views
interface DisputeHeaderStruct {
  cid: string;
  openedBy: string;
  openedAt: bigint;
  appealsCount: bigint;
}

interface DisputeAppealStruct {
  by: string;
  cid: string;
  timestamp: bigint;
}

// ABI return union types and type guards to avoid `any`
type ListingsBatchNamed = { out: ListingStruct[] };
type ListingsBatchReturn = ListingStruct[] | ListingsBatchNamed;
function isListingsBatchNamed(
  ret: ListingsBatchReturn
): ret is ListingsBatchNamed {
  return !Array.isArray(ret);
}

type ListingsDescTuple = [ListingStruct[], bigint, bigint];
type ListingsDescNamed = {
  page: ListingStruct[];
  nextCursor: bigint;
  count: bigint;
};
type ListingsDescReturn = ListingsDescTuple | ListingsDescNamed;
function isListingsDescNamed(
  ret: ListingsDescReturn
): ret is ListingsDescNamed {
  return !Array.isArray(ret);
}

type ListingsByCreatorTuple = [ListingStruct[], bigint];
type ListingsByCreatorNamed = { page: ListingStruct[]; returned: bigint };
type ListingsByCreatorReturn = ListingsByCreatorTuple | ListingsByCreatorNamed;
function isListingsByCreatorNamed(
  ret: ListingsByCreatorReturn
): ret is ListingsByCreatorNamed {
  return !Array.isArray(ret);
}

// Shape we return for UI reviews
type ReviewUI = {
  offerId: bigint;
  reviewer: string;
  reviewee: string;
  rating: number;
  reviewURI: string;
  timestamp: bigint;
};

export class MarketplaceContract {
  private contract: ethers.Contract;
  private signer: ethers.Signer | null = null;
  private provider: ethers.Provider;
  // Simple in-memory cache with TTL
  private cache = new Map<string, CacheValue>();
  // Increased default TTL to reduce refetching during navigation
  private defaultTTL = 60_000; // 60s default for reads
  // Track in-flight reads to dedupe concurrent identical requests
  private inflight = new Map<string, Promise<unknown>>();

  constructor(contractAddress: string, provider: ethers.Provider) {
    this.provider = provider;
    this.contract = new ethers.Contract(
      contractAddress,
      MARKETPLACE_ABI,
      provider
    );
  }

  // Cache helpers
  private cacheKey(
    parts: (string | number | bigint | boolean | null | undefined)[]
  ) {
    return parts.map((p) => String(p)).join(":");
  }

  private cacheGet<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  private cacheSet<T>(key: string, value: T, ttlMs?: number) {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTTL);
    this.cache.set(key, { value, expiresAt });
  }

  // Escape user/data-derived strings before embedding in RegExp
  private escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // New: helpers to map contract structs to TS types
  private mapListingStruct(l: ListingStruct): Listing {
    return {
      id: l.id,
      listingType: Number(l.listingType) as unknown as Listing["listingType"],
      creator: l.creator,
      metadataURI: l.metadataURI,
      createdAt: l.createdAt,
      active: l.active,
      boostExpiry: l.boostExpiry,
      category: l.category,
    } as Listing;
  }

  private mapOfferStruct(o: OfferStruct): Offer {
    return {
      id: o.id,
      listingId: o.listingId,
      proposer: o.proposer,
      amount: o.amount,
      paymentToken: o.paymentToken,
      createdAt: o.createdAt,
      accepted: o.accepted,
      cancelled: o.cancelled,
    } as Offer;
  }

  // New: probe if a listing id exists (id != 0)
  private async listingExists(id: bigint): Promise<boolean> {
    try {
      const l = (await this.contract.listings(id)) as ListingStruct;
      return Boolean(l && l.id && l.id !== BigInt(0));
    } catch {
      return false;
    }
  }

  // New: discover max listing id via new view function
  private async getMaxListingIdByIndex(opts?: CacheOptions): Promise<bigint> {
    // Backed by lastListingId() if available
    const cacheKey = "lastListingId";
    const cached = !opts?.force ? this.cacheGet<bigint>(cacheKey) : undefined;
    if (cached !== undefined) return cached;
    try {
      const v: bigint = await this.contract.lastListingId();
      this.cacheSet(cacheKey, v, opts?.ttlMs ?? 10_000);
      return v;
    } catch {
      // Fallback to previous discovery if the function isn't available
      let high = BigInt(1);
      if (!(await this.listingExists(high))) {
        this.cacheSet(cacheKey, BigInt(0), opts?.ttlMs ?? 10_000);
        return BigInt(0);
      }
      const SAFE_CAP = BigInt(1000000);
      while (high < SAFE_CAP && (await this.listingExists(high))) {
        high *= BigInt(2);
      }
      let low = high / BigInt(2);
      let hi = high;
      if (hi === SAFE_CAP && (await this.listingExists(hi))) {
        let cursor = hi + BigInt(1);
        const MAX_LINEAR_STEPS = BigInt(2000);
        let steps = BigInt(0);
        while (steps < MAX_LINEAR_STEPS && (await this.listingExists(cursor))) {
          low = cursor;
          cursor += BigInt(1);
          steps += BigInt(1);
        }
        hi = cursor;
      }
      while (low + BigInt(1) < hi) {
        const mid = (low + hi) / BigInt(2);
        if (await this.listingExists(mid)) {
          low = mid;
        } else {
          hi = mid;
        }
      }
      this.cacheSet(cacheKey, low, opts?.ttlMs ?? 10_000);
      return low;
    }
  }

  // Manually invalidate cache. If no keys provided, clears all.
  invalidateCache(keys?: string | RegExp | Array<string | RegExp>) {
    if (!keys) {
      this.cache.clear();
      return;
    }
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      if (k instanceof RegExp) {
        for (const key of Array.from(this.cache.keys())) {
          if (k.test(key)) this.cache.delete(key);
        }
      } else if (k.endsWith("*")) {
        const prefix = k.slice(0, -1);
        for (const key of Array.from(this.cache.keys())) {
          if (key.startsWith(prefix)) this.cache.delete(key);
        }
      } else {
        this.cache.delete(k);
      }
    }
  }

  connect(signer: ethers.Signer) {
    this.signer = signer;
    console.log(signer);
    this.contract = this.contract.connect(signer) as ethers.Contract;
    return this;
  }

  // Allow updating the provider while keeping the same instance (and cache)
  setProvider(provider: ethers.Provider) {
    if (this.provider === provider) return;
    this.provider = provider;
    const addr = this.contract.target as string;
    const runner = this.signer ?? provider;
    this.contract = new ethers.Contract(addr, MARKETPLACE_ABI, runner);
  }

  // Helper to get an ERC20 contract
  getErc20(token: string) {
    const base = new ethers.Contract(token, ERC20_ABI, this.provider);
    return this.signer ? base.connect(this.signer) : base;
  }

  // Ensure the connected signer has sufficient ERC20 allowance to the marketplace
  private async ensureAllowanceForCurrentSigner(
    token: string,
    spender: string,
    amount: bigint,
    approveMax = true
  ) {
    if (!this.signer) throw new Error("Signer required for write operations");
    if (!token || token === ethers.ZeroAddress) return; // ETH path doesn't need allowance

    const owner = await this.signer.getAddress();
    const erc20 = this.getErc20(token);
    const current: bigint = (await (
      erc20 as unknown as {
        allowance(owner: string, spender: string): Promise<bigint>;
      }
    ).allowance(owner, spender)) as unknown as bigint;
    if (current >= amount) return;

    const approveAmount = approveMax ? ethers.MaxUint256 : amount;
    // Some tokens (e.g., USDT) require resetting allowance to 0 before setting a new one
    if (current > BigInt(0)) {
      const tx0 = await (
        erc20 as unknown as {
          approve(
            spender: string,
            amount: bigint
          ): Promise<ethers.ContractTransactionResponse>;
        }
      ).approve(spender, BigInt(0));
      await tx0.wait();
    }
    const tx = await (
      erc20 as unknown as {
        approve(
          spender: string,
          amount: bigint
        ): Promise<ethers.ContractTransactionResponse>;
      }
    ).approve(spender, approveAmount);
    await tx.wait();
  }

  // New: Efficient last ids
  async getLastListingId(opts?: CacheOptions): Promise<bigint> {
    const key = "lastListingId";
    const cached = !opts?.force ? this.cacheGet<bigint>(key) : undefined;
    if (cached !== undefined) return cached;
    const v: bigint = await this.contract.lastListingId();
    this.cacheSet(key, v, opts?.ttlMs ?? 10_000);
    return v;
  }

  async getLastOfferId(opts?: CacheOptions): Promise<bigint> {
    const key = "lastOfferId";
    const cached = !opts?.force ? this.cacheGet<bigint>(key) : undefined;
    if (cached !== undefined) return cached;
    const v: bigint = await this.contract.lastOfferId();
    this.cacheSet(key, v, opts?.ttlMs ?? 10_000);
    return v;
  }

  // Listings
  async getListing(id: bigint, opts?: CacheOptions): Promise<Listing> {
    const key = this.cacheKey(["listing", id]);
    const cached = !opts?.force ? this.cacheGet<Listing>(key) : undefined;
    if (cached) return cached;
    const l = (await this.contract.listings(id)) as ListingStruct;
    const listing = this.mapListingStruct(l);
    this.cacheSet(key, listing, opts?.ttlMs);
    return listing;
  }

  // New: batch fetch listings by ids
  async getListingsBatch(
    ids: bigint[],
    opts?: CacheOptions
  ): Promise<Listing[]> {
    if (!ids || ids.length === 0) return [];
    const key = this.cacheKey(["listingsBatch", ids.join(",")]);
    const cached = !opts?.force ? this.cacheGet<Listing[]>(key) : undefined;
    if (cached) return cached;
    const raw = (await this.contract.getListingsBatch(
      ids
    )) as ListingsBatchReturn;
    let arr: ListingStruct[] = [];
    if (Array.isArray(raw)) {
      arr = raw as ListingStruct[];
    } else if (isListingsBatchNamed(raw)) {
      arr = raw.out ?? [];
    }
    const mapped = arr
      .map((l) => {
        if (!l || !l.id || l.id === BigInt(0)) return undefined;
        const m = this.mapListingStruct(l);
        // populate individual cache too
        this.cacheSet(this.cacheKey(["listing", m.id]), m, opts?.ttlMs);
        return m;
      })
      .filter(Boolean) as Listing[];
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  async createListing(
    listingType: number,
    category: bigint,
    metadataURI: string
  ) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.createListing(
      listingType,
      category,
      metadataURI
    );
    const receipt = await tx.wait();
    // Invalidate listing-related caches
    this.invalidateCache([
      /^(listing:)/,
      /^(listingsDesc:)/,
      /^(listingsByCreator:)/,
      /^lastListingId$/,
      /^listingsBatch:/,
    ]);
    return receipt;
  }

  // New: Page-wise descending listings using view function
  async getListingsDescending(
    startId?: bigint,
    limit?: number,
    options?: {
      onlyActive?: boolean;
      onlyBoosted?: boolean;
      filterByType?: boolean;
      listingType?: number; // matches solidity enum
      force?: boolean;
      ttlMs?: number;
    }
  ): Promise<Listing[]> {
    // default start from last id
    const fromId =
      startId ?? (await this.getLastListingId({ force: options?.force }));
    const lim = Math.max(0, limit ?? 50);
    const onlyActive = !!options?.onlyActive;
    const onlyBoosted = !!options?.onlyBoosted;
    const filterByType = !!options?.filterByType;
    const listingType = options?.listingType ?? 0;

    const key = this.cacheKey([
      "listingsDesc",
      fromId,
      lim,
      Number(onlyActive),
      Number(onlyBoosted),
      Number(filterByType),
      listingType,
    ]);

    if (!options?.force) {
      const cached = this.cacheGet<Listing[]>(key);
      if (cached) return cached;
      const pending = this.inflight.get(key) as Promise<Listing[]> | undefined;
      if (pending) return pending;
    }

    const promise = (async () => {
      const raw = (await this.contract.getListingsDescending(
        fromId,
        lim,
        onlyActive,
        onlyBoosted,
        filterByType,
        listingType
      )) as ListingsDescReturn;

      let arr: ListingStruct[] = [];
      if (Array.isArray(raw)) {
        // Tuple return: [page, nextCursor, count]
        arr = Array.isArray(raw[0]) ? (raw[0] as ListingStruct[]) : [];
      } else if (isListingsDescNamed(raw)) {
        // Named object return: { page, nextCursor, count }
        arr = Array.isArray(raw.page) ? (raw.page as ListingStruct[]) : [];
      }

      const mapped = (arr || [])
        .map((l) => {
          if (!l || !l.id || l.id === BigInt(0)) return undefined;
          const m = this.mapListingStruct(l);
          this.cacheSet(this.cacheKey(["listing", m.id]), m, options?.ttlMs);
          return m;
        })
        .filter(Boolean) as Listing[];

      this.cacheSet(key, mapped, options?.ttlMs);
      return mapped;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  // New: Enumerate all listings by index using new view, fetching up to max
  async fetchAllListingsByIndex(options?: {
    max?: number;
    pageSize?: number;
    onlyActive?: boolean;
    onlyBoosted?: boolean;
    filterByType?: boolean;
    listingType?: number;
    force?: boolean;
  }) {
    const startId = await this.getLastListingId({ force: options?.force });
    if (startId === BigInt(0)) return [];

    let remaining = options?.max ?? Number.MAX_SAFE_INTEGER;
    const pageSize = Math.max(1, Math.min(1000, options?.pageSize ?? 100));
    let cursor = startId;
    const all: Listing[] = [];

    while (remaining > 0 && cursor >= BigInt(1)) {
      const take = Math.min(pageSize, remaining);
      const page = await this.getListingsDescending(cursor, take, {
        onlyActive: options?.onlyActive,
        onlyBoosted: options?.onlyBoosted,
        filterByType: options?.filterByType,
        listingType: options?.listingType,
        // Force only on first page to refresh head; let cache help for older pages
        force: all.length === 0 ? options?.force : false,
      });

      if (!page.length) break;
      all.push(...page);
      remaining -= page.length;

      // Move cursor to just below the smallest id from this page to avoid duplicates
      let minId = page[page.length - 1].id;
      for (const l of page) if (l.id < minId) minId = l.id;
      if (minId <= BigInt(1)) break;
      cursor = minId - BigInt(1);
    }

    return all;
  }

  // New: Enumerate all listings by id range using batch view; robust when descending view is limited
  async fetchAllListingsByIdScan(options?: {
    fromId?: bigint; // default: lastListingId()
    toId?: bigint; // inclusive, default: 1n
    batchSize?: number; // default: 200
    max?: number; // optional cap on number of listings to return
    force?: boolean; // forces refreshing lastListingId cache for the initial head
    ttlMs?: number;
  }): Promise<Listing[]> {
    const start =
      options?.fromId ??
      (await this.getLastListingId({ force: options?.force }));
    const end = options?.toId ?? BigInt(1);
    if (start === BigInt(0) || start < end) return [];

    const size = Math.max(1, Math.min(1000, options?.batchSize ?? 200));
    const cap = options?.max ?? Number.MAX_SAFE_INTEGER;

    let cur = start;
    const out: Listing[] = [];

    while (cur >= end && out.length < cap) {
      const ids: bigint[] = [];
      for (let i = 0; i < size && cur >= end; i++) {
        ids.push(cur);
        cur -= BigInt(1);
      }
      // Query this chunk via the contract view
      const chunk = await this.getListingsBatch(ids, { ttlMs: options?.ttlMs });
      // Sort desc by id to keep newest-first ordering
      chunk.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
      // Respect max cap
      const remaining = cap - out.length;
      if (chunk.length > remaining) out.push(...chunk.slice(0, remaining));
      else out.push(...chunk);
    }

    return out;
  }

  // Offers
  async getOffer(id: bigint, opts?: CacheOptions): Promise<Offer> {
    const key = this.cacheKey(["offer", id]);
    const cached = !opts?.force ? this.cacheGet<Offer>(key) : undefined;
    if (cached) return cached;
    const o = await this.contract.offers(id);
    const offer = this.mapOfferStruct(o);
    this.cacheSet(key, offer, opts?.ttlMs);
    return offer;
  }

  // New: Paginated offers for a listing
  async getOffersForListing(
    listingId: bigint,
    offset: number,
    limit: number,
    opts?: CacheOptions
  ): Promise<Offer[]> {
    const key = this.cacheKey(["offersForListing", listingId, offset, limit]);
    const cached = !opts?.force ? this.cacheGet<Offer[]>(key) : undefined;
    if (cached) return cached;

    type OfferStruct = {
      id: bigint;
      listingId: bigint;
      proposer: string;
      amount: bigint;
      paymentToken: string;
      createdAt: bigint;
      accepted: boolean;
      cancelled: boolean;
    };
    type OffersTuple = [OfferStruct[], bigint];
    type OffersObj = { page: OfferStruct[]; returned: bigint };

    const raw = (await this.contract.getOffersForListing(
      listingId,
      offset,
      limit
    )) as unknown;

    let page: OfferStruct[] = [];
    if (Array.isArray(raw)) {
      // Tuple return
      const tup = raw as OffersTuple;
      page = Array.isArray(tup[0]) ? tup[0] : [];
    } else if (raw && typeof raw === "object") {
      // Named object return
      const obj = raw as OffersObj;
      page = Array.isArray(obj.page) ? obj.page : [];
    }

    const mapped = (page || []).map((o) => this.mapOfferStruct(o));
    for (const o of mapped) {
      this.cacheSet(this.cacheKey(["offer", o.id]), o, opts?.ttlMs);
    }
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  async makeOffer(listingId: bigint, amount: bigint, paymentToken: string) {
    if (!this.signer) throw new Error("Signer required for write operations");

    // For GIGs with ERC20 payments, the offer proposer (client) needs to approve allowance upfront
    // because they will be the payer when the offer is accepted
    try {
      const listing = await this.getListing(listingId);

      if (
        paymentToken &&
        paymentToken !== ethers.ZeroAddress &&
        Number(listing.listingType) === 1
      ) {
        // GIG + ERC20: proposer (current signer) will be the client (payer), so approve allowance now
        await this.ensureAllowanceForCurrentSigner(
          paymentToken,
          this.contractAddress,
          amount
        );
      }
      // For BRIEF: no allowance needed here because the listing creator will pay when accepting
      // For GIG + ETH: no allowance needed, ETH will be sent during acceptOffer
    } catch (error) {
      // If allowance fails, still proceed with offer creation and let acceptOffer handle the error
      console.warn("Failed to ensure allowance during makeOffer:", error);
    }

    // makeOffer only creates the offer record - actual payments happen during acceptOffer
    const tx = await this.contract.makeOffer(listingId, amount, paymentToken);
    const receipt = await tx.wait();

    // New offer impacts escrow/offer lookups by id (unknown) and maybe listing detail; clear broad offer caches.
    this.invalidateCache([/^(offer:)/, /^(escrow:)/, /^lastOfferId$/]);
    return receipt;
  }

  async cancelOffer(offerId: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.cancelOffer(offerId);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["offer", offerId]),
      this.cacheKey(["escrow", offerId]),
    ]);
    return receipt;
  }

  async acceptOffer(offerId: bigint, value?: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");

    let ofr: Offer | null = null;
    let listing: Listing | null = null;

    // Get offer and listing details to determine who pays
    try {
      ofr = await this.getOffer(offerId);
      listing = await this.getListing(ofr.listingId);

      // Determine the client (payer) based on listing type
      let client: string;
      if (Number(listing.listingType) === 0) {
        // BRIEF: listing creator is the client (payer)
        client = listing.creator.toLowerCase();
      } else {
        // GIG: offer proposer is the client (payer)
        client = ofr.proposer.toLowerCase();
      }

      const signerAddr = (await this.signer.getAddress()).toLowerCase();

      // Handle ERC20 allowance if needed
      if (ofr.paymentToken && ofr.paymentToken !== ethers.ZeroAddress) {
        if (signerAddr === client) {
          // Signer is the client (payer); ensure allowance
          await this.ensureAllowanceForCurrentSigner(
            ofr.paymentToken,
            this.contractAddress,
            ofr.amount
          );
        } else {
          // Signer isn't the client. Check if the actual client has allowance and balance.
          try {
            const erc20 = this.getErc20(ofr.paymentToken);
            const allowance: bigint = await (
              erc20 as unknown as {
                allowance(owner: string, spender: string): Promise<bigint>;
              }
            ).allowance(client, this.contractAddress);
            const balance: bigint = await (
              erc20 as unknown as {
                balanceOf(account: string): Promise<bigint>;
              }
            ).balanceOf(client);

            if (allowance < ofr.amount) {
              throw new Error(
                `The client must approve token allowance to the marketplace before acceptance. Current allowance: ${allowance.toString()}, Required: ${ofr.amount.toString()}`
              );
            }

            if (balance < ofr.amount) {
              throw new Error(
                `The client doesn't have sufficient token balance. Current balance: ${balance.toString()}, Required: ${ofr.amount.toString()}`
              );
            }
          } catch (error: unknown) {
            // If it's our custom error, throw it; otherwise ignore and let contract handle
            if (error instanceof Error && error.message.includes("client")) {
              throw error;
            }
            // ignore other read errors; the contract will enforce on-chain
          }
        }
      }
    } catch (error: unknown) {
      // ignore pre-check errors; proceed to send tx and let on-chain checks handle it
      console.warn("Pre-check failed, proceeding with transaction:", error);
    }

    // Determine ETH value to send if needed (native payment)
    const overrides: { value?: bigint } = {};
    if (value !== undefined) {
      overrides.value = value;
    } else if (ofr && listing && ofr.paymentToken === ethers.ZeroAddress) {
      // Only send ETH if the signer is the client (payer)
      const signerAddr = (await this.signer.getAddress()).toLowerCase();
      let client: string;
      if (Number(listing.listingType) === 0) {
        // BRIEF: listing creator is the client (payer)
        client = listing.creator.toLowerCase();
      } else {
        // GIG: offer proposer is the client (payer)
        client = ofr.proposer.toLowerCase();
      }

      if (signerAddr === client) {
        overrides.value = ofr.amount;
      }
    }

    // Call contract with proper overrides syntax
    let tx;
    if (Object.keys(overrides).length > 0) {
      // ETH payment - send value with transaction
      tx = await this.contract.acceptOffer(offerId, overrides);
    } else {
      // ERC20 payment - no value needed
      tx = await this.contract.acceptOffer(offerId);
    }

    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["offer", offerId]),
      this.cacheKey(["escrow", offerId]),
    ]);
    return receipt;
  }

  async validateWork(offerId: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.validateWork(offerId);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["offer", offerId]),
      this.cacheKey(["escrow", offerId]),
    ]);
    return receipt;
  }

  // Helper to extract portfolio URL from the portfolioURIs array
  getPortfolioURL(profile: OnchainUserProfile): string {
    return profile.portfolioURIs && profile.portfolioURIs.length > 0
      ? profile.portfolioURIs[0]
      : "";
  }

  // Profiles
  async getProfile(
    user: string,
    opts?: CacheOptions
  ): Promise<OnchainUserProfile> {
    const key = this.cacheKey(["profile", user.toLowerCase()]);
    const cached = !opts?.force
      ? this.cacheGet<OnchainUserProfile>(key)
      : undefined;
    if (cached) return cached;
    const p = (await this.contract.getProfile(user)) as ProfileStruct;
    const profile: OnchainUserProfile = {
      bio: p.bio,
      skills: p.skills,
      portfolioURIs: p.portfolioURIs,
      joinedAt: p.joinedAt,
      userType: Number(p.userType) as UserType,
      isVerified: p.isVerified,
    };
    this.cacheSet(key, profile, opts?.ttlMs);
    return profile;
  }

  async createProfile(
    bio: string,
    skills: string[],
    portfolioURL: string,
    userType: number
  ) {
    if (!this.signer) throw new Error("Signer required for write operations");

    // Validate portfolio URL
    if (portfolioURL && !portfolioURL.startsWith("https://")) {
      throw new Error("Portfolio URL must be a valid HTTPS link");
    }

    // Convert single URL to array for contract compatibility
    const portfolioURIs = portfolioURL ? [portfolioURL] : [];

    const tx = await this.contract.createProfile(
      bio,
      skills,
      portfolioURIs,
      userType
    );
    const receipt = await tx.wait();
    try {
      const addr = await this.signer.getAddress();
      this.invalidateCache([this.cacheKey(["profile", addr.toLowerCase()])]);
    } catch {}
    return receipt;
  }

  async updateProfile(bio: string, skills: string[], portfolioURL: string) {
    if (!this.signer) throw new Error("Signer required for write operations");

    // Validate portfolio URL
    if (portfolioURL && !portfolioURL.startsWith("https://")) {
      throw new Error("Portfolio URL must be a valid HTTPS link");
    }

    // Convert single URL to array for contract compatibility
    const portfolioURIs = portfolioURL ? [portfolioURL] : [];

    const tx = await this.contract.updateProfile(bio, skills, portfolioURIs);
    const receipt = await tx.wait();
    try {
      const addr = await this.signer.getAddress();
      this.invalidateCache([this.cacheKey(["profile", addr.toLowerCase()])]);
    } catch {}
    return receipt;
  }

  async verifyProfile(user: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.verifyProfile(user);
    const receipt = await tx.wait();
    this.invalidateCache([this.cacheKey(["profile", user.toLowerCase()])]);
    return receipt;
  }

  async getMissionHistory(
    user: string,
    opts?: CacheOptions
  ): Promise<Mission[]> {
    const key = this.cacheKey(["missions", user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<Mission[]>(key) : undefined;
    if (cached) return cached;
    const missions = (await this.contract.getMissionHistory(
      user
    )) as MissionStruct[];
    const mapped = missions.map((m) => ({
      escrowId: m.escrowId,
      client: m.client,
      provider: m.provider,
      amount: m.amount,
      token: m.token,
      completedAt: m.completedAt,
      wasDisputed: m.wasDisputed,
    }));
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  async getUserBadges(user: string, opts?: CacheOptions): Promise<Badge[]> {
    const key = this.cacheKey(["badges", user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<Badge[]>(key) : undefined;
    if (cached) return cached;
    const res = await this.contract.getUserBadges(user);
    this.cacheSet(key, res, opts?.ttlMs ?? 60_000);
    return res as Badge[];
  }

  async getAverageRating(user: string, opts?: CacheOptions): Promise<number> {
    const key = this.cacheKey(["avgRating", user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<number>(key) : undefined;
    if (cached !== undefined) return cached;
    const x: bigint = await this.contract.getAverageRating(user);
    const val = Number(x) / 100;
    this.cacheSet(key, val, opts?.ttlMs);
    return val;
  }

  async hasReviewed(
    offerId: bigint,
    user: string,
    opts?: CacheOptions
  ): Promise<boolean> {
    const key = this.cacheKey(["hasReviewed", offerId, user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<boolean>(key) : undefined;
    if (cached !== undefined) return cached;
    const res = await this.contract.hasReviewed(offerId, user);
    this.cacheSet(key, res, opts?.ttlMs);
    return res;
  }

  async leaveReview(offerId: bigint, rating: number, reviewURI: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.leaveReview(offerId, rating, reviewURI);
    const receipt = await tx.wait();
    // Invalidate reviews & ratings for both parties
    try {
      const esc = await this.getEscrow(offerId, { force: true });
      const targets = [esc.client, esc.provider].map((a) => a.toLowerCase());
      this.invalidateCache([
        ...targets.map((t) => this.cacheKey(["reviews", t])),
        ...targets.map((t) => this.cacheKey(["avgRating", t])),
        new RegExp(
          `^${this.escapeRegex(this.cacheKey(["hasReviewed", offerId]))}(:|$)`
        ),
      ]);
    } catch {
      // Broad fallback if lookup failed
      this.invalidateCache([/^(reviews:)/, /^(avgRating:)/]);
    }
    return receipt;
  }

  async getReviews(user: string, opts?: CacheOptions): Promise<ReviewUI[]> {
    const key = this.cacheKey(["reviews", user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<ReviewUI[]>(key) : undefined;
    if (cached) return cached;
    const reviews = (await this.contract.getReviews(user)) as ReviewStruct[];
    const mapped: ReviewUI[] = reviews.map((r) => ({
      offerId: r.offerId,
      reviewer: r.reviewer,
      reviewee: r.reviewee,
      rating: Number(r.rating),
      reviewURI: r.reviewURI,
      timestamp: r.timestamp,
    }));
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  // Escrow Management
  async getEscrow(offerId: bigint, opts?: CacheOptions): Promise<Escrow> {
    const key = this.cacheKey(["escrow", offerId]);
    const cached = !opts?.force ? this.cacheGet<Escrow>(key) : undefined;
    if (cached) return cached;
    const escrow = (await this.contract.getEscrow(offerId)) as EscrowStruct;
    const mapped: Escrow = {
      offerId: escrow.offerId,
      client: escrow.client,
      provider: escrow.provider,
      paymentToken: escrow.paymentToken,
      amount: escrow.amount,
      feeAmount: escrow.feeAmount,
      status: Number(escrow.status) as EscrowStatus,
      clientValidated: escrow.clientValidated,
      providerValidated: escrow.providerValidated,
      disputeOutcome: Number(escrow.disputeOutcome) as DisputeOutcome,
    };
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  // New: Dispute pagination via contract log
  async getDisputedOffers(
    offset: number,
    limit: number,
    opts?: CacheOptions
  ): Promise<{ page: bigint[]; returned: number }> {
    const key = this.cacheKey(["disputedOffers", offset, limit]);
    const cached = !opts?.force
      ? this.cacheGet<{ page: bigint[]; returned: number }>(key)
      : undefined;
    if (cached) return cached;
    const ret = (await this.contract.getDisputedOffers(
      BigInt(offset),
      BigInt(limit)
    )) as [bigint[], bigint] | { page: bigint[]; returned: bigint };
    const page = Array.isArray(ret) ? (ret[0] as bigint[]) : ret.page;
    const returned = Number(Array.isArray(ret) ? ret[1] : ret.returned);
    const value = { page, returned };
    this.cacheSet(key, value, opts?.ttlMs ?? 10_000);
    return value;
  }

  async getDisputeHeader(
    offerId: bigint,
    opts?: CacheOptions
  ): Promise<DisputeHeaderStruct> {
    const key = this.cacheKey(["disputeHeader", offerId]);
    const cached = !opts?.force
      ? this.cacheGet<DisputeHeaderStruct>(key)
      : undefined;
    if (cached) return cached;
    const ret = (await this.contract.getDisputeHeader(offerId)) as
      | [string, string, bigint, bigint]
      | DisputeHeaderStruct;
    const header: DisputeHeaderStruct = Array.isArray(ret)
      ? {
          cid: ret[0],
          openedBy: ret[1],
          openedAt: ret[2],
          appealsCount: ret[3],
        }
      : ret;
    this.cacheSet(key, header, opts?.ttlMs ?? 30_000);
    return header;
  }

  async getDisputeAppeal(
    offerId: bigint,
    index: number,
    opts?: CacheOptions
  ): Promise<DisputeAppealStruct> {
    const key = this.cacheKey(["disputeAppeal", offerId, index]);
    const cached = !opts?.force
      ? this.cacheGet<DisputeAppealStruct>(key)
      : undefined;
    if (cached) return cached;
    const ret = (await this.contract.getDisputeAppeal(
      offerId,
      BigInt(index)
    )) as [string, string, bigint] | DisputeAppealStruct;
    const appeal: DisputeAppealStruct = Array.isArray(ret)
      ? { by: ret[0], cid: ret[1], timestamp: ret[2] }
      : ret;
    this.cacheSet(key, appeal, opts?.ttlMs ?? 30_000);
    return appeal;
  }

  async getDisputeAppeals(
    offerId: bigint,
    opts?: CacheOptions
  ): Promise<DisputeAppealStruct[]> {
    const header = await this.getDisputeHeader(offerId, opts);
    const count = Number(header.appealsCount ?? BigInt(0));
    if (count === 0) return [];
    const items = await Promise.all(
      Array.from({ length: count }).map((_, i) =>
        this.getDisputeAppeal(offerId, i, opts)
      )
    );
    return items;
  }

  async openDispute(offerId: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.openDispute(offerId);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["escrow", offerId]),
      /^(disputedOffers:)/,
      this.cacheKey(["disputeHeader", offerId]),
    ]);
    return receipt;
  }

  // New: open dispute with metadata CID (JSON/IPFS or data URL)
  async openDisputeWithCID(offerId: bigint, cid: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.openDisputeWithCID(offerId, cid);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["escrow", offerId]),
      /^(disputedOffers:)/,
      this.cacheKey(["disputeHeader", offerId]),
    ]);
    return receipt;
  }

  // New: appeal an active dispute with a metadata CID
  async appealDispute(offerId: bigint, cid: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.appealDispute(offerId, cid);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["escrow", offerId]),
      this.cacheKey(["disputeHeader", offerId]),
      new RegExp(
        `^${this.escapeRegex(this.cacheKey(["disputeAppeal", offerId]))}(:|$)`
      ),
    ]);
    return receipt;
  }

  async resolveDispute(offerId: bigint, outcome: number) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.resolveDispute(offerId, outcome);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["escrow", offerId]),
      /^(disputedOffers:)/,
      this.cacheKey(["disputeHeader", offerId]),
    ]);
    return receipt;
  }

  // Listing Management
  async setListingActive(listingId: bigint, active: boolean) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setListingActive(listingId, active);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["listing", listingId]),
      this.cacheKey(["isBoosted", "list", listingId]),
      /^(listingsDesc:)/,
    ]);
    return receipt;
  }

  async isBoosted(listingId: bigint, opts?: CacheOptions): Promise<boolean> {
    const key = this.cacheKey(["isBoosted", "list", listingId]);
    const cached = !opts?.force ? this.cacheGet<boolean>(key) : undefined;
    if (cached !== undefined) return cached;
    const res = await this.contract.isBoosted(listingId);
    this.cacheSet(key, res, opts?.ttlMs);
    return res;
  }

  async buyBoost(listingId: bigint, dopAmount: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");

    // Ensure DOP allowance (best-effort)
    try {
      const dop = await this.getDopToken().catch(() => "");
      if (dop && dop !== ethers.ZeroAddress && dopAmount > BigInt(0)) {
        await this.ensureAllowanceForCurrentSigner(
          dop,
          this.contractAddress,
          dopAmount
        );
      }
    } catch (e) {
      console.warn("Failed to ensure DOP allowance for buyBoost:", e);
    }

    const tx = await this.contract.buyBoost(listingId, dopAmount);
    const receipt = await tx.wait();
    this.invalidateCache([
      this.cacheKey(["isBoosted", "list", listingId]),
      this.cacheKey(["listing", listingId]),
      "boostParams",
    ]);
    return receipt;
  }

  async getBoostParams(
    opts?: CacheOptions
  ): Promise<{ price: bigint; duration: bigint }> {
    const key = "boostParams";
    const cached = !opts?.force
      ? this.cacheGet<{ price: bigint; duration: bigint }>(key)
      : undefined;
    if (cached) return cached;
    const price = await this.contract.boostPriceDOP();
    const duration = await this.contract.boostDuration();
    const val = { price, duration };
    this.cacheSet(key, val, opts?.ttlMs ?? 60_000);
    return val;
  }

  // Profile boosting
  async isProfileBoosted(user: string, opts?: CacheOptions) {
    const key = this.cacheKey(["isProfileBoosted", user.toLowerCase()]);
    const cached = !opts?.force ? this.cacheGet<boolean>(key) : undefined;
    if (cached !== undefined) return cached;
    const res = await this.contract.isProfileBoosted(user);
    this.cacheSet(key, res, opts?.ttlMs);
    return res;
  }

  // New: listings by creator (paginated)
  async getListingsByCreator(
    creator: string,
    offset: number,
    limit: number,
    opts?: CacheOptions
  ): Promise<Listing[]> {
    const key = this.cacheKey([
      "listingsByCreator",
      creator.toLowerCase(),
      offset,
      limit,
    ]);
    const cached = !opts?.force ? this.cacheGet<Listing[]>(key) : undefined;
    if (cached) return cached;

    const raw = (await this.contract.getListingsByCreator(
      creator,
      offset,
      limit
    )) as ListingsByCreatorReturn;

    let arr: ListingStruct[] = [];
    if (Array.isArray(raw)) {
      const tup = raw as ListingsByCreatorTuple;
      arr = Array.isArray(tup[0]) ? tup[0] : [];
    } else if (isListingsByCreatorNamed(raw)) {
      arr = Array.isArray(raw.page) ? raw.page : [];
    }

    const mapped = arr.map((l) => this.mapListingStruct(l));
    for (const l of mapped) {
      this.cacheSet(this.cacheKey(["listing", l.id]), l, opts?.ttlMs);
    }
    this.cacheSet(key, mapped, opts?.ttlMs);
    return mapped;
  }

  async getProfileBoostParams(
    opts?: CacheOptions
  ): Promise<{ price: bigint; duration: bigint }> {
    const key = "profileBoostParams";
    const cached = !opts?.force
      ? this.cacheGet<{ price: bigint; duration: bigint }>(key)
      : undefined;
    if (cached) return cached;
    const price = await this.contract.profileBoostPriceDOP();
    const duration = await this.contract.profileBoostDuration();
    const val = { price, duration };
    this.cacheSet(key, val, opts?.ttlMs ?? 60_000);
    return val;
  }

  async buyProfileBoost(dopAmount: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");

    // Ensure DOP allowance (best-effort)
    try {
      const dop = await this.getDopToken().catch(() => "");
      if (dop && dop !== ethers.ZeroAddress && dopAmount > BigInt(0)) {
        await this.ensureAllowanceForCurrentSigner(
          dop,
          this.contractAddress,
          dopAmount
        );
      }
    } catch (e) {
      console.warn("Failed to ensure DOP allowance for buyProfileBoost:", e);
    }

    const tx = await this.contract.buyProfileBoost(dopAmount);
    const receipt = await tx.wait();
    try {
      const addr = (await this.signer.getAddress()).toLowerCase();
      this.invalidateCache([
        this.cacheKey(["isProfileBoosted", addr]),
        "profileBoostParams",
      ]);
    } catch {}
    return receipt;
  }

  // Contract Info & Settings
  async getFees(
    opts?: CacheOptions
  ): Promise<{ feeUsdLike: bigint; feeDop: bigint }> {
    const key = "fees";
    const cached = !opts?.force
      ? this.cacheGet<{ feeUsdLike: bigint; feeDop: bigint }>(key)
      : undefined;
    if (cached) return cached;
    const feeUsdLike = await this.contract.feeUsdLike();
    const feeDop = await this.contract.feeDop();
    const val = { feeUsdLike, feeDop };
    this.cacheSet(key, val, opts?.ttlMs ?? 60_000);
    return val;
  }

  async getTreasury(opts?: CacheOptions): Promise<string> {
    const key = "treasury";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const t = await this.contract.treasury();
    this.cacheSet(key, t, opts?.ttlMs ?? 60_000);
    return t;
  }

  async getDopToken(opts?: CacheOptions): Promise<string> {
    const key = "dopToken";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const v = await this.contract.dopToken();
    this.cacheSet(key, v, opts?.ttlMs ?? 300_000);
    return v;
  }

  async getUsdcToken(opts?: CacheOptions): Promise<string> {
    const key = "usdcToken";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const v = await this.contract.usdcToken();
    this.cacheSet(key, v, opts?.ttlMs ?? 300_000);
    return v;
  }

  async isPaused(opts?: CacheOptions): Promise<boolean> {
    const key = "paused";
    const cached = !opts?.force ? this.cacheGet<boolean>(key) : undefined;
    if (cached !== undefined) return cached;
    const v = await this.contract.paused();
    this.cacheSet(key, v, opts?.ttlMs ?? 5_000);
    return v;
  }

  // New: owner and router getters for admin UI
  async getOwner(opts?: CacheOptions): Promise<string> {
    const key = "owner";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const v = await this.contract.owner();
    this.cacheSet(key, v, opts?.ttlMs ?? 60_000);
    return v;
  }

  async getDexRouter(opts?: CacheOptions): Promise<string> {
    const key = "dexRouter";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const v = await this.contract.dexRouter();
    this.cacheSet(key, v, opts?.ttlMs ?? 300_000);
    return v;
  }

  async getWeth(opts?: CacheOptions): Promise<string> {
    const key = "weth";
    const cached = !opts?.force ? this.cacheGet<string>(key) : undefined;
    if (cached) return cached;
    const v = await this.contract.weth();
    this.cacheSet(key, v, opts?.ttlMs ?? 300_000);
    return v;
  }

  // Admin functions (owner only)
  async pause() {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.pause();
    const receipt = await tx.wait();
    this.invalidateCache(["paused"]);
    return receipt;
  }

  async unpause() {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.unpause();
    const receipt = await tx.wait();
    this.invalidateCache(["paused"]);
    return receipt;
  }

  async setFees(feeUsdLike: bigint, feeDop: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setFees(feeUsdLike, feeDop);
    const receipt = await tx.wait();
    this.invalidateCache(["fees"]);
    return receipt;
  }

  async setBoostParams(price: bigint, duration: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setBoostParams(price, duration);
    const receipt = await tx.wait();
    this.invalidateCache(["boostParams"]);
    return receipt;
  }

  async setProfileBoostParams(price: bigint, duration: bigint) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setProfileBoostParams(price, duration);
    const receipt = await tx.wait();
    this.invalidateCache(["profileBoostParams"]);
    return receipt;
  }

  async setTreasury(treasury: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setTreasury(treasury);
    const receipt = await tx.wait();
    this.invalidateCache(["treasury"]);
    return receipt;
  }

  async setDexRouter(dexRouter: string, weth: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setDexRouter(dexRouter, weth);
    const receipt = await tx.wait();
    // Router change could affect pricing/fees indirectly; no direct cache keys linked.
    return receipt;
  }

  async setTokens(dop: string, usdc: string) {
    if (!this.signer) throw new Error("Signer required for write operations");
    const tx = await this.contract.setTokens(dop, usdc);
    const receipt = await tx.wait();
    this.invalidateCache(["dopToken", "usdcToken"]);
    return receipt;
  }

  // Getters for contract internals (needed for event parsing)
  get contractAddress(): string {
    return this.contract.target as string;
  }

  get contractInterface() {
    return this.contract.interface;
  }
}

function isValidAddress(addr?: string | null) {
  return !!addr && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export const CONTRACT_ADDRESSES = {
  2741: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_ABSTRACT || "",
  11124: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_ABSTRACT_TESTNET || "",
} as const;

// Maintain a singleton contract instance per chain/address so cache survives navigation
const CONTRACT_INSTANCE_REGISTRY = new Map<string, MarketplaceContract>();

export function getMarketplaceContract(
  chainId: number,
  provider: ethers.Provider
) {
  const address =
    CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
  if (!isValidAddress(address)) {
    const envName =
      chainId === 11124
        ? "NEXT_PUBLIC_MARKETPLACE_ADDRESS_ABSTRACT_TESTNET"
        : "NEXT_PUBLIC_MARKETPLACE_ADDRESS_ABSTRACT";
    throw new Error(
      `Marketplace contract address is not configured for chain ${chainId}. Please set ${envName} in your .env.local`
    );
  }

  const key = `${chainId}:${address.toLowerCase()}`;
  const existing = CONTRACT_INSTANCE_REGISTRY.get(key);
  if (existing) {
    existing.setProvider(provider);
    return existing;
  }

  const instance = new MarketplaceContract(address, provider);
  CONTRACT_INSTANCE_REGISTRY.set(key, instance);
  return instance;
}

export function getTokenAddresses(chainId: number) {
  const entry = TOKENS[chainId as keyof typeof TOKENS];
  return entry || { DOP: "", USDC: "" };
}

// EIP-1193 helpers to auto-switch/add the target chain in injected wallets (e.g., MetaMask)
// These helpers are exported for use by the UI before instantiating/connecting the contract.

type EIP1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

// Removed global Window augmentation to avoid conflicts with existing type definitions in the project

type AddEthereumChainParameter = {
  chainId: string; // 0x-prefixed hex string
  chainName: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
  iconUrls?: string[];
};

function getInjectedEthereum(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const maybe = (window as unknown as { ethereum?: unknown }).ethereum;
  return maybe as EIP1193Provider | undefined;
}

function toHexChainId(chainId: number) {
  return "0x" + chainId.toString(16);
}

function chainParamsFor(chainId: number): AddEthereumChainParameter {
  const id = String(chainId);
  const name =
    process.env[`NEXT_PUBLIC_CHAIN_NAME_${id}`] ||
    process.env.NEXT_PUBLIC_CHAIN_NAME ||
    `Chain ${id}`;
  const symbol =
    process.env[`NEXT_PUBLIC_CHAIN_SYMBOL_${id}`] ||
    process.env.NEXT_PUBLIC_CHAIN_SYMBOL ||
    "ETH";
  const rpc =
    process.env[`NEXT_PUBLIC_RPC_URL_${id}`] ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    "";
  const explorer =
    process.env[`NEXT_PUBLIC_EXPLORER_URL_${id}`] ||
    process.env.NEXT_PUBLIC_EXPLORER_URL ||
    "";

  if (!rpc) {
    throw new Error(
      `Missing RPC URL for chain ${chainId}. Define NEXT_PUBLIC_RPC_URL_${id} or NEXT_PUBLIC_RPC_URL in .env.local`
    );
  }

  return {
    chainId: toHexChainId(chainId),
    chainName: name,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: [rpc],
    blockExplorerUrls: explorer ? [explorer] : [],
  };
}

function asEthersEip1193(p: EIP1193Provider): ethers.Eip1193Provider {
  return p as unknown as ethers.Eip1193Provider;
}

export async function ensureChain(
  targetChainId: number,
  paramsOverride?: Partial<AddEthereumChainParameter>
): Promise<void> {
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");

  const hexId = toHexChainId(targetChainId);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
    return;
  } catch (err: unknown) {
    const e = err as {
      code?: number;
      data?: { originalError?: { code?: number } };
    };
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code === 4902) {
      // Unrecognized chain - add then switch
      const params = {
        ...chainParamsFor(targetChainId),
        ...paramsOverride,
      } as AddEthereumChainParameter;
      // Ensure chainId is the correct hex string even if override provided
      params.chainId = hexId;

      await eth.request({
        method: "wallet_addEthereumChain",
        params: [params],
      });
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
      return;
    }
    if (code === 4001) throw err; // User rejected
    throw err;
  }
}

export async function connectAndEnsureChain(targetChainId: number) {
  const eth = getInjectedEthereum();
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");

  // Request account access
  await eth.request({ method: "eth_requestAccounts" });

  // Use "any" so provider stays usable across network changes
  let provider = new ethers.BrowserProvider(asEthersEip1193(eth), "any");
  const net = await provider.getNetwork();

  if (Number(net.chainId) !== targetChainId) {
    await ensureChain(targetChainId);
    provider = new ethers.BrowserProvider(asEthersEip1193(eth), "any");
  }

  const signer = await provider.getSigner();
  return { provider, signer };
}

// Convenience initializer: ensure wallet is on the correct chain, then
// return a connected MarketplaceContract using the injected wallet.
export async function createMarketplaceWithWallet(
  contractAddress: string,
  targetChainId: number
): Promise<MarketplaceContract> {
  const { provider, signer } = await connectAndEnsureChain(targetChainId);
  const instance = new MarketplaceContract(contractAddress, provider);
  instance.connect(signer);
  return instance;
}
