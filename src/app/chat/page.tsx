"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useAccount } from "wagmi";
import { supabase } from "@/lib/supabaseClient";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { toGatewayUrl, formatAddress, timeAgo } from "@/lib/utils";
import { UserCircle2 } from "lucide-react";

// DB row for a direct chat pair
type DirectDoc = { user_lo: string; user_hi: string; updated_at: string };

export default function ChatInboxPage() {
  const { address } = useAccount();
  const { contract } = useMarketplaceContract();
  const [rows, setRows] = useState<DirectDoc[]>([]);
  const me = useMemo(() => address?.toLowerCase() || "", [address]);
  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; profilePicCID?: string }>
  >({});
  const [q, setQ] = useState("");
  const router = useRouter();

  // Load recent chat pairs for the current user
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("direct_chats")
        .select("user_lo,user_hi,updated_at")
        .or(`user_lo.eq.${me},user_hi.eq.${me}`)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (!cancelled) setRows((data as DirectDoc[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  // Resolve minimal identity for chat partners (username + avatar)
  useEffect(() => {
    if (!contract || rows.length === 0 || !me) return;
    const partners = Array.from(
      new Set(rows.map((r) => (r.user_lo === me ? r.user_hi : r.user_lo)))
    ).map((x) => x.toLowerCase());
    const missing = partners.filter((p) => !profiles[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<
        string,
        { username?: string; profilePicCID?: string }
      > = {};
      await Promise.all(
        missing.map(async (addr) => {
          try {
            interface RawP {
              joinedAt: bigint;
              username?: string;
              profilePicCID?: string;
            }
            const p: RawP = await (
              contract as unknown as {
                getProfile: (a: string) => Promise<RawP>;
              }
            ).getProfile(addr);
            if (p && Number(p.joinedAt || 0) > 0) {
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
  }, [contract, rows, me, profiles]);

  // Search helpers
  const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v);
  const normalizedQuery = q.trim().replace(/^@/, "").toLowerCase();

  // Username -> address resolution among known partners (inbox cache)
  const knownAddressByUsername = useMemo(() => {
    if (!normalizedQuery) return undefined;
    for (const [addr, p] of Object.entries(profiles)) {
      if ((p.username || "").toLowerCase() === normalizedQuery) return addr;
    }
    return undefined;
  }, [profiles, normalizedQuery]);

  const canStartNew = useMemo(
    () => isAddress(normalizedQuery) || !!knownAddressByUsername,
    [normalizedQuery, knownAddressByUsername]
  );

  const targetAddress = useMemo(() => {
    if (isAddress(normalizedQuery)) return normalizedQuery;
    if (knownAddressByUsername) return knownAddressByUsername;
    return undefined;
  }, [normalizedQuery, knownAddressByUsername]);

  const onSubmit = () => {
    if (!canStartNew || !targetAddress) return;
    router.push(`/chat/${targetAddress}`);
  };

  // Filter visible list by username/address substring
  const visibleRows = useMemo(() => {
    if (!q.trim()) return rows;
    const nq = normalizedQuery;
    return rows.filter((r) => {
      const other = (r.user_lo === me ? r.user_hi : r.user_lo).toLowerCase();
      const p = profiles[other];
      const uname = (p?.username || "").toLowerCase();
      return other.includes(nq) || (!!uname && uname.includes(nq));
    });
  }, [rows, profiles, me, q, normalizedQuery]);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Inbox</h1>
        <Link
          href="/browse"
          className="text-xs rounded-md border border-white/10 px-3 py-1.5 text-gray-300 hover:bg-white/5"
        >
          Find creators
        </Link>
      </div>

      {!me ? (
        <div className="text-sm text-gray-400">
          Connect your wallet to see your chats.
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-950/70 to-gray-900/40 p-3 sm:p-4">
          {/* Search bar */}
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmit();
                }}
                placeholder="Search by @username or wallet address"
                className="w-full rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/10"
              />
              <button
                onClick={onSubmit}
                disabled={!canStartNew}
                className="flex-shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-100 hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10"
                title={
                  canStartNew
                    ? "Start chat"
                    : "Enter a username you know or a wallet address"
                }
              >
                Start
              </button>
            </div>
            {q && !canStartNew && (
              <div className="mt-1 text-[11px] text-gray-500">
                Tip: enter a full wallet address or an @username from your
                chats.
              </div>
            )}
            {canStartNew && targetAddress && (
              <div className="mt-1 text-[11px] text-gray-400">
                Start chat with{" "}
                <span className="font-mono">
                  {formatAddress(targetAddress, 8, 6)}
                </span>
              </div>
            )}
          </div>

          {/* Empty state or list */}
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-gray-900/40 p-6 text-center">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-white/5 flex items-center justify-center">
                <UserCircle2 className="h-7 w-7 text-gray-500" />
              </div>
              <div className="text-sm text-gray-300">No chats yet</div>
              <div className="mt-1 text-xs text-gray-500">
                Start from a profile page, paste a wallet, or use an @username.
              </div>
              <div className="mt-3 text-[11px] text-gray-500">
                Example: <span className="font-mono">/chat/0xabc…</span>
              </div>
              <div className="mt-4">
                <Link
                  href="/gigs"
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-gray-100 hover:bg-white/15"
                >
                  Browse gigs
                </Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {visibleRows.map((r, i) => {
                const rawOther = r.user_lo === me ? r.user_hi : r.user_lo;
                const other = rawOther.toLowerCase();
                const p = profiles[other];
                const avatarUrl = p?.profilePicCID
                  ? toGatewayUrl(p.profilePicCID)
                  : null;
                const display = p?.username
                  ? `@${p.username}`
                  : formatAddress(other);
                const updatedTsSec = Math.floor(
                  new Date(r.updated_at).getTime() / 1000
                );
                return (
                  <li key={`${other}-${i}`}>
                    <Link
                      href={`/chat/${other}`}
                      className="group flex items-center gap-3 rounded-xl border border-white/10 bg-gradient-to-b from-gray-950/70 to-gray-900/40 px-3 py-3 hover:border-white/20 hover:from-gray-900/70 hover:to-gray-900/50 transition-colors"
                    >
                      {avatarUrl ? (
                        <span className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-gray-800 ring-1 ring-white/10">
                          <Image
                            src={avatarUrl}
                            alt={display}
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized
                          />
                        </span>
                      ) : (
                        <span className="h-12 w-12 flex items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 text-gray-500">
                          <UserCircle2 className="h-7 w-7" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-medium text-gray-100">
                            {display}
                          </div>
                          <div className="text-[11px] text-gray-500 whitespace-nowrap">
                            {timeAgo(updatedTsSec)}
                          </div>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500 truncate">
                          Last active {new Date(r.updated_at).toLocaleString()}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
