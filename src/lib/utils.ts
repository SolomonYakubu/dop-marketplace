import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ethers, toUtf8String } from "ethers";
import {
  Listing,
  ListingType,
  UserType,
  ListingMetadata,
  Badge,
} from "@/types/marketplace";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(
  address: string,
  startLength: number = 6,
  endLength: number = 4
): string {
  if (!address) return "";
  if (address.length <= startLength + endLength) return address;
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

export function formatEther(
  value: string | bigint,
  decimals: number = 4
): string {
  try {
    const num = typeof value === "string" ? parseFloat(value) : Number(value);
    return num.toFixed(decimals);
  } catch {
    return "0";
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function normalizeGatewayBase(base?: string | null): string {
  if (!base) return "";
  let b = base.trim();
  // Strip trailing slashes
  b = b.replace(/\/+$/, "");
  // If it already includes /ipfs, keep it; otherwise append /ipfs
  if (!/\/ipfs(\/|$)/.test(b)) {
    b = `${b}/ipfs`;
  }
  // Ensure trailing slash
  return `${b}/`;
}

export function toGatewayUrl(uri?: string | null): string | null {
  if (!uri) return null;
  // If it's already http(s), return as-is
  if (/^https?:\/\//i.test(uri)) return uri;

  const base = "https://ipfs.io/ipfs/";

  // Handle common IPFS forms
  // ipfs://CID[/path]
  const ipfsMatch = uri.match(/^ipfs:\/\/(.+)$/i);
  if (ipfsMatch) {
    const rest = ipfsMatch[1].replace(/^ipfs\//i, ""); // strip optional ipfs/ prefix
    return `${base}${rest}`;
  }
  // /ipfs/CID[/path]
  if (/^\/ipfs\//i.test(uri)) {
    const rest = uri.replace(/^\/ipfs\//i, "");
    return `${base}${rest}`;
  }
  // Bare CID or CID with path
  if (/^[a-z0-9]{46,}(?:\/.*)?$/i.test(uri)) {
    return `${base}${uri}`;
  }

  return uri;
}

// Removed uploadJsonToIpfs: uploads are handled by a dedicated API route.

// ---- Token formatting helpers (global) ----
export type KnownTokens = { USDC?: string; DOP?: string };

export function tokenSymbolFor(
  tokenAddress: string,
  tokens?: KnownTokens
): string {
  const a = (tokenAddress || "").toLowerCase();
  if (a === ethers.ZeroAddress.toLowerCase()) return "ETH";
  if (tokens?.USDC && a === tokens.USDC.toLowerCase()) return "USDC";
  if (tokens?.DOP && a === tokens.DOP.toLowerCase()) return "DOP";
  return "Token";
}

export function knownDecimalsFor(
  tokenAddress: string,
  tokens?: KnownTokens
): number | undefined {
  const a = (tokenAddress || "").toLowerCase();
  if (!a) return undefined;
  if (a === ethers.ZeroAddress.toLowerCase()) return 18; // ETH
  if (tokens?.USDC && a === tokens.USDC.toLowerCase()) return 6; // USDC
  if (tokens?.DOP && a === tokens.DOP.toLowerCase()) return 18; // DOP
  return undefined;
}

export function formatTokenAmount(
  amount: bigint | string,
  tokenAddress: string,
  opts?: { tokens?: KnownTokens; decimals?: number; maxFractionDigits?: number }
): string {
  const decimals =
    opts?.decimals ?? knownDecimalsFor(tokenAddress, opts?.tokens) ?? 18;
  try {
    const v = typeof amount === "string" ? BigInt(amount) : amount;
    const s = ethers.formatUnits(v, decimals);
    if (opts?.maxFractionDigits != null) {
      const [i, f = ""] = s.split(".");
      const trimmed = f.slice(0, opts.maxFractionDigits);
      return trimmed.length ? `${i}.${trimmed}` : i;
    }
    return s;
  } catch {
    return typeof amount === "string" ? amount : String(amount);
  }
}

export function formatTokenAmountWithSymbol(
  amount: bigint | string,
  tokenAddress: string,
  opts?: { tokens?: KnownTokens; decimals?: number; maxFractionDigits?: number }
): string {
  const value = formatTokenAmount(amount, tokenAddress, opts);
  const symbol = tokenSymbolFor(tokenAddress, opts?.tokens);
  return `${value} ${symbol}`.trim();
}

// ---- Shared common types and helpers ----
export type AnyRecord = Record<string, unknown>;

export function asRecord(v: unknown): AnyRecord | undefined {
  return v && typeof v === "object" ? (v as AnyRecord) : undefined;
}
export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
export function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
}
export function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  return undefined;
}

// Fetch helper with timeout
export async function fetchWithTimeout(
  url: string,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Metadata helpers
export function stripNulls(s: string) {
  return s.replace(/\u0000+$/g, "");
}

export function normalizeMetadataUri(raw: unknown): string | null {
  if (raw == null) return null;
  let uri = String(raw).trim();
  uri = stripNulls(uri);

  // Unwrap quotes if present
  if (
    (uri.startsWith('"') && uri.endsWith('"')) ||
    (uri.startsWith("'") && uri.endsWith("'"))
  ) {
    uri = uri.slice(1, -1);
  }

  // Decode hex-encoded utf8 (common when coming from bytes)
  if (/^0x[0-9a-fA-F]+$/.test(uri)) {
    try {
      uri = stripNulls(toUtf8String(uri));
    } catch {
      // ignore
    }
  }

  // Raw JSON embedded directly
  if (uri.startsWith("{") || uri.startsWith("[")) {
    return uri;
  }

  // Arweave shorthand
  if (uri.startsWith("ar://")) {
    return "https://arweave.net/" + uri.slice(5);
  }

  // IPFS
  if (uri.startsWith("ipfs://")) {
    const maybe = toGatewayUrl(uri);
    return maybe || `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }

  return uri || null;
}

export function parseDataUrlJson(u: string): AnyRecord | undefined {
  try {
    const m = u.match(
      /^data:application\/json(?:;charset=[^;]+)?(?:;(base64))?,(.*)$/i
    );
    if (!m) return;
    const isB64 = !!m[1];
    const payload = m[2];
    const decoded = isB64 ? atob(payload) : decodeURIComponent(payload);
    const parsed: unknown = JSON.parse(decoded);
    return asRecord(parsed);
  } catch {
    return;
  }
}

export function coerceListingMetadata(
  raw: AnyRecord,
  listing: Listing
): ListingMetadata {
  const title =
    asString(raw["title"]) ||
    asString(raw["name"]) ||
    `Brief #${listing.id.toString()}`;
  const description =
    asString(raw["description"]) || asString(raw["details"]) || "";

  const categoryVal = raw["category"];
  let category = asNumber(categoryVal);
  if (category == null || Number.isNaN(category)) {
    category = Number(listing.category);
  }

  const budgetRaw = asRecord(raw["budget"]) || asRecord(raw["pricing"]);
  let budget: ListingMetadata["budget"] | undefined;
  if (budgetRaw) {
    budget = {
      min: asNumber(budgetRaw["min"]),
      max: asNumber(budgetRaw["max"]),
      currency: asString(budgetRaw["currency"]) || "USD",
    };
  }

  return {
    title,
    description,
    image: asString(raw["image"]),
    category: category ?? Number(listing.category),
    type: ListingType.BRIEF,
    requirements:
      asStringArray(raw["requirements"]) || asStringArray(raw["tags"]),
    deliverables: asStringArray(raw["deliverables"]),
    timeline: asString(raw["timeline"]),
    budget,
    attachments: asStringArray(raw["attachments"]),
  };
}

export async function loadListingMetadataFromURI(
  uriRaw: unknown,
  listing: Listing,
  timeoutMs = 6000
): Promise<ListingMetadata | undefined> {
  const normalized = normalizeMetadataUri(uriRaw);
  if (!normalized) return;

  // Data URL json
  if (normalized.startsWith("data:")) {
    const json = parseDataUrlJson(normalized);
    if (json) return coerceListingMetadata(json, listing);
  }

  // Raw JSON string
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(normalized);
      const json = asRecord(parsed);
      if (json) return coerceListingMetadata(json, listing);
    } catch {
      // fall through
    }
  }

  // Build a list of candidate URLs to try
  const candidates: string[] = [];
  if (normalized.startsWith("http")) {
    candidates.push(normalized);
  } else if (normalized.startsWith("ipfs://")) {
    const cidPath = normalized.slice(7);
    const primary = toGatewayUrl(normalized);
    if (primary) candidates.push(primary);
    candidates.push(`https://ipfs.io/ipfs/${cidPath}`);
    candidates.push(`https://cloudflare-ipfs.com/ipfs/${cidPath}`);
  } else {
    const gw = toGatewayUrl(normalized);
    if (gw) candidates.push(gw);
  }

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const parsed: unknown = await res.json();
        const json = asRecord(parsed);
        if (json) return coerceListingMetadata(json, listing);
      } else {
        const text = await res.text();
        try {
          const parsed: unknown = JSON.parse(text);
          const json = asRecord(parsed);
          if (json) return coerceListingMetadata(json, listing);
        } catch {
          // treat as plain text description
          return coerceListingMetadata(
            {
              title: undefined,
              description: text,
              category: Number(listing.category),
            },
            listing
          );
        }
      }
    } catch {
      // try next
    }
  }

  // Fallback
  return coerceListingMetadata(
    {
      title: `Brief #${listing.id.toString()}`,
      description: "",
      category: Number(listing.category),
    },
    listing
  );
}

// Misc UI helpers
export function getRpcUrl(chainId: number) {
  return chainId === 2741
    ? "https://api.mainnet.abs.xyz"
    : "https://api.testnet.abs.xyz";
}

export function timeAgo(tsSec: number) {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function getCategoryLabel(category: number) {
  switch (category) {
    case UserType.PROJECT_OWNER:
      return "Project Owner";
    case UserType.DEVELOPER:
      return "Developer";
    case UserType.ARTIST:
      return "Artist";
    case UserType.KOL:
      return "KOL";
    default:
      return "Other";
  }
}

// New: shared badge label helper
export function getBadgeLabel(badge: Badge) {
  switch (badge) {
    case Badge.ROOKIE:
      return "Rookie";
    case Badge.RELIABLE:
      return "Reliable";
    case Badge.EXPERT:
      return "Expert";
    case Badge.MASTER:
      return "Master";
    case Badge.LEGEND:
      return "Legend";
    case Badge.DISPUTE_RESOLVER:
      return "Dispute Resolver";
    case Badge.HIGH_EARNER:
      return "High Earner";
    case Badge.PROLIFIC:
      return "Prolific";
    default:
      return "Unknown Badge";
  }
}

// ------------------------------------------------------------
// IPFS JSON helper with concurrency + caching (for dispute/appeal metadata)
// ------------------------------------------------------------

const __ipfsJsonCache: Map<string, { ts: number; data: unknown }> = new Map();
const __ipfsInFlight: Map<string, Promise<unknown>> = new Map();

function buildIpfsCandidateUrls(cidOrUri: string): string[] {
  const urls: string[] = [];
  // Direct HTTP(S)
  if (/^https?:\/\//i.test(cidOrUri)) {
    urls.push(cidOrUri);
  }
  // Attempt to normalize to gateway URL if not already http(s)
  const gwPrimary = toGatewayUrl(cidOrUri);
  if (gwPrimary) urls.push(gwPrimary);

  // Extract CID/path for common gateways
  let cidPath = cidOrUri.trim();
  if (cidPath.startsWith("ipfs://")) cidPath = cidPath.slice(7);
  cidPath = cidPath.replace(/^ipfs\//i, "");
  cidPath = cidPath.replace(/^\/?ipfs\//i, "");

  if (cidPath && !/^https?:\/\//i.test(cidPath)) {
    const bases = [
      process.env.NEXT_PUBLIC_IPFS_GATEWAY?.replace(/\/$/, ""),
      "https://gateway.pinata.cloud/ipfs",
      "https://ipfs.io/ipfs",
      "https://cloudflare-ipfs.com/ipfs",
      "https://dweb.link/ipfs",
    ].filter(Boolean) as string[];
    for (const b of bases) {
      urls.push(`${b}/${cidPath}`);
    }
  }
  // Deduplicate preserving order
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const u of urls) {
    if (!seen.has(u)) {
      seen.add(u);
      dedup.push(u);
    }
  }
  return dedup;
}

function promiseAny<T>(promises: Promise<T>[]): Promise<T> {
  // Lightweight polyfill
  return new Promise<T>((resolve, reject) => {
    let rejected = 0;
    const errors: unknown[] = [];
    const total = promises.length;
    if (total === 0) {
      reject(new Error("No promises"));
      return;
    }
    promises.forEach((p) => {
      p.then(resolve).catch((e) => {
        rejected++;
        errors.push(e);
        if (rejected === total) {
          reject(errors);
        }
      });
    });
  });
}

async function fetchAndParseJson(
  url: string,
  timeoutMs: number
): Promise<unknown> {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json();
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // If not JSON we signal failure so other gateways can try
    throw new Error("Non-JSON response");
  }
}

export async function fetchIpfsJson(
  cidOrUri: string,
  opts?: { timeoutMs?: number; cacheTtlMs?: number }
): Promise<unknown> {
  const key = cidOrUri;
  const timeoutMs = opts?.timeoutMs ?? 5500;
  const cacheTtlMs = opts?.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes

  // Cache hit
  const cached = __ipfsJsonCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < cacheTtlMs) {
    return cached.data;
  }

  // In-flight de-dupe
  const inflight = __ipfsInFlight.get(key);
  if (inflight) return inflight;

  const attempt = (async () => {
    const candidates = buildIpfsCandidateUrls(cidOrUri);
    // Strategy: fire first three concurrently (or all if fewer), then fall back sequentially if they all fail.
    const primaryBatch = candidates
      .slice(0, 3)
      .map((u) => fetchAndParseJson(u, timeoutMs));
    try {
      const data = await promiseAny(primaryBatch);
      __ipfsJsonCache.set(key, { ts: Date.now(), data });
      return data;
    } catch {
      // Try remaining sequentially
      for (const url of candidates.slice(3)) {
        try {
          const data = await fetchAndParseJson(url, timeoutMs);
          __ipfsJsonCache.set(key, { ts: Date.now(), data });
          return data;
        } catch {
          // continue
        }
      }
      throw new Error("All IPFS gateways failed");
    } finally {
      __ipfsInFlight.delete(key);
    }
  })();

  __ipfsInFlight.set(key, attempt);
  return attempt;
}

// Helper to manually clear cache if needed
export function clearIpfsJsonCache() {
  __ipfsJsonCache.clear();
  __ipfsInFlight.clear();
}
