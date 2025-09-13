"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAccount } from "wagmi";
import { UserCircle2, ArrowLeft } from "lucide-react";
import { Chat } from "@/components/chat/Chat";
import { DirectChatProvider } from "@/components/chat";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { toGatewayUrl } from "@/lib/utils";

export default function DirectChatPage({
  params,
}: {
  params: { address: string };
}) {
  const other = params.address;
  const { address } = useAccount();
  const { contract } = useMarketplaceContract();
  const [mounted, setMounted] = useState(false);
  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; profilePicCID?: string }>
  >({});

  useEffect(() => {
    setMounted(true);
  }, []);

  const provider = useMemo(() => {
    if (!mounted || !address) return null;
    return new DirectChatProvider(address, other);
  }, [mounted, address, other]);

  const resolveIdentity = useCallback(
    (addr: string) => profiles[addr.toLowerCase()],
    [profiles]
  );

  // Prefetch identities for self + other, and any senders in stream
  useEffect(() => {
    if (!contract) return;
    const targets = [other, address].filter(Boolean) as string[];
    const toFetch = targets
      .map((a) => a.toLowerCase())
      .filter((a) => !profiles[a]);
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
  }, [address, other, contract, profiles]);

  const Identity = ({ addr }: { addr: string }) => {
    const lower = addr.toLowerCase();
    const p = profiles[lower];
    const avatarUrl = p?.profilePicCID ? toGatewayUrl(p.profilePicCID) : null;
    const display = p?.username ? `@${p.username}` : "User";
    return (
      <div className="inline-flex items-center gap-2">
        {avatarUrl ? (
          <span className="relative w-8 h-8 rounded-full overflow-hidden bg-gray-800 ring-1 ring-white/10 flex-shrink-0">
            <Image
              src={avatarUrl}
              alt={display}
              fill
              sizes="32px"
              className="object-cover"
              unoptimized
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
        ) : (
          <UserCircle2 className="w-8 h-8 text-gray-500" />
        )}
        <div className="text-sm text-gray-200">{display}</div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-800/60 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>
      <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base text-gray-200">Chat</h1>
          <Identity addr={other} />
        </div>
        <div className="mt-4">
          {provider ? (
            <Chat
              provider={provider}
              address={address}
              canSend={!!address}
              resolveIdentity={resolveIdentity}
              onMessages={(msgs) => {
                const addrs = Array.from(
                  new Set(msgs.map((m) => m.sender.toLowerCase()))
                );
                const missing = addrs.filter((a) => !profiles[a]);
                if (missing.length === 0 || !contract) return;
                (async () => {
                  const updates: Record<
                    string,
                    { username?: string; profilePicCID?: string }
                  > = {};
                  await Promise.all(
                    missing.map(async (a) => {
                      try {
                        interface RawP {
                          joinedAt: bigint;
                          username?: string;
                          profilePicCID?: string;
                        }
                        const p: RawP = await (
                          contract as unknown as {
                            getProfile: (x: string) => Promise<RawP>;
                          }
                        ).getProfile(a);
                        if (p && Number(p.joinedAt || 0) > 0) {
                          updates[a] = {
                            username: p.username || undefined,
                            profilePicCID: p.profilePicCID || undefined,
                          };
                        }
                      } catch {}
                    })
                  );
                  if (Object.keys(updates).length)
                    setProfiles((prev) => ({ ...prev, ...updates }));
                })();
              }}
            />
          ) : (
            <div className="p-6 text-center text-sm text-gray-400">
              Connect your wallet to start chatting.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
