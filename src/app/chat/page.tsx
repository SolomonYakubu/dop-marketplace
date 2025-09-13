"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { supabase } from "@/lib/supabaseClient";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";

type DirectDoc = { user_lo: string; user_hi: string; updated_at: string };

export default function ChatInboxPage() {
  const { address } = useAccount();
  const { contract } = useMarketplaceContract();
  const [rows, setRows] = useState<DirectDoc[]>([]);
  const me = useMemo(() => address?.toLowerCase() || "", [address]);
  const [names, setNames] = useState<Record<string, string>>({});

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

  // Resolve usernames for partners
  useEffect(() => {
    if (!contract || rows.length === 0 || !me) return;
    const partners = Array.from(
      new Set(rows.map((r) => (r.user_lo === me ? r.user_hi : r.user_lo)))
    );
    const missing = partners.filter((p) => !names[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missing.map(async (addr) => {
          try {
            interface RawP {
              joinedAt: bigint;
              username?: string;
            }
            const p: RawP = await (
              contract as unknown as {
                getProfile: (a: string) => Promise<RawP>;
              }
            ).getProfile(addr);
            if (p && Number(p.joinedAt || 0) > 0 && p.username) {
              updates[addr] = `@${p.username}`;
            }
          } catch {}
        })
      );
      if (!cancelled && Object.keys(updates).length) {
        setNames((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contract, rows, me, names]);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-lg text-gray-200">Your chats</h1>
      {!me ? (
        <div className="text-sm text-gray-400">
          Connect your wallet to see your chats.
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-400">
          No chats yet. Start from a profile page, or open a direct link like
          <span className="mx-1 font-mono">/chat/0xabc…</span>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const other = r.user_lo === me ? r.user_hi : r.user_lo;
            const label = names[other] || "User";
            return (
              <Link
                key={i}
                href={`/chat/${other}`}
                className="flex items-center justify-between rounded border border-white/10 bg-gray-950/60 px-3 py-2 text-sm hover:bg-gray-900/70"
              >
                <span className="text-gray-200">{label}</span>
                <span className="text-[11px] text-gray-500">
                  {new Date(r.updated_at).toLocaleString()}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <Link href="/gigs" className="underline text-blue-400">
        Browse gigs
      </Link>
    </div>
  );
}
