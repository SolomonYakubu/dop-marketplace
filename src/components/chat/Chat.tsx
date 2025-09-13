"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Paperclip,
  RefreshCcw,
  Send as SendIcon,
  UserCircle2,
  Pin as PinIcon,
} from "lucide-react";
import { toGatewayUrl, loadListingMetadataFromURI } from "@/lib/utils";
import type { ChatDataProvider, ChatMessage } from "./types";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { ListingType, type Listing } from "@/types/marketplace";
import { CreateListingForm } from "@/components/create/CreateListingForm";

// Hydration-safe, timezone-stable formatters (use UTC so SSR/CSR match)
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false, // stable 24h output across locales
  timeZone: "UTC",
});
const dayKeyUTC = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

// Lightweight identity cache contract: caller passes a resolver
export type IdentityResolver = (address: string) =>
  | {
      username?: string;
      profilePicCID?: string;
    }
  | undefined;

export function Identity({
  addr,
  resolve,
}: {
  addr: string;
  resolve: IdentityResolver;
}) {
  const lower = addr.toLowerCase();
  const p = resolve(lower);
  const avatarUrl = p?.profilePicCID ? toGatewayUrl(p.profilePicCID) : null;
  const display = p?.username ? `@${p.username}` : "User";
  return (
    <Link
      href={`/profile/${addr}`}
      className="inline-flex items-center gap-1.5 group/avatar max-w-[140px]"
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
            ? "text-gray-100 font-medium truncate"
            : "text-gray-400 truncate"
        }
      >
        {display}
      </span>
    </Link>
  );
}

export function Chat({
  provider,
  address,
  canSend,
  resolveIdentity,
  placeholder = "Type a message...",
  onMessages,
}: {
  provider: ChatDataProvider;
  address?: string | null;
  canSend?: boolean;
  resolveIdentity: IdentityResolver;
  placeholder?: string;
  onMessages?: (messages: ChatMessage[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  type PinListItem = {
    id: string;
    title: string;
    description?: string;
    image?: string | null;
    priceText?: string; // gigs
    deliveryTime?: string; // gigs
    budgetText?: string; // briefs
    tags?: string[];
  };
  const [myGigs, setMyGigs] = useState<PinListItem[]>([]);
  const [myBriefs, setMyBriefs] = useState<PinListItem[]>([]);
  const [pinTab, setPinTab] = useState<"select" | "create">("select");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { contract } = useMarketplaceContract();
  const previewCacheRef = useRef<Map<string, PinListItem>>(new Map());

  // Memoized messages view to avoid re-rendering the full list on every keystroke
  const MessagesView = useMemo(() => {
    function View({ items, me }: { items: ChatMessage[]; me?: string | null }) {
      return (
        <>
          {loading && (
            <div className="text-gray-500 text-center mt-4 text-xs">
              Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="text-gray-500 text-center mt-8">
              No messages yet.
            </div>
          )}
          {items.map((m, i) => {
            const mine = me && m.sender === me.toLowerCase();
            const hasAttachments = m.attachments && m.attachments.length > 0;
            const day = dayKeyUTC(new Date(m.created_at));
            const prev = i > 0 ? items[i - 1] : null;
            const prevDay = prev ? dayKeyUTC(new Date(prev.created_at)) : null;
            return (
              <div key={m.id}>
                {i === 0 || day !== prevDay ? (
                  <div className="text-[10px] text-gray-500 text-center my-2 select-none">
                    {DATE_FMT.format(new Date(m.created_at))}
                  </div>
                ) : null}
                <div
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words shadow-sm ${
                      mine
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-100"
                    }`}
                  >
                    {!mine && (
                      <div className="text-[10px] opacity-90 mb-1">
                        <Identity addr={m.sender} resolve={resolveIdentity} />
                      </div>
                    )}
                    {m.message_type === "pin" && m.linkUrl ? (
                      <PinPreviewCard m={m} mine={!!mine} />
                    ) : m.content ? (
                      <div className="leading-relaxed">{m.content}</div>
                    ) : null}
                    {hasAttachments && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.attachments!.map((uri, idx) => {
                          const gateway = uri.startsWith("ipfs://")
                            ? `https://ipfs.io/ipfs/${uri.replace(
                                "ipfs://",
                                ""
                              )}`
                            : uri;
                          const linkId = `${m.id}-att-${idx}`;
                          return (
                            <div key={uri} className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={gateway}
                                alt="attachment"
                                className="h-16 w-16 object-cover rounded border border-white/10 cursor-pointer hover:opacity-90 transition"
                                onClick={() => setPreviewImage(gateway)}
                                onError={(e) => {
                                  const img =
                                    e.currentTarget as HTMLImageElement;
                                  img.style.display = "none";
                                  const a = document.getElementById(linkId);
                                  if (a) a.classList.remove("hidden");
                                }}
                              />
                              <a
                                id={linkId}
                                href={gateway}
                                target="_blank"
                                rel="noreferrer"
                                className="hidden underline break-all text-[10px]"
                              >
                                {uri}
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-1 text-[9px] opacity-60 text-right">
                      {TIME_FMT.format(new Date(m.created_at))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      );
    }
    return View;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveIdentity, TIME_FMT, DATE_FMT]);

  // Keep a stable ref to onMessages to avoid resubscribing when parent re-renders
  const onMessagesRef = useRef<typeof onMessages>(onMessages);
  useEffect(() => {
    onMessagesRef.current = onMessages;
  }, [onMessages]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    setLoading(true);
    provider
      .load()
      .then((initial) => {
        const arr = Array.isArray(initial) ? initial : [];
        setMessages(arr);
        onMessagesRef.current?.(arr);
      })
      .finally(() => setLoading(false));
    unsub = provider.subscribe((msgs) => {
      const arr = Array.isArray(msgs) ? msgs : [];
      setMessages(arr);
      onMessagesRef.current?.(arr);
    });
    return () => {
      unsub?.();
    };
  }, [provider]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    if (!address) return;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    if (sending) return;
    setSending(true);
    try {
      await provider.send({ text: trimmed, files }, { sender: address });
      setText("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  }

  async function openPinModal() {
    if (!address || !contract) return;
    setPinOpen(true);
    if (myGigs.length || myBriefs.length) return; // already loaded
    try {
      setPinLoading(true);
      // Fetch a small page of your listings for quick pin
      const page = await contract.getListingsByCreator(address, 0, 25);
      const gigs: PinListItem[] = [];
      const briefs: PinListItem[] = [];
      // Load metadata in parallel for snappy UI
      await Promise.all(
        page.map(async (l: Listing) => {
          const idStr = String(l.id);
          let title = "Untitled";
          let description: string | undefined;
          let image: string | null | undefined;
          let priceText: string | undefined;
          let deliveryTime: string | undefined;
          let budgetText: string | undefined;
          let tags: string[] | undefined;

          try {
            const meta = await loadListingMetadataFromURI(l.metadataURI, l);
            if (meta) {
              title = meta.title || title;
              description = meta.description || undefined;
              image = meta.image ? toGatewayUrl(meta.image) : null;
              tags = meta.tags;
              if (l.listingType === ListingType.GIG) {
                if (meta.price) {
                  const per = meta.price.per ? `/${meta.price.per}` : "";
                  priceText = `${meta.price.amount} ${meta.price.currency}${per}`;
                }
                if (meta.deliveryTime) deliveryTime = meta.deliveryTime;
              } else {
                if (meta.budget) {
                  const { min, max, currency } = meta.budget;
                  if (min != null && max != null) {
                    budgetText = `${min}-${max} ${currency}`;
                  } else if (min != null) {
                    budgetText = `${min}+ ${currency}`;
                  } else if (max != null) {
                    budgetText = `Up to ${max} ${currency}`;
                  }
                }
              }
            }
          } catch {
            // best effort; fall back to Untitled
          }

          const entry: PinListItem = {
            id: idStr,
            title,
            description,
            image,
            priceText,
            deliveryTime,
            budgetText,
            tags,
          };
          if (l.listingType === ListingType.GIG) gigs.push(entry);
          else briefs.push(entry);
        })
      );
      setMyGigs(gigs);
      setMyBriefs(briefs);
    } finally {
      setPinLoading(false);
    }
  }

  async function pinItem(kind: "gig" | "brief", id: string, title: string) {
    if (!address) return;
    setPinOpen(false);
    setPinLoading(false);
    await provider.send(
      { pin: { type: kind, id, title } },
      { sender: address }
    );
  }

  function parsePin(
    m: ChatMessage
  ): { kind: "gig" | "brief"; id: string } | null {
    if (!m.linkUrl) return null;
    const url = m.linkUrl;
    const rx = /\/(gigs|briefs)\/(\d+)/i;
    const match = url.match(rx);
    const kind: "gig" | "brief" | undefined =
      m.linkType ||
      (match ? (match[1] === "gigs" ? "gig" : "brief") : undefined);
    const id = match?.[2] || undefined;
    if (!kind || !id) return null;
    return { kind, id };
  }

  function PinPreviewCard({ m, mine }: { m: ChatMessage; mine: boolean }) {
    const [data, setData] = useState<PinListItem | null>(null);
    const [loadingMeta, setLoadingMeta] = useState(true);

    useEffect(() => {
      let cancelled = false;
      const parsedLocal = parsePin(m);
      const key = parsedLocal ? `${parsedLocal.kind}:${parsedLocal.id}` : "";
      async function load() {
        if (!parsedLocal || !contract) {
          setLoadingMeta(false);
          return;
        }
        const cached = previewCacheRef.current.get(key);
        if (cached) {
          setData(cached);
          setLoadingMeta(false);
          return;
        }
        try {
          // Fetch listing and metadata
          const listing = await contract.getListing(BigInt(parsedLocal.id));
          const meta = await loadListingMetadataFromURI(
            listing.metadataURI,
            listing
          );
          const item: PinListItem = {
            id: parsedLocal.id,
            title:
              meta?.title ||
              m.linkTitle ||
              (parsedLocal.kind === "gig" ? "Gig" : "Brief"),
            description: meta?.description || undefined,
            image: meta?.image ? toGatewayUrl(meta.image) : null,
            priceText:
              listing.listingType === ListingType.GIG && meta?.price
                ? `${meta.price.amount} ${meta.price.currency}${
                    meta.price.per ? `/${meta.price.per}` : ""
                  }`
                : undefined,
            deliveryTime: meta?.deliveryTime,
            budgetText:
              listing.listingType === ListingType.BRIEF && meta?.budget
                ? meta.budget.min != null && meta.budget.max != null
                  ? `${meta.budget.min}-${meta.budget.max} ${meta.budget.currency}`
                  : meta.budget.min != null
                  ? `${meta.budget.min}+ ${meta.budget.currency}`
                  : meta.budget.max != null
                  ? `Up to ${meta.budget.max} ${meta.budget.currency}`
                  : undefined
                : undefined,
            tags: meta?.tags?.slice(0, 3),
          };
          if (!cancelled) {
            previewCacheRef.current.set(key, item);
            setData(item);
          }
        } catch {
          // ignore
        } finally {
          if (!cancelled) setLoadingMeta(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
      // We intentionally only depend on m so preview refreshes when message changes.
    }, [m]);

    const url = m.linkUrl || "#";
    return (
      <div className="rounded-lg overflow-hidden border border-white/10 bg-black/20">
        <Link href={url} className="block hover:bg-white/5">
          <div className="p-2 flex items-start gap-2">
            <div className="w-12 h-12 rounded bg-gray-800/60 overflow-hidden flex-shrink-0">
              {data?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.image}
                  alt="thumb"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                  {m.linkType === "gig" ? "GIG" : "BRIEF"}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={
                    mine
                      ? "text-white font-medium truncate"
                      : "text-blue-300 underline truncate"
                  }
                >
                  {data?.title || m.linkTitle || "Listing"}
                </div>
              </div>
              {loadingMeta ? (
                <div className="mt-1 h-3 bg-white/10 rounded w-2/3" />
              ) : (
                data?.description && (
                  <div className="text-xs text-gray-400 line-clamp-2 mt-0.5">
                    {data.description}
                  </div>
                )
              )}
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-300">
                {data?.priceText && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                    {data.priceText}
                  </span>
                )}
                {data?.deliveryTime && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                    {data.deliveryTime}
                  </span>
                )}
                {data?.budgetText && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                    Budget: {data.budgetText}
                  </span>
                )}
                {data?.tags?.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
              {m.content && (
                <div className="text-[11px] text-gray-400 mt-1 italic">
                  {m.content}
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="h-80 overflow-y-auto border border-gray-800 rounded p-3 space-y-2 text-xs bg-black/30 thin-blue-scrollbar">
        <MessagesView items={messages} me={address} />
        <div ref={bottomRef} />
      </div>
      {canSend && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="mt-3 space-y-2"
        >
          <div className="flex gap-2 items-end">
            <div className="flex-1 flex items-center gap-1 rounded border border-gray-800 bg-gray-900/60 px-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent outline-none py-2 text-sm"
                maxLength={4000}
              />
              <input
                id="chat-file-input"
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="hidden"
                accept="image/*"
              />
              <button
                type="button"
                onClick={() =>
                  document.getElementById("chat-file-input")?.click()
                }
                className="text-gray-400 hover:text-white p-1"
                aria-label="Attach images"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={openPinModal}
                className="text-gray-400 hover:text-white p-1"
                aria-label="Pin listing"
              >
                <PinIcon className="w-4 h-4" />
              </button>
              <button
                type="submit"
                disabled={sending || (!text.trim() && files.length === 0)}
                className="text-blue-400 hover:text-blue-300 disabled:opacity-50 p-1"
                aria-label="Send message"
              >
                {sending ? (
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                ) : (
                  <SendIcon className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
              {files.slice(0, 4).map((f) => (
                <span
                  key={f.name}
                  className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700"
                >
                  {f.name.slice(0, 12)}
                </span>
              ))}
              {files.length > 4 && (
                <span className="text-gray-500">+{files.length - 4} more</span>
              )}
              <button
                type="button"
                onClick={() => setFiles([])}
                className="px-2 py-0.5 rounded border border-gray-700 hover:bg-gray-800"
              >
                Clear
              </button>
            </div>
          )}
        </form>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-3xl max-h-full rounded border border-white/10 bg-black/60 backdrop-blur-sm p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage}
              alt="preview"
              className="max-h-[70vh] max-w-full object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 bg-white text-black rounded-full w-7 h-7 flex items-center justify-center shadow"
              aria-label="Close preview"
            >
              X
            </button>
          </div>
        </div>
      )}

      {pinOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4"
          onClick={() => setPinOpen(false)}
        >
          <div
            className={`w-full ${
              pinTab === "create" ? "max-w-3xl" : "max-w-md"
            } rounded-lg border border-white/10 bg-gray-900/90 backdrop-blur p-0 sm:p-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 px-4 pt-4 sm:px-0 sm:pt-0">
              <div className="text-sm text-gray-200 font-medium flex items-center gap-2">
                <PinIcon className="w-4 h-4" /> Pin a listing
              </div>
              <button
                className="text-xs text-gray-400 hover:text-gray-200"
                onClick={() => setPinOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs px-4 sm:px-0 mb-2">
              <button
                className={`px-2 py-1 rounded ${
                  pinTab === "select"
                    ? "bg-white text-black"
                    : "text-gray-300 hover:bg-white/5"
                }`}
                onClick={() => setPinTab("select")}
              >
                Select existing
              </button>
              <button
                className={`px-2 py-1 rounded ${
                  pinTab === "create"
                    ? "bg-white text-black"
                    : "text-gray-300 hover:bg-white/5"
                }`}
                onClick={() => setPinTab("create")}
              >
                Create new
              </button>
            </div>
            <div className="max-h-[85vh] overflow-y-auto thin-blue-scrollbar p-4 sm:p-0">
              {pinTab === "select" ? (
                pinLoading ? (
                  <div className="text-xs text-gray-400">
                    Loading your listings…
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="text-[11px] uppercase text-gray-500 mb-2 tracking-wide">
                        Gigs
                      </div>
                      {myGigs.length === 0 && (
                        <div className="text-xs text-gray-500">
                          No gigs found.
                        </div>
                      )}
                      <div className="space-y-2">
                        {myGigs.map((g) => (
                          <button
                            key={`g-${g.id}`}
                            onClick={() => pinItem("gig", g.id, g.title)}
                            className="w-full text-left rounded border border-white/10 bg-black/30 hover:bg-white/5 transition group p-2"
                          >
                            <div className="flex gap-3 items-start">
                              <div className="w-12 h-12 rounded bg-gray-800/60 overflow-hidden flex-shrink-0">
                                {g.image ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={g.image}
                                    alt="thumb"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                                    GIG
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm text-gray-100 font-medium truncate">
                                    {g.title}
                                  </div>
                                  <span className="text-[10px] text-gray-500">
                                    #{g.id}
                                  </span>
                                </div>
                                {g.description && (
                                  <div className="text-xs text-gray-400 line-clamp-2 mt-0.5">
                                    {g.description}
                                  </div>
                                )}
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-300">
                                  {g.priceText && (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                                      {g.priceText}
                                    </span>
                                  )}
                                  {g.deliveryTime && (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                                      {g.deliveryTime}
                                    </span>
                                  )}
                                  {g.tags?.slice(0, 3).map((t) => (
                                    <span
                                      key={t}
                                      className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-gray-500 mb-2 tracking-wide">
                        Briefs
                      </div>
                      {myBriefs.length === 0 && (
                        <div className="text-xs text-gray-500">
                          No briefs found.
                        </div>
                      )}
                      <div className="space-y-2">
                        {myBriefs.map((b) => (
                          <button
                            key={`b-${b.id}`}
                            onClick={() => pinItem("brief", b.id, b.title)}
                            className="w-full text-left rounded border border-white/10 bg-black/30 hover:bg-white/5 transition group p-2"
                          >
                            <div className="flex gap-3 items-start">
                              <div className="w-12 h-12 rounded bg-gray-800/60 overflow-hidden flex-shrink-0">
                                {b.image ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={b.image}
                                    alt="thumb"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                                    BRIEF
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm text-gray-100 font-medium truncate">
                                    {b.title}
                                  </div>
                                  <span className="text-[10px] text-gray-500">
                                    #{b.id}
                                  </span>
                                </div>
                                {b.description && (
                                  <div className="text-xs text-gray-400 line-clamp-2 mt-0.5">
                                    {b.description}
                                  </div>
                                )}
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-300">
                                  {b.budgetText && (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                                      Budget: {b.budgetText}
                                    </span>
                                  )}
                                  {b.tags?.slice(0, 3).map((t) => (
                                    <span
                                      key={t}
                                      className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="pt-2">
                  <CreateListingForm
                    defaultType="brief"
                    onCreated={(info) => {
                      // auto-pin and close
                      void pinItem(
                        info.type,
                        info.id,
                        info.title || (info.type === "gig" ? "Gig" : "Brief")
                      );
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
